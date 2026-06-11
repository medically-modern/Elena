import { Router } from 'express';
import { getDb } from '../db/init.js';
import { getStats as getVectorStats, isReady, getPool } from '../services/vectorStore.js';

const router = Router();

// Get all stats
router.get('/stats', async (req, res) => {
  const db = getDb();
  const conversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
  const messages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const chunks = db.prepare('SELECT COUNT(*) as count FROM knowledge_chunks').get();
  const facts = db.prepare('SELECT COUNT(*) as count FROM learned_facts').get();

  // Vector store stats
  let vectorStore = { ready: false, total: 0 };
  if (isReady()) {
    try {
      vectorStore = await getVectorStats();
    } catch (err) {
      vectorStore = { ready: true, error: err.message };
    }
  }

  res.json({
    conversations: conversations.count,
    messages: messages.count,
    knowledgeChunks: chunks.count,
    learnedFacts: facts.count,
    vectorStore,
  });
});

// List knowledge chunks (read-only, for training audits)
// GET /api/admin/chunks?category=communication&source=slack:foo&limit=500&offset=0
router.get('/chunks', async (req, res) => {
  if (!isReady()) return res.status(503).json({ error: 'Vector store not available' });
  try {
    const pool = getPool();
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    let where = '1=1';
    if (req.query.category) { params.push(req.query.category); where += ` AND category = $${params.length}`; }
    if (req.query.source) { params.push(req.query.source + '%'); where += ` AND source LIKE $${params.length}`; }
    if (req.query.sourceType) { params.push(req.query.sourceType); where += ` AND source_type = $${params.length}`; }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, content, source, source_type, category, metadata, created_at
       FROM knowledge_vectors WHERE ${where}
       ORDER BY id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ count: result.rows.length, chunks: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
