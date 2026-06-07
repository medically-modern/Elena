import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { getDb } from '../db/init.js';
import { generateToken } from '../middleware/auth.js';
import {
  isConversationsReady,
  upsertUser,
  getUserByGoogleId,
  getUserById,
} from '../services/pgConversations.js';
import pg from 'pg';

const router = Router();

// One-time migration: reassign orphaned conversations from old UUID user_ids
async function migrateOrphanedConversations(googleId) {
  if (!isConversationsReady()) return;
  try {
    const { Pool } = pg;
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    // Find standalone conversations whose user_id doesn't match any known googleId in the users table
    const result = await pool.query(`
      UPDATE conversations
      SET user_id = $1
      WHERE source = 'standalone'
        AND user_id IS NOT NULL
        AND user_id != 'portal'
        AND user_id != $1
        AND user_id NOT IN (SELECT google_id FROM users WHERE google_id IS NOT NULL)
      RETURNING id, title
    `, [googleId]);
    if (result.rows.length > 0) {
      console.log(`[auth] Migrated ${result.rows.length} orphaned conversations to ${googleId}`);
    }
    await pool.end();
  } catch (err) {
    console.warn('[auth] Orphan migration skipped:', err.message);
  }
}

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

    let user;

    if (isConversationsReady()) {
      user = await upsertUser(googleId, email, name, picture);
      // Reclaim any orphaned conversations from previous deploys
      migrateOrphanedConversations(googleId).catch(() => {});
    } else {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
      if (existing) {
        db.prepare(
          "UPDATE users SET email = ?, name = ?, picture = ?, last_login = datetime('now') WHERE google_id = ?"
        ).run(email, name, picture, googleId);
        user = { ...existing, email, name, picture, google_id: googleId };
      } else {
        db.prepare(
          'INSERT INTO users (id, google_id, email, name, picture) VALUES (?, ?, ?, ?, ?)'
        ).run(googleId, googleId, email, name, picture);
        user = { id: googleId, google_id: googleId, email, name, picture };
      }
    }

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

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  let user;
  if (isConversationsReady()) {
    user = await getUserByGoogleId(req.user.userId);
    if (!user) user = await getUserById(req.user.userId);
  }

  if (!user) {
    const db = getDb();
    user = db.prepare('SELECT id, email, name, picture FROM users WHERE google_id = ?').get(req.user.userId);
    if (!user) user = db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(req.user.userId);
  }

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.google_id || user.id, email: user.email, name: user.name, picture: user.picture });
});

export default router;
