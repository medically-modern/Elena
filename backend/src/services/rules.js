// rules.js — shared rules engine backed by pgvector
// Rules are the source of truth. They override all other context (Slack history, documents, etc.)
// Stored in the same knowledge_vectors table with source_type='rule'

import { isReady } from './vectorStore.js';
import { embed } from './embeddings.js';
import pg from 'pg';

const { Pool } = pg;
let pool;

export function initRulesPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 3,
  });
  return true;
}

// Ensure rules table schema (extends knowledge_vectors with rule-specific fields)
export async function setupRulesSchema() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    // Add is_active column if not exists (for soft-deleting rules)
    await client.query(`
      ALTER TABLE knowledge_vectors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
    `);
    // Add priority column (higher = more authoritative)
    await client.query(`
      ALTER TABLE knowledge_vectors ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0
    `);
    console.log('Rules schema ready');
  } catch (err) {
    // Columns may already exist, that's fine
    if (!err.message.includes('already exists')) {
      console.error('Rules schema setup error:', err.message);
    }
  } finally {
    client.release();
  }
}

// Create a new rule
export async function createRule(ruleText, category = 'general', metadata = {}) {
  if (!pool) throw new Error('Rules not initialized — no DATABASE_URL');

  // Embed the rule for semantic retrieval
  const embedding = await embed(ruleText);
  const vectorStr = '[' + embedding.join(',') + ']';

  const result = await pool.query(
    `INSERT INTO knowledge_vectors (content, source, source_type, category, metadata, embedding, is_active, priority)
     VALUES ($1, 'elena-rule', 'rule', $2, $3, $4::vector, true, 10)
     RETURNING id, content, category, created_at`,
    [ruleText, category, JSON.stringify(metadata), vectorStr]
  );
  return result.rows[0];
}

// Get ALL active rules (always loaded — not similarity-gated)
export async function getAllActiveRules() {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, content, category, metadata, priority, created_at, updated_at
     FROM knowledge_vectors
     WHERE source_type = 'rule' AND (is_active IS NULL OR is_active = true)
     ORDER BY priority DESC, created_at DESC`
  );
  return result.rows;
}

// Search rules by semantic similarity (for targeted retrieval)
export async function searchRules(queryEmbedding, limit = 5) {
  if (!pool) return [];
  const vectorStr = '[' + queryEmbedding.join(',') + ']';
  const result = await pool.query(
    `SELECT id, content, category, metadata, priority,
            1 - (embedding <=> $1::vector) as similarity
     FROM knowledge_vectors
     WHERE source_type = 'rule' AND (is_active IS NULL OR is_active = true)
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, limit]
  );
  return result.rows;
}

// Update a rule
export async function updateRule(id, newText, category = null) {
  if (!pool) throw new Error('Rules not initialized');

  const embedding = await embed(newText);
  const vectorStr = '[' + embedding.join(',') + ']';

  let query = `UPDATE knowledge_vectors SET content = $1, embedding = $2::vector, updated_at = NOW()`;
  const params = [newText, vectorStr];
  let paramIdx = 3;

  if (category) {
    query += `, category = $${paramIdx++}`;
    params.push(category);
  }

  query += ` WHERE id = $${paramIdx} AND source_type = 'rule' RETURNING id, content, category, updated_at`;
  params.push(id);

  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

// Soft-delete a rule (keep for audit trail)
export async function deactivateRule(id) {
  if (!pool) throw new Error('Rules not initialized');
  const result = await pool.query(
    `UPDATE knowledge_vectors SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND source_type = 'rule' RETURNING id, content`,
    [id]
  );
  return result.rows[0] || null;
}

// Hard-delete a rule
export async function deleteRule(id) {
  if (!pool) throw new Error('Rules not initialized');
  const result = await pool.query(
    `DELETE FROM knowledge_vectors WHERE id = $1 AND source_type = 'rule' RETURNING id`,
    [id]
  );
  return result.rowCount > 0;
}

// Build the rules block for the system prompt
// This is called on every chat — rules are ALWAYS present, not similarity-gated
export async function buildRulesBlock() {
  const rules = await getAllActiveRules();
  if (rules.length === 0) return '';

  let block = '\n\n## ⚠️ ACTIVE RULES (SOURCE OF TRUTH — OVERRIDE ALL OTHER CONTEXT)\n';
  block += 'These rules were set by the team. They are ABSOLUTE and take precedence over any historical context, Slack conversations, documents, or prior knowledge. If a rule contradicts something in retrieved context, THE RULE WINS.\n\n';

  for (const rule of rules) {
    const cat = rule.category !== 'general' ? ` [${rule.category}]` : '';
    block += `- **RULE${cat}:** ${rule.content}\n`;
  }

  block += '\nWhen answering questions, ALWAYS check these rules first. If a question touches on a topic covered by a rule, lead with the rule.\n';
  return block;
}

export function isRulesReady() {
  return !!pool;
}
