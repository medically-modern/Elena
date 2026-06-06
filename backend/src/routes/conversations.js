import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

// List conversations for the authenticated user
router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user?.userId || req.user?.id || null;

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
});

// Get messages for a conversation
router.get('/:id/messages', (req, res) => {
  const db = getDb();
  const userId = req.user?.userId || req.user?.id || null;

  // Verify ownership
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
});

// Delete a conversation
router.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user?.userId || req.user?.id || null;

  if (userId && userId !== 'portal') {
    const convo = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(req.params.id);
    if (convo && convo.user_id && convo.user_id !== userId) {
      return res.status(403).json({ error: 'Not your conversation' });
    }
  }

  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Rename a conversation
router.patch('/:id', (req, res) => {
  const db = getDb();
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const userId = req.user?.userId || req.user?.id || null;
  if (userId && userId !== 'portal') {
    const convo = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(req.params.id);
    if (convo && convo.user_id && convo.user_id !== userId) {
      return res.status(403).json({ error: 'Not your conversation' });
    }
  }

  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, req.params.id);
  res.json({ ok: true });
});

export default router;
