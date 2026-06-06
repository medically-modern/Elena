import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/init.js';
import { chat } from '../services/elena.js';

const router = Router();

// Send a message — creates conversation if needed
router.post('/', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const db = getDb();
    let convoId = conversationId;

    // Create new conversation if none provided
    if (!convoId) {
      convoId = uuidv4();
      db.prepare('INSERT INTO conversations (id) VALUES (?)').run(convoId);
    }

    const response = await chat(convoId, message);

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
