import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

// Get knowledge stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const conversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
  const messages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const chunks = db.prepare('SELECT COUNT(*) as count FROM knowledge_chunks').get();
  const facts = db.prepare('SELECT COUNT(*) as count FROM learned_facts').get();
  res.json({
    conversations: conversations.count,
    messages: messages.count,
    knowledgeChunks: chunks.count,
    learnedFacts: facts.count
  });
});

export default router;
