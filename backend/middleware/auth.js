import jwt from 'jsonwebtoken';

/**
 * Protects a route — rejects requests without a valid
 * "Authorization: Bearer <token>" header, and attaches the decoded
 * { id, email } payload to req.user for downstream handlers.
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Login required.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid — please log in again.' });
  }
}

/**
 * Gates admin-only actions — delete/retire/edit/financial-modify
 * actions and CSV import, per the app's two-role model (see
 * 011_user_roles.sql / authController.js). Must run AFTER
 * authenticateToken, since it reads req.user.role from the verified
 * token payload (role is embedded in the JWT itself at login time —
 * no extra DB lookup needed on every request).
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'This action requires an admin account.' });
  }
  next();
}
