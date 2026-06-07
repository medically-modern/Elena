import { Router } from 'express';
import {
  isConversationsReady,
  listConversations,
  getMessages,
  getConversation,
  deleteConversation,
  updateConversationTitle,
} from '../services/pgConversations.js';
import { getDb } from '../db/init.js';

const router = Router();

// List conversations for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || null;

    if (isConversationsReady()) {
      const isPortal = userId === 'portal';
      const convos = await listConversations(isPortal ? null : userId, 'standalone', 100);
      return res.json(convos);
    }

    // SQLite fallback
    const db = getDb();
    let convos;
    if (userId && userId !== 'portal') {
      convos = db.prepare(
        'SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100'
      ).all(userId);
    } else {
      convos = db.prepare(
        'SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 100'
      ).all();
    }
    res.json(convos);
  } catch (err) {
    console.error('List conversations error:', err);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// Get messages for a conversation
router.get('/:id/messages', async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || null;

    if (isConversationsReady()) {
      if (userId && userId !== 'portal') {
        const convo = await getConversation(req.params.id);
        if (convo && convo.user_id && convo.user_id !== userId) {
          return res.status(403).json({ error: 'Not your conversation' });
        }
      }
      const messages = await getMessages(req.params.id);
      return res.json(messages);
    }

    // SQLite fallback
    const db = getDb();
    if (userId && userId !== 'portal') {
      const convo = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(req.params.id);
      if (convo && convo.user_id && convo.user_id !== userId) {
        return res.status(403).json({ error: 'Not your conversation' });
      }
    }
    const messages = db.prepare(
      'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);
    res.json(messages);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// Delete a conversation
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || null;

    if (isConversationsReady()) {
      if (userId && userId !== 'portal') {
        const convo = await getConversation(req.params.id);
        if (convo && convo.user_id && convo.user_id !== userId) {
          return res.status(403).json({ error: 'Not your conversation' });
        }
      }
      await deleteConversation(req.params.id);
      return res.json({ ok: true });
    }

    // SQLite fallback
    const db = getDb();
    if (userId && userId !== 'portal') {
      const convo = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(req.params.id);
      if (convo && convo.user_id && convo.user_id !== userId) {
        return res.status(403).json({ error: 'Not your conversation' });
      }
    }
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete conversation error:', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Rename a conversation
router.patch('/:id', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const userId = req.user?.userId || req.user?.id || null;

    if (isConversationsReady()) {
      if (userId && userId !== 'portal') {
        const convo = await getConversation(req.params.id);
        if (convo && convo.user_id && convo.user_id !== userId) {
          return res.status(403).json({ error: 'Not your conversation' });
        }
      }
      await updateConversationTitle(req.params.id, title);
      return res.json({ ok: true });
    }

    // SQLite fallback
    const db = getDb();
    if (userId && userId !== 'portal') {
      const convo = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(req.params.id);
      if (convo && convo.user_id && convo.user_id !== userId) {
        return res.status(403).json({ error: 'Not your conversation' });
      }
    }
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Rename conversation error:', err);
    res.status(500).json({ error: 'Failed to rename conversation' });
  }
});

export default router;
