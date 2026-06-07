import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/init.js';
import { generateToken } from '../middleware/auth.js';

const router = Router();

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required' });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

    const client = new OAuth2Client(clientId);
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
    } catch (verifyErr) {
      console.error('Token verification failed:', verifyErr.message);
      return res.status(401).json({ error: 'Token verification failed: ' + verifyErr.message });
    }

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture, hd } = payload;

    const allowedDomain = process.env.ALLOWED_DOMAIN;
    if (allowedDomain && hd !== allowedDomain) {
      return res.status(403).json({ error: `Only ${allowedDomain} accounts are allowed` });
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    let user;

    if (existing) {
      db.prepare(
        "UPDATE users SET email = ?, name = ?, picture = ?, last_login = datetime('now') WHERE google_id = ?"
      ).run(email, name, picture, googleId);
      user = { ...existing, email, name, picture };
    } else {
      const id = uuidv4();
      db.prepare(
        'INSERT INTO users (id, google_id, email, name, picture) VALUES (?, ?, ?, ?, ?)'
      ).run(id, googleId, email, name, picture);
      user = { id, google_id: googleId, email, name, picture };
    }

    // Use googleId as the stable userId in the JWT — survives redeployments
    // (the UUID in users table changes each deploy since SQLite is ephemeral)
    const token = generateToken({ ...user, id: googleId });
    res.json({
      token,
      user: { id: googleId, email: user.email, name: user.name, picture: user.picture }
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Auth failed: ' + err.message });
  }
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDb();
  // Try by google_id first (new stable ID), then fall back to old UUID
  let user = db.prepare('SELECT id, email, name, picture FROM users WHERE google_id = ?').get(req.user.userId);
  if (!user) {
    user = db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(req.user.userId);
  }
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

export default router;
