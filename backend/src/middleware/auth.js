const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret !== 'your_jwt_secret_key_here' && secret !== 'replace-with-a-long-random-secret') return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be configured with a strong secret in production');
  return 'local-development-secret-change-before-deploying';
}

function signToken(user) {
  return jwt.sign(
    { role: user.role, username: user.username },
    getJwtSecret(),
    { subject: String(user.id), expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

function authenticate(db) {
  return (req, res, next) => {
    const value = req.get('authorization') || '';
    const [scheme, token] = value.split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Bearer token required' });
    try {
      const claims = jwt.verify(token, getJwtSecret());
      const user = db.prepare(`
        SELECT id, username, email, roll_no, full_name AS name, role, phone,
               department_id, branch_id, semester_id, section_id
        FROM users WHERE id = ? AND is_active = 1
      `).get(Number(claims.sub));
      if (!user) return res.status(401).json({ error: 'Account is unavailable' });
      req.user = user;
      return next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      return next(error);
    }
  };
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    return next();
  };
}

module.exports = { authenticate, allowRoles, signToken };
