import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'elena-dev-secret-change-me';

export function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function authMiddleware(req, res, next) {
  // Portal API key bypass — Portal uses its own auth, not Google SSO
  const portalKey = process.env.ELENA_PORTAL_KEY;
  if (portalKey && req.headers['x-portal-key'] === portalKey) {
    req.user = { id: 'portal', email: 'portal@medicallymodern.com', name: 'Corey Portal', isPortal: true };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth — sets req.user if token present, but doesn't block
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch {}
  }
  next();
}
