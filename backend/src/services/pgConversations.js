// pgConversations.js — persistent conversation store backed by shared Postgres
// Replaces SQLite for conversations + messages so they survive redeployments.
// Used by both Elena standalone and Corey Portal.

import pg from 'pg';
const { Pool } = pg;

let pool;

export function initConversationsPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('[pgConversations] DATABASE_URL not set — conversations will not persist');
    return false;
  }
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
  });
  return true;
}

export async function setupConversationsSchema() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT 'New Chat',
        user_id TEXT,
        source TEXT DEFAULT 'standalone',
        context_module TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        context_module TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    `);
    console.log('[pgConversations] Schema ready');
  } finally {
    client.release();
  }
}

export function isConversationsReady() {
  return !!pool;
}

// ─── Conversation CRUD ─────────────────────────────────────────────────────────

export async function createConversation(id, userId = null, source = 'standalone') {
  if (!pool) return null;
  const result = await pool.query(
    'INSERT INTO conversations (id, user_id, source) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING *',
    [id, userId, source]
  );
  return result.rows[0] || await getConversation(id);
}

export async function getConversation(id) {
  if (!pool) return null;
  const result = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function listConversations(userId = null, source = null, limit = 100) {
  if (!pool) return [];
  let query = 'SELECT id, title, user_id, source, context_module, created_at, updated_at FROM conversations';
  const params = [];
  const conditions = [];

  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  params.push(limit);
  query += ` ORDER BY updated_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function updateConversationTitle(id, title) {
  if (!pool) return;
  await pool.query(
    'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
    [title, id]
  );
}

export async function touchConversation(id) {
  if (!pool) return;
  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [id]);
}

export async function deleteConversation(id) {
  if (!pool) return;
  // Messages deleted by ON DELETE CASCADE
  await pool.query('DELETE FROM conversations WHERE id = $1', [id]);
}

// ─── Messages CRUD ──────────────────────────────────────────────────────────────

export async function addMessage(conversationId, role, content, contextModule = null) {
  if (!pool) return null;
  const result = await pool.query(
    'INSERT INTO messages (conversation_id, role, content, context_module) VALUES ($1, $2, $3, $4) RETURNING *',
    [conversationId, role, content, contextModule]
  );
  return result.rows[0];
}

export async function getMessages(conversationId, limit = null) {
  if (!pool) return [];
  let query = 'SELECT id, role, content, context_module, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC';
  const params = [conversationId];
  if (limit) {
    params.push(limit);
    query += ` LIMIT $${params.length}`;
  }
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRecentMessages(conversationId, limit = 20) {
  if (!pool) return [];
  // Get last N messages in chronological order
  const result = await pool.query(
    `SELECT id, role, content, context_module, created_at FROM (
       SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
     ) sub ORDER BY created_at ASC`,
    [conversationId, limit]
  );
  return result.rows;
}

// ─── Portal-specific: flat conversation log ─────────────────────────────────────

const PORTAL_CONVO_ID = 'portal-default';

export async function ensurePortalConversation() {
  if (!pool) return;
  await pool.query(
    "INSERT INTO conversations (id, user_id, source, title) VALUES ($1, 'portal', 'portal', 'Portal Chat') ON CONFLICT (id) DO NOTHING",
    [PORTAL_CONVO_ID]
  );
}

export async function addPortalMessage(role, content, contextModule = null) {
  return addMessage(PORTAL_CONVO_ID, role, content, contextModule);
}

export async function getPortalHistory(limit = 20) {
  return getRecentMessages(PORTAL_CONVO_ID, limit);
}
