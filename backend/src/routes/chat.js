import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/init.js';
import { chat } from '../services/elena.js';

const router = Router();

// Send a message — creates conversation if needed
router.post('/', async (req, res) => {
  try {
    const { message, conversationId, mode } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const db = getDb();
    const userId = req.user?.userId || req.user?.id || null;
    let convoId = conversationId;

    // Create new conversation if none provided
    if (!convoId) {
      convoId = uuidv4();
      db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?)').run(convoId, userId);
    } else {
      // Ensure conversation exists (upsert)
      const existing = db.prepare('SELECT id, user_id FROM conversations WHERE id = ?').get(convoId);
      if (!existing) {
        db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?)').run(convoId, userId);
      } else if (userId && userId !== 'portal' && existing.user_id && existing.user_id !== userId) {
        return res.status(403).json({ error: 'Not your conversation' });
      }
    }

    // Determine mode: Portal sends x-elena-mode header or mode in body
    const elenaMode = req.headers['x-elena-mode'] || mode || 'standard';

    const response = await chat(convoId, message, elenaMode);

    // Get updated title
    const convo = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convoId);

    res.json({
      conversationId: convoId,
      message: response,
      title: convo?.title || 'New Chat'
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Elena encountered an error' });
  }
});

export default router;
