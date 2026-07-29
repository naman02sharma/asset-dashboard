import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { sendCsv } from '../utils/csv.js';

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  // Never send password_hash back to the client.
  const { password_hash, ...safe } = user;
  return safe;
}

/**
 * POST /api/auth/register
 * Creates an account and immediately connects a notification channel —
 * "Gmail" (email) or phone (SMS) — since the dashboard needs somewhere
 * to send delivery/payment alerts to.
 */
export async function register(req, res) {
  const { name, email, password, notify_channel = 'email', notify_phone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required.' });
  }
  if (notify_channel === 'sms' && !notify_phone) {
    return res.status(400).json({ error: 'A phone number is required to receive SMS alerts.' });
  }

  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  // Bootstrap: the very first account on a fresh install has no one
  // to grant it admin — so it grants itself. Every signup after that
  // defaults to 'employee' (the column default); an existing admin
  // promotes people from there via the "Manage Users" panel.
  const { rows: existingCount } = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  const isBootstrap = existingCount[0].c === 0;
  const role = isBootstrap ? 'admin' : 'employee';
  // Approval gate (see 013_user_approval.sql): the bootstrap admin is
  // approved automatically — there's no one else yet who could approve
  // them. Every signup after that starts unapproved and can't log in
  // (see login() below) until an existing admin approves them.
  const isApproved = isBootstrap;

  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, notify_channel, notify_email, notify_phone, role, is_approved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, email, notify_channel, notify_email, notify_phone, role, is_approved, created_at`,
    [name, email, password_hash, notify_channel, email, notify_phone, role, isApproved]
  );

  const user = rows[0];
  // Deliberately NOT issuing a token for a not-yet-approved account —
  // the frontend doesn't auto-login after signup anyway (see
  // LoginScreen), but this keeps the API itself from ever handing out
  // a usable session before an admin has approved the account.
  res.status(201).json({
    user: publicUser(user),
    ...(isApproved ? { token: issueToken(user) } : {}),
  });
}

/**
 * POST /api/auth/login
 */
export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  // Approval gate (see 013_user_approval.sql) — correct credentials
  // aren't enough on their own; an admin has to have approved the
  // account first. Checked after the password check (not before) so
  // this never leaks whether an email/password pair is valid for an
  // account that just hasn't been approved yet.
  if (!user.is_approved) {
    return res.status(403).json({ error: 'Your account is awaiting admin approval. Please check back once an admin has approved it.' });
  }

  // Employee Status page's "Login time" column — best-effort, fire and
  // forget relative to the response: a failure here should never block
  // an otherwise-successful login.
  pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1::uuid`, [user.id])
    .catch((err) => console.warn('Could not record last_login_at for', user.id, err.message));

  res.json({ token: issueToken(user), user: publicUser(user) });
}

/**
 * POST /api/auth/logout
 * Records "Logoff time" for the Employee Status page. Since sessions
 * here are stateless JWTs (no server-side session to actually
 * invalidate), this is a best-effort timestamp only — it depends on
 * the frontend calling this before discarding its token (see App.jsx's
 * onLogout). A browser crash/force-quit/manually-cleared token will
 * never call this, same limitation any client-driven logout tracking
 * has without a server-side session store.
 */
export async function logout(req, res) {
  await pool.query(`UPDATE users SET last_logout_at = now() WHERE id = $1::uuid`, [req.user.id]);
  res.json({ ok: true });
}

/**
 * GET /api/auth/me
 * Returns the logged-in user's profile — used on page load to restore
 * the session from a stored token.
 */
export async function getCurrentUser(req, res) {
  const { rows } = await pool.query(
    `SELECT id, name, email, notify_channel, notify_email, notify_phone, role, is_approved, created_at FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
  res.json(rows[0]);
}

/**
 * PATCH /api/auth/notification-settings
 * Lets a logged-in user connect/change how they receive delivery and
 * payment alerts — their Gmail address or a phone number for SMS.
 */
export async function updateNotificationSettings(req, res) {
  const { notify_channel, notify_email, notify_phone } = req.body;

  if (!['email', 'sms'].includes(notify_channel)) {
    return res.status(400).json({ error: 'notify_channel must be "email" or "sms".' });
  }
  if (notify_channel === 'email' && !notify_email) {
    return res.status(400).json({ error: 'An email address is required for email alerts.' });
  }
  if (notify_channel === 'sms' && !notify_phone) {
    return res.status(400).json({ error: 'A phone number is required for SMS alerts.' });
  }

  const { rows } = await pool.query(
    `UPDATE users SET notify_channel = $1, notify_email = $2, notify_phone = $3
     WHERE id = $4
     RETURNING id, name, email, notify_channel, notify_email, notify_phone`,
    [notify_channel, notify_email, notify_phone, req.user.id]
  );

  res.json(rows[0]);
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * POST /api/auth/forgot-password — { email }
 * Always responds with the same generic message regardless of whether
 * the email matches an account — this is deliberate (prevents an
 * attacker from using this endpoint to discover which emails have
 * accounts here). The actual reset link, if one gets sent, always
 * goes to the account's real login email (not notify_email — that's
 * a separate, user-editable preference for delivery/payment alerts,
 * not something that should be able to hijack a password reset).
 */
export async function forgotPassword(req, res) {
  const { email } = req.body;
  const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

  if (!email) return res.json(genericResponse);

  const { rows } = await pool.query(`SELECT id, email FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  if (!user) return res.json(genericResponse); // don't reveal whether the account exists

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)`,
    [user.id, hashToken(rawToken), expiresAt]
  );

  const resetLink = `${process.env.FRONTEND_ORIGIN}/?resetToken=${rawToken}`;
  const delivered = await sendPasswordResetEmail(user.email, resetLink); // best-effort — never throws, see emailService.js

  // Local/dev safety net: if Gmail isn't configured correctly yet (or
  // this is just local testing), the link still needs to reach
  // *someone* — print it to the backend terminal rather than leaving
  // this a silent dead end. Never do this in production: it would put
  // a live reset link in plaintext logs.
  if (!delivered && process.env.NODE_ENV !== 'production') {
    console.log(`[password reset] Email delivery failed — reset link for ${user.email}:\n${resetLink}`);
  }

  res.json(genericResponse);
}

/**
 * POST /api/auth/reset-password — { token, newPassword }
 * Verifies the token by hash (never by the raw value), checks it
 * hasn't expired or already been used, then updates the password and
 * invalidates EVERY outstanding reset token for that user (not just
 * the one used) — so an old, un-clicked reset email from a prior
 * request can't be used later.
 */
export async function resetPassword(req, res) {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'A reset token and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const { rows } = await pool.query(
    `SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)]
  );
  const resetRow = rows[0];
  if (!resetRow) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const password_hash = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2::uuid`, [password_hash, resetRow.user_id]);
  await pool.query(
    `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1::uuid AND used_at IS NULL`,
    [resetRow.user_id]
  );

  res.json({ message: 'Password updated. You can now log in.' });
}

/**
 * GET /api/auth/users — admin-only. Backs the "Manage Users" panel AND
 * the Employee Status / HR Dashboard page (same underlying data — the
 * latter just also surfaces department/position/manager/login-time).
 * Pending-approval accounts sort first so an admin sees who's waiting
 * on them before scrolling through the already-approved team list.
 * manager_name is joined in read-only, purely for display — editing
 * who someone reports to goes through manager_id via
 * updateEmployeeDetails below.
 */
export async function listUsers(req, res) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.is_approved, u.created_at,
            u.department, u.position, u.manager_id, m.name AS manager_name,
            u.last_login_at, u.last_logout_at
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     ORDER BY u.is_approved ASC, u.created_at ASC`
  );
  res.json(rows);
}

const EMPLOYEE_CSV_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role', format: (v) => (v === 'admin' ? 'Admin' : 'Employee') },
  { key: 'position', label: 'Position' },
  { key: 'department', label: 'Department' },
  { key: 'manager_name', label: 'Reports To' },
  { key: 'is_approved', label: 'Status', format: (v) => (v ? 'Active' : 'Inactive') },
  { key: 'created_at', label: 'Date Added' },
  { key: 'last_login_at', label: 'Last Login' },
  { key: 'last_logout_at', label: 'Last Logoff' },
];

/**
 * GET /api/auth/users/export — admin-only. CSV of the Employee Status
 * directory — same underlying query as listUsers, just written out as
 * a file. Registered as a fixed path before any /:id-shaped route
 * would matter, same reasoning as purchases'/assets' own /export
 * endpoints.
 */
export async function exportUsers(req, res) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.is_approved, u.created_at,
            u.department, u.position, u.manager_id, m.name AS manager_name,
            u.last_login_at, u.last_logout_at
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     ORDER BY u.name ASC`
  );
  const stamp = new Date().toISOString().slice(0, 10);
  sendCsv(res, `employee-status-${stamp}.csv`, rows, EMPLOYEE_CSV_COLUMNS);
}

/**
 * PATCH /api/auth/users/:id/details — admin-only — { department?, position?, manager_id? }
 * The Employee Status page's HR fields — kept on a separate endpoint
 * from updateUserRole/updateUserApproval above so each keeps its own
 * narrow validation, same pattern purchaseController/assetController
 * use for status vs. general-edit endpoints.
 */
export async function updateEmployeeDetails(req, res) {
  const { id } = req.params;
  const { department, position, manager_id } = req.body;

  const { rows: existing } = await pool.query(`SELECT id FROM users WHERE id = $1::uuid`, [id]);
  if (!existing.length) return res.status(404).json({ error: 'User not found.' });

  let managerId = manager_id === '' || manager_id === undefined ? undefined : manager_id;
  if (managerId === null) managerId = null; // explicit "no manager"

  if (managerId) {
    if (managerId === id) {
      return res.status(400).json({ error: 'Someone cannot be their own manager.' });
    }
    // Walk the proposed manager's own chain upward — if it ever
    // reaches `id`, assigning this manager would create a cycle
    // (A reports to B reports to ... reports to A). The DB's CHECK
    // constraint only catches the direct self-reference case; a
    // multi-hop cycle has to be caught here before the UPDATE runs.
    let cursor = managerId;
    const seen = new Set();
    while (cursor) {
      if (cursor === id) {
        return res.status(400).json({ error: 'That would create a circular reporting chain.' });
      }
      if (seen.has(cursor)) break; // pre-existing cycle unrelated to this edit — don't loop forever
      seen.add(cursor);
      const { rows } = await pool.query(`SELECT manager_id FROM users WHERE id = $1::uuid`, [cursor]);
      cursor = rows[0]?.manager_id || null;
    }
    const { rows: managerExists } = await pool.query(`SELECT id FROM users WHERE id = $1::uuid`, [managerId]);
    if (!managerExists.length) return res.status(400).json({ error: 'Selected manager account not found.' });
  }

  const setClauses = [];
  const values = [];
  if (department !== undefined) { values.push(department || null); setClauses.push(`department = $${values.length}`); }
  if (position !== undefined) { values.push(position || null); setClauses.push(`position = $${values.length}`); }
  if (managerId !== undefined) { values.push(managerId); setClauses.push(`manager_id = $${values.length}`); }

  if (setClauses.length) {
    values.push(id);
    await pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${values.length}::uuid`, values);
  }

  const { rows: full } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.is_approved, u.created_at,
            u.department, u.position, u.manager_id, m.name AS manager_name,
            u.last_login_at, u.last_logout_at
     FROM users u LEFT JOIN users m ON m.id = u.manager_id
     WHERE u.id = $1::uuid`,
    [id]
  );
  res.json(full[0]);
}

/**
 * PATCH /api/auth/users/:id/approval — admin-only — { is_approved: boolean }
 * Grants (or revokes) a user's access to the dashboard, independent of
 * their role — see 013_user_approval.sql. Refuses to let an admin
 * revoke their own approval (that's how you'd lock yourself out with
 * no one left who could undo it, same reasoning as the last-admin
 * guard in updateUserRole below).
 */
export async function updateUserApproval(req, res) {
  const { id } = req.params;
  const { is_approved } = req.body;

  if (typeof is_approved !== 'boolean') {
    return res.status(400).json({ error: 'is_approved must be true or false.' });
  }
  if (!is_approved && id === req.user.id) {
    return res.status(400).json({ error: "You can't revoke your own access." });
  }

  const { rows } = await pool.query(
    `UPDATE users SET is_approved = $1 WHERE id = $2::uuid RETURNING id, name, email, role, is_approved, created_at`,
    [is_approved, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json(rows[0]);
}

/**
 * DELETE /api/auth/users/:id — admin-only. "Reject" in the Manage
 * Users panel — removes a signup that's still pending approval.
 * Deliberately scoped to unapproved accounts only: this isn't a
 * general "remove a teammate" tool (that has bigger implications —
 * their audit-log attribution, anything assigned to them, etc. — and
 * wasn't asked for), just a way to clear out a signup an admin has
 * decided not to let in. An already-approved account can only be
 * disabled via updateUserApproval (revoke), never deleted outright,
 * which also means this can never accidentally remove the last admin
 * — an admin is by definition already approved.
 * Same auto-cleanup a stale pending signup gets from the daily cron
 * (see trackingService.purgeStaleUnapprovedUsers) — this is just the
 * immediate, manual version of that.
 */
export async function deleteUser(req, res) {
  const { id } = req.params;

  const { rows } = await pool.query(`SELECT is_approved FROM users WHERE id = $1::uuid`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  if (rows[0].is_approved) {
    return res.status(400).json({ error: "Can't delete an approved account — revoke their access instead." });
  }

  await pool.query(`DELETE FROM users WHERE id = $1::uuid`, [id]);
  res.json({ id, deleted: true });
}

/**
 * PATCH /api/auth/users/:id/role — admin-only — { role: 'admin'|'employee' }
 * Refuses to demote the LAST remaining admin — otherwise a single
 * mis-click could lock every admin-only action in the app with no one
 * left who can undo it.
 */
export async function updateUserRole(req, res) {
  const { id } = req.params;
  const { role } = req.body;

  if (!['admin', 'editor', 'employee'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin", "editor", or "employee".' });
  }

  // Any change AWAY from admin (to editor or employee) needs this
  // guard — not just the admin->employee case — since either one
  // would otherwise be able to leave the app with zero admins left.
  if (role !== 'admin') {
    const { rows: adminCount } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND id <> $1::uuid`,
      [id]
    );
    if (adminCount[0].c === 0) {
      return res.status(400).json({ error: "Can't remove the last remaining admin." });
    }
  }

  const { rows } = await pool.query(
    `UPDATE users SET role = $1 WHERE id = $2::uuid RETURNING id, name, email, role, created_at`,
    [role, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json(rows[0]);
}
