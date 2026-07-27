// =====================================================================
// employeeController.js
// Employees are who assets get assigned to. There is deliberately NO
// hard-delete endpoint — "removing" someone sets is_active = false,
// which just hides them from the assignment dropdown. Combined with
// the employee_name_snapshot column on asset_holdings, this is what
// satisfies "if an employee is deleted, their name remains in the
// asset's historical audit trail": the employees row itself is never
// actually gone, and even in a hypothetical direct-DB hard delete, the
// snapshot on each holding record would still read correctly since
// employee_id is ON DELETE SET NULL rather than CASCADE.
// =====================================================================
import { pool } from '../config/db.js';

/**
 * GET /api/employees?activeOnly=true
 * Powers the assignment dropdown/autocomplete.
 */
export async function listEmployees(req, res) {
  const activeOnly = req.query.activeOnly !== 'false';
  const { rows } = await pool.query(
    activeOnly
      ? `SELECT id, name, department, email, is_active FROM employees WHERE is_active = true ORDER BY name`
      : `SELECT id, name, department, email, is_active FROM employees ORDER BY name`
  );
  res.json(rows);
}

/**
 * Finds an employee by name (case-insensitive, active only) or creates
 * one — same free-text-with-autocomplete pattern used for vendors and
 * locations elsewhere in this app. Reactivates a previously-deactivated
 * employee of the same name rather than creating a duplicate row.
 */
export async function findOrCreateEmployee(name, department) {
  const trimmed = name.trim();
  const existing = await pool.query(`SELECT id FROM employees WHERE LOWER(name) = LOWER($1::text)`, [trimmed]);

  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await pool.query(
      `UPDATE employees SET is_active = true, department = COALESCE(employees.department, $1::text) WHERE id = $2::uuid`,
      [department || null, id]
    );
    return id;
  }

  const created = await pool.query(
    `INSERT INTO employees (name, department) VALUES ($1::text, $2::text) RETURNING id`,
    [trimmed, department || null]
  );
  return created.rows[0].id;
}

/** POST /api/employees — manual creation (rarely needed; findOrCreateEmployee covers the common path). */
export async function createEmployee(req, res) {
  const { name, department, email } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Employee name is required.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO employees (name, department, email) VALUES ($1::text, $2::text, $3::text) RETURNING id`,
    [name.trim(), department || null, email || null]
  );
  res.status(201).json({ id: rows[0].id });
}

/** PATCH /api/employees/:id/deactivate — soft delete. */
export async function deactivateEmployee(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE employees SET is_active = false WHERE id = $1::uuid RETURNING id`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Employee not found.' });
  res.json({ id, deactivated: true });
}
