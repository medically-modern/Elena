import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

// List all conversations (sidebar)
router.get('/', (req, res) => {
  const db = getDb();
  const convos = db.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 100'
  ).all();
  res.json(convos);
});

// Get messages for a conversation
router.get('/:id/messages', (req, res) => {
  const db = getDb();
  const messages = db.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(messages);
});

// Delete a conversation
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Rename a conversation
router.patch('/:id', (req, res) => {
  const db = getDb();
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, req.params.id);
  res.json({ ok: true });
});

export default router;
