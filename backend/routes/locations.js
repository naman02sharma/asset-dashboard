import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generateUniqueLocationCode } from '../utils/poNumber.js';

const router = Router();

// Powers the location autocomplete suggestions on both creation forms
// (New Asset Purchase and Inventory's New Asset) — code is the
// 3-letter PO-number prefix (see 019_po_number_generator.sql /
// utils/poNumber.js), included so the frontend can show it next to
// each suggestion without a second request.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, address, gst_number, code FROM locations ORDER BY name`);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, address, gst_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Location name is required.' });

  // code is required/unique at the DB level (see
  // 019_po_number_generator.sql) — generated here the same way as
  // findOrCreateLocation so manually-added locations get one too.
  const code = await generateUniqueLocationCode(name);
  const { rows } = await pool.query(
    `INSERT INTO locations (name, address, gst_number, code) VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, address, gst_number, code]
  );
  res.status(201).json({ id: rows[0].id, code });
}));

// PATCH /locations/:id — edit an existing location's name/address/GST
// number. Same open-to-any-logged-in-user policy as PATCH /vendors/:id,
// /purchases/:id, /assets/:id (see requireAdminOrSenior's docstring in
// middleware/auth.js for why edit itself isn't role-gated) — just
// authenticateToken, already applied at the router mount in server.js.
//
// `code` is deliberately NOT editable here — it's the 3-letter PO-number
// prefix baked into every PO number already generated for this location
// (po_<code>_<NN>, see 019_po_number_generator.sql). Changing it
// wouldn't corrupt anything retroactively (past PO numbers are stored
// as plain strings, not re-derived live), but it would make an
// existing location's PO numbers stop matching its own code, which is
// confusing for no real benefit — nobody asked to rename a code, just
// to fix a location's name/address/GST like vendors already support.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, address, gst_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Location name is required.' });

  const { rows } = await pool.query(
    `UPDATE locations SET name = $1, address = $2, gst_number = $3 WHERE id = $4::uuid RETURNING id, name, address, gst_number, code`,
    [name, address, gst_number, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Location not found.' });
  res.json(rows[0]);
}));

// GET /api/locations/overview — one row per location with purchase/
// asset counts (including how many are still pending approval) so
// the new "Location POs" page can show a picker without the frontend
// having to fetch and count everything itself.
//
// BUGFIX: purchase_count must exclude any purchase whose PO number
// already has a linked asset (ensureAssetFromPurchase auto-creates
// one on delivery+approval, inheriting the same po_number) -- the
// Location POs page's detail view already hides that purchase and
// shows only the asset for it (see LocationPosPage.jsx's
// activePurchases filter), so without this same exclusion here, this
// picker's badge count didn't match what the detail view actually
// listed once you clicked in (e.g. badge said "3", detail only showed
// 2 rows). Assets are never suppressed the other way, so asset_count
// stays a plain count.
router.get('/overview', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      l.id, l.name, l.code,
      COALESCE(pc.purchase_count, 0)::int AS purchase_count,
      COALESCE(pc.pending_purchase_count, 0)::int AS pending_purchase_count,
      COALESCE(ac.asset_count, 0)::int AS asset_count,
      COALESCE(ac.pending_asset_count, 0)::int AS pending_asset_count
    FROM locations l
    LEFT JOIN (
      SELECT p.delivery_location_id,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM assets a2 WHERE a2.po_number = p.po_number
        )) AS purchase_count,
        COUNT(*) FILTER (WHERE p.approval_status = 'pending' AND NOT EXISTS (
          SELECT 1 FROM assets a2 WHERE a2.po_number = p.po_number
        )) AS pending_purchase_count
      FROM purchases p WHERE p.archived_at IS NULL
      GROUP BY p.delivery_location_id
    ) pc ON pc.delivery_location_id = l.id
    LEFT JOIN (
      SELECT location_id,
        COUNT(*) AS asset_count,
        COUNT(*) FILTER (WHERE approval_status = 'pending') AS pending_asset_count
      FROM assets
      GROUP BY location_id
    ) ac ON ac.location_id = l.id
    ORDER BY l.name
  `);
  res.json(rows);
}));

// GET /api/locations/:id/items — every purchase + asset tied to this
// location (via delivery_location_id / location_id respectively),
// each carrying its own po_number and approval_status — the data
// source for the "Location POs" page's detail view.
router.get('/:id/items', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const loc = await pool.query(`SELECT id, name, code, address, gst_number FROM locations WHERE id = $1::uuid`, [id]);
  if (!loc.rows.length) return res.status(404).json({ error: 'Location not found.' });

  const [purchases, assets] = await Promise.all([
    pool.query(`SELECT * FROM purchase_summary WHERE delivery_location_id = $1::uuid ORDER BY created_at DESC`, [id]),
    pool.query(`SELECT * FROM asset_summary WHERE location_id = $1::uuid ORDER BY created_at DESC`, [id]),
  ]);

  res.json({ location: loc.rows[0], purchases: purchases.rows, assets: assets.rows });
}));

export default router;
