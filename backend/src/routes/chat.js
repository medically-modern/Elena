import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { chat } from '../services/elena.js';
import {
  isConversationsReady,
  createConversation,
  getConversation,
} from '../services/pgConversations.js';
import { getDb } from '../db/init.js';

const router = Router();

// Send a message — creates conversation if needed
router.post('/', async (req, res) => {
  try {
    const { message, conversationId, mode, qaMode } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const userId = req.user?.userId || req.user?.id || null;
    let convoId = conversationId;

    if (isConversationsReady()) {
      // ─── Postgres path ───
      if (!convoId) {
        convoId = uuidv4();
        await createConversation(convoId, userId, 'standalone');
      } else {
        const existing = await getConversation(convoId);
        if (!existing) {
          await createConversation(convoId, userId, 'standalone');
        } else if (userId && userId !== 'portal' && existing.user_id && existing.user_id !== userId) {
          return res.status(403).json({ error: 'Not your conversation' });
        }
      }
    } else {
      // ─── SQLite fallback ───
      const db = getDb();
      if (!convoId) {
        convoId = uuidv4();
        db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?)').run(convoId, userId);
      } else {
        const existing = db.prepare('SELECT id, user_id FROM conversations WHERE id = ?').get(convoId);
        if (!existing) {
          db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?)').run(convoId, userId);
        } else if (userId && userId !== 'portal' && existing.user_id && existing.user_id !== userId) {
          return res.status(403).json({ error: 'Not your conversation' });
        }
      }
    }

    const elenaMode = req.headers['x-elena-mode'] || mode || 'standard';
    const response = await chat(convoId, message, elenaMode, !!qaMode);

    // Get title
    let title = 'New Chat';
    if (isConversationsReady()) {
      const convo = await getConversation(convoId);
      title = convo?.title || title;
    } else {
      const db = getDb();
      const convo = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convoId);
      title = convo?.title || title;
    }

    res.json({ conversationId: convoId, message: response, title });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Elena encountered an error' });
  }
});

export default router;
