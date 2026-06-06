import { Router } from 'express';
import { getDb } from '../db/init.js';
import { getStats as getVectorStats, isReady } from '../services/vectorStore.js';

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

export default router;
