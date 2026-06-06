import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
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
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture, hd } = payload;

    // Optional: restrict to company domain
    const allowedDomain = process.env.ALLOWED_DOMAIN;
    if (allowedDomain && hd !== allowedDomain) {
      return res.status(403).json({ error: `Only ${allowedDomain} accounts are allowed` });
    }

    const db = getDb();

    // Upsert user
    const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    let user;

    if (existing) {
      db.prepare(
        'UPDATE users SET email = ?, name = ?, picture = ?, last_login = datetime(\'now\') WHERE google_id = ?'
      ).run(email, name, picture, googleId);
      user = { ...existing, email, name, picture };
    } else {
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO users (id, google_id, email, name, picture) VALUES (?, ?, ?, ?, ?)'
      ).run(id, googleId, email, name, picture);
      user = { id, google_id: googleId, email, name, picture };
    }

    const token = generateToken(user);

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture }
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Invalid Google credential' });
  }
});

// Get current user info
router.get('/me', (req, res) => {
  // This endpoint needs auth middleware applied in index.js
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

export default router;
