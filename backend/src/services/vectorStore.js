import pg from 'pg';

const { Pool } = pg;
let pool;

export function initVectorStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('DATABASE_URL not set — RAG disabled, using hardcoded knowledge only');
    return false;
  }
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
  });
  console.log('Vector store pool created');
  return true;
}

export async function setupSchema() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        source_type TEXT NOT NULL DEFAULT 'document',
        category TEXT DEFAULT 'general',
        metadata JSONB DEFAULT '{}',
        embedding vector(1536),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // HNSW index — works from row 1, no training required
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kv_embedding
      ON knowledge_vectors USING hnsw (embedding vector_cosine_ops)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kv_source_type
      ON knowledge_vectors (source_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kv_category
      ON knowledge_vectors (category)
    `);
    console.log('Vector store schema ready');
  } finally {
    client.release();
  }
}

// Store a single chunk with its embedding
export async function storeChunk(content, embedding, source, sourceType, category, metadata = {}) {
  if (!pool) throw new Error('Vector store not initialized');
  const vectorStr = '[' + embedding.join(',') + ']';
  const result = await pool.query(
    `INSERT INTO knowledge_vectors (content, source, source_type, category, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector) RETURNING id`,
    [content, source, sourceType, category, JSON.stringify(metadata), vectorStr]
  );
  return result.rows[0].id;
}

// Store multiple chunks in a transaction
export async function storeChunks(chunks) {
  if (!pool) throw new Error('Vector store not initialized');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [];
    for (const chunk of chunks) {
      const vectorStr = '[' + chunk.embedding.join(',') + ']';
      const result = await client.query(
        `INSERT INTO knowledge_vectors (content, source, source_type, category, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector) RETURNING id`,
        [chunk.content, chunk.source, chunk.sourceType, chunk.category, JSON.stringify(chunk.metadata || {}), vectorStr]
      );
      ids.push(result.rows[0].id);
    }
    await client.query('COMMIT');
    return ids;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Semantic search — returns top-k most similar chunks
export async function search(queryEmbedding, limit = 5, threshold = 0.3) {
  if (!pool) return [];
  const vectorStr = '[' + queryEmbedding.join(',') + ']';
  const result = await pool.query(
    `SELECT id, content, source, source_type, category, metadata,
            1 - (embedding <=> $1::vector) as similarity
     FROM knowledge_vectors
     WHERE 1 - (embedding <=> $1::vector) > $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorStr, threshold, limit]
  );
  return result.rows;
}

// Search within a specific source type or category
export async function searchFiltered(queryEmbedding, filters = {}, limit = 5) {
  if (!pool) return [];
  const vectorStr = '[' + queryEmbedding.join(',') + ']';
  let where = '1=1';
  const params = [vectorStr, limit];
  let paramIdx = 3;

  if (filters.sourceType) {
    where += ` AND source_type = $${paramIdx++}`;
    params.push(filters.sourceType);
  }
  if (filters.category) {
    where += ` AND category = $${paramIdx++}`;
    params.push(filters.category);
  }

  const result = await pool.query(
    `SELECT id, content, source, source_type, category, metadata,
            1 - (embedding <=> $1::vector) as similarity
     FROM knowledge_vectors
     WHERE ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    params
  );
  return result.rows;
}

// Get stats
export async function getStats() {
  if (!pool) return { ready: false, total: 0, bySource: {}, byCategory: {} };
  const total = await pool.query('SELECT COUNT(*) as count FROM knowledge_vectors');
  const bySource = await pool.query(
    'SELECT source_type, COUNT(*) as count FROM knowledge_vectors GROUP BY source_type ORDER BY count DESC'
  );
  const byCategory = await pool.query(
    'SELECT category, COUNT(*) as count FROM knowledge_vectors GROUP BY category ORDER BY count DESC'
  );
  return {
    ready: true,
    total: parseInt(total.rows[0].count),
    bySource: Object.fromEntries(bySource.rows.map(r => [r.source_type, parseInt(r.count)])),
    byCategory: Object.fromEntries(byCategory.rows.map(r => [r.category, parseInt(r.count)])),
  };
}

// Delete chunks by source
export async function deleteBySource(source) {
  if (!pool) return 0;
  const result = await pool.query('DELETE FROM knowledge_vectors WHERE source = $1', [source]);
  return result.rowCount;
}

export function isReady() {
  return !!pool;
}
