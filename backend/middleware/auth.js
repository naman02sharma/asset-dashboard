import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

/**
 * Protects a route — rejects requests without a valid
 * "Authorization: Bearer <token>" header, and attaches the CURRENT
 * { id, email, name, role } to req.user for downstream handlers.
 *
 * Deliberately re-reads role/is_approved from the database on every
 * request rather than trusting whatever was baked into the JWT at
 * login time (tokens live for 7 days — see authController.issueToken).
 * Without this, demoting an admin or revoking someone's approval
 * (see 013_user_approval.sql / ManageUsersModal) would silently do
 * nothing for up to 7 days for anyone already logged in — the token
 * itself was never re-checked against either. This is the one place
 * that has to happen; everything downstream (requireAdmin included)
 * just reads req.user, so a fix here alone closes both gaps.
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Login required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid — please log in again.' });
  }

  // Wrapped explicitly (rather than relying on asyncHandler) because
  // this middleware is mounted raw at the top level for nearly every
  // route (see server.js) — an unhandled rejection here (e.g. a
  // transient DB error) would otherwise crash the process instead of
  // just failing this one request.
  let user;
  try {
    const { rows } = await pool.query(`SELECT id, name, email, role, is_approved FROM users WHERE id = $1::uuid`, [payload.id]);
    user = rows[0];
  } catch (err) {
    return next(err);
  }

  if (!user) {
    return res.status(401).json({ error: 'Account no longer exists — please log in again.' });
  }
  if (!user.is_approved) {
    return res.status(403).json({ error: 'Your account access has been revoked. Contact an administrator.', code: 'ACCESS_REVOKED' });
  }

  req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  next();
}

/**
 * Gates admin-only actions — delete/retire/edit/financial-modify
 * actions and CSV import, per the app's two-role model (see
 * 011_user_roles.sql / authController.js). Must run AFTER
 * authenticateToken, which now always attaches the CURRENT role from
 * the database (not a stale JWT payload) — see that function's
 * comment for why that distinction matters here specifically.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'This action requires an admin account.' });
  }
  next();
}

/**
 * Gates the asset/purchase APPROVAL workflow (see
 * database/018_asset_approval_workflow.sql) to admins and seniors —
 * the only two roles allowed to approve or reject a pending purchase.
 * Editing itself is deliberately NOT gated by this middleware anymore
 * — 'senior' and plain 'employee' both get full edit rights on
 * purchases/assets/vendors/inventory holders (just authenticateToken,
 * no extra role check; see routes/purchases.js, assets.js, vendors.js,
 * employees.js). What senior/employee do NOT get: deleting anything
 * (stays admin-only via requireAdmin above) and the Employee Status/HR
 * page or user role/approval management (routes/auth.js, also
 * requireAdmin-only, untouched by this middleware).
 */
export function requireAdminOrSenior(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'senior') {
    return res.status(403).json({ error: 'This action requires an admin or senior account.' });
  }
  next();
}
