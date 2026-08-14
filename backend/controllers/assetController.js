// =====================================================================
// assetController.js
// Business logic behind /api/assets — the Inventory & Asset Assignment
// module. Independent of purchaseController.js by design (separate
// subsystem), but follows the same conventions established there:
// explicit ::casts on every query parameter, nullIfEmpty() for
// optional date/uuid fields, and transactions wherever more than one
// table needs to change atomically.
//
// State machine (dry-run notes — see the README for the full writeup):
//   available  --assign-------------> in_use
//   available  --dispatch-repair----> under_repair
//   in_use     --dispatch-repair----> under_repair   (auto-closes the open employee holding first)
//   in_use     --return-------------> available | under_repair (admin's choice via resulting_status)
//   under_repair --return-----------> available | under_repair (admin's choice — "still broken, keep repairing")
//   any (not retired) --retire------> retired   (auto-closes any open holding)
//   retired    --restore------------> available (simple admin override, no holding implications)
//
// "assign" and "dispatch-repair" are blocked outright (400) when status
// is 'under_repair' or 'retired', per the spec. The database's partial
// unique index (one open holding per asset) is the final backstop
// against two concurrent requests both trying to open a holding — if
// that race is lost, the loser gets a clean 409 instead of silently
// clobbering who has the asset.
// =====================================================================
import { pool } from '../config/db.js';
import { findOrCreateEmployee } from './employeeController.js';
import { publicPathFor, processAndSaveFile, UPLOAD_ROOT } from '../middleware/upload.js';
import { sendCsv, parseCsv } from '../utils/csv.js';
import { generateUniqueLocationCode } from '../utils/poNumber.js';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const SORTABLE_COLUMNS = new Set([
  'asset_name', 'vendor_name', 'purchase_date', 'cost', 'warranty_expiry', 'status', 'amc_end_date',
]);

function nullIfEmpty(value) {
  return value === '' || value === undefined ? null : value;
}

function parseAmount(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined; // undefined = invalid
}

async function findOrCreateVendor(name, { gst_number, address, phone } = {}) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  const existing = await pool.query(`SELECT id FROM vendors WHERE LOWER(name) = LOWER($1::text)`, [trimmed]);

  if (existing.rows.length) {
    const id = existing.rows[0].id;
    if (gst_number || address || phone) {
      await pool.query(
        `UPDATE vendors SET
           gst_number = COALESCE(vendors.gst_number, $1::text),
           address = COALESCE(vendors.address, $2::text),
           contact_phone = COALESCE(vendors.contact_phone, $3::text)
         WHERE id = $4::uuid`,
        [gst_number || null, address || null, phone || null, id]
      );
    }
    return id;
  }
  const created = await pool.query(
    `INSERT INTO vendors (name, gst_number, address, contact_phone) VALUES ($1::text, $2::text, $3::text, $4::text) RETURNING id`,
    [trimmed, gst_number || null, address || null, phone || null]
  );
  return created.rows[0].id;
}

async function findOrCreateLocation(name, { address, gst_number } = {}) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  const existing = await pool.query(`SELECT id FROM locations WHERE LOWER(name) = LOWER($1::text)`, [trimmed]);

  if (existing.rows.length) {
    const id = existing.rows[0].id;
    if (address || gst_number) {
      await pool.query(
        `UPDATE locations SET
           address = COALESCE(locations.address, $1::text),
           gst_number = COALESCE(locations.gst_number, $2::text)
         WHERE id = $3::uuid`,
        [address || null, gst_number || null, id]
      );
    }
    return id;
  }
  const code = await generateUniqueLocationCode(trimmed);
  const created = await pool.query(
    `INSERT INTO locations (name, address, gst_number, code) VALUES ($1::text, $2::text, $3::text, $4::text) RETURNING id`,
    [trimmed, address || null, gst_number || null, code]
  );
  return created.rows[0].id;
}

/**
 * Auto-link: Successful Order History and Inventory Management track
 * the SAME physical item from two different angles — order/financial
 * lifecycle vs. custody/maintenance lifecycle — so once units of a
 * purchase are actually delivered they should show up in Inventory
 * automatically instead of someone re-typing them in by hand.
 *
 * Called from two places:
 *  - trackingService.applyStatusUpdate, when a purchase transitions
 *    straight to 'delivered' (the whole order arrived at once) —
 *    creates assets for whatever's left of `quantity`.
 *  - purchaseController.recordPartialDelivery, for a split delivery
 *    ("40 ordered, 10 arrive now, 30 later") — creates assets for just
 *    the newly-delivered `unitsToCreate` count.
 *
 * Incremental and idempotent by construction: it counts how many
 * asset rows already exist for this purchase_id and only ever creates
 * the DELTA up to either `unitsToCreate` (if given) or the remaining
 * quantity — so calling it again after a partial delivery, or a status
 * flapping back and forth, can never create more assets than were
 * actually ordered, and never duplicates units already created by an
 * earlier partial delivery.
 *
 * Bulk orders: each unit gets its own asset row (not one row for the
 * whole batch) since each physical item needs its own status/holder/
 * AMC once it's in Inventory. Cost is split evenly per unit. Units
 * share the same purchase_id, which the Inventory UI uses to group
 * them into one collapsible batch — see InventoryPage.jsx. Each unit
 * also gets an auto-generated Asset Tag (e.g. "PO-3F9A2C-01"),
 * continuing the numbering from however many units already exist, so
 * tags never collide across multiple partial deliveries.
 */
export async function ensureAssetFromPurchase(purchase, unitsToCreate = null) {
  if (!purchase?.id) return [];

  // Approval workflow guard (018_asset_approval_workflow.sql): a
  // purchase that hasn't been approved yet never gets auto-linked
  // into Inventory, no matter which of the four call sites (create,
  // batch create, partial delivery, courier status update) got here —
  // this single choke point is safer than gating each caller
  // separately. Once approvePurchase actually approves it, it
  // re-fetches the row and calls this function again itself, which
  // then proceeds normally (and is naturally idempotent/incremental,
  // so it only ever creates the units that were deferred, never
  // duplicates).
  if (purchase.approval_status && purchase.approval_status !== 'approved') return [];

  // BUGFIX (Step 4 — bulk order + partial delivery + inventory delete):
  // the unit number baked into each auto-generated Asset Tag
  // ("PO-XXXXXX-01", "-02", ...) used to be derived from a live
  // COUNT(*) of surviving `assets` rows for this purchase_id. That's
  // fine until an admin deletes ONE unit from Inventory mid-way through
  // a multi-delivery bulk order: the count drops, but the *tags already
  // issued* to the surviving sibling units don't change. The next
  // partial delivery would then recompute a "next" unit number that's
  // still in use by one of those siblings, the INSERT would hit the
  // assets_asset_tag_key UNIQUE constraint, ensureAssetFromPurchase
  // would throw, and — since the caller only logs that error — NONE of
  // the newly-delivered units for that call would ever reach Inventory,
  // even though purchases.delivered_quantity had already moved on.
  //
  // Fix: number new units off the HIGHEST unit number ever issued for
  // this purchase (parsed back out of existing asset_tag values), which
  // only ever goes up and is immune to rows being deleted later. The
  // COUNT is still used — unchanged — to cap how many NEW rows are
  // created so a purchase can never end up with more asset rows than
  // were actually ordered.
  const { rows: existing } = await pool.query(
    `SELECT
        COUNT(*)::int AS c,
        COALESCE(MAX((regexp_match(asset_tag, '(\\d+)$'))[1]::int), 0) AS max_unit
     FROM assets WHERE purchase_id = $1::uuid`,
    [purchase.id]
  );
  const alreadyCreated = existing[0].c;
  const maxUnitIssued = existing[0].max_unit;
  const totalQuantity = Math.max(1, parseInt(purchase.quantity, 10) || 1);

  // BUGFIX (approve-before-delivery): this used to cap at
  // totalQuantity — how many units were ORDERED — regardless of how
  // many had actually arrived. That meant approving a purchase that
  // was still just "ordered" (or only 3 of 10 partially delivered)
  // immediately created assets for the FULL ordered quantity, since
  // approvePurchase calls this unconditionally on every approval with
  // no unitsToCreate cap. Inventory Management would then show all 10
  // units days before delivery, while Order History correctly still
  // excluded the purchase entirely (order_status stays 'ordered' /
  // 'partially_delivered' until the real quantity arrives) — exactly
  // the kind of cross-page mismatch this function exists to prevent.
  // Capping at delivered_quantity instead means nothing is created
  // for a purchase with nothing confirmed as delivered yet (0 remains
  // 0 no matter how many times approval or a status refresh calls
  // this), and a partial delivery of 3-of-10 creates exactly 3 —
  // matching Order History's own delivered_quantity/quantity figure
  // for that same purchase — regardless of which of the five call
  // sites (create, batch create, approve, partial delivery, courier
  // status update) triggered it or in what order.
  const deliveredQuantity = Math.max(0, parseInt(purchase.delivered_quantity, 10) || 0);
  const remaining = Math.min(deliveredQuantity, totalQuantity) - alreadyCreated;
  const countToCreate = unitsToCreate != null ? Math.min(parseInt(unitsToCreate, 10) || 0, remaining) : remaining;
  if (countToCreate <= 0) return [];

  const vendorId = purchase.vendor_name ? await findOrCreateVendor(purchase.vendor_name) : null;
  const unitCost = totalQuantity > 1
    ? Math.round((Number(purchase.total_cost) / totalQuantity) * 100) / 100
    : purchase.total_cost;
  const purchaseRef = purchase.id.replace(/-/g, '').slice(0, 6).toUpperCase();

  const insertedIds = [];
  for (let i = 1; i <= countToCreate; i++) {
    const unitNumber = maxUnitIssued + i; // never reuses a tag number still held by a surviving sibling unit
    const autoTag = totalQuantity > 1 ? `PO-${purchaseRef}-${String(unitNumber).padStart(2, '0')}` : null;
    const { rows } = await pool.query(
      `INSERT INTO assets (asset_name, purchase_id, vendor_id, purchase_date, cost, asset_tag, approval_status, created_by, approved_by, approved_at, po_number, location, location_id)
       VALUES ($1::text, $2::uuid, $3::uuid, $4::date, $5::numeric, $6::text, 'approved', $7::uuid, $8::uuid, now(), $9::text, $10::text, $11::uuid)
       RETURNING id`,
      [
        purchase.item_name,
        purchase.id,
        vendorId,
        purchase.actual_delivery_date || purchase.order_date || null,
        unitCost,
        autoTag,
        purchase.created_by || null,
        purchase.approved_by || null,
        purchase.po_number || null,
        purchase.delivery_location || null,
        purchase.delivery_location_id || null,
      ]
    );
    insertedIds.push(rows[0].id);
  }
  return insertedIds;
}

/**
 * GET /api/assets — search (?q=), status filter (?status=), sort.
 */
export async function listAssets(req, res) {
  const { q, status, sortBy = 'asset_name', sortDir = 'asc' } = req.query;

  const clauses = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(asset_name ILIKE $${params.length}::text OR vendor_name ILIKE $${params.length}::text OR serial_number ILIKE $${params.length}::text OR model_number ILIKE $${params.length}::text OR asset_tag ILIKE $${params.length}::text OR location ILIKE $${params.length}::text)`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}::text`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const safeSortBy = SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'asset_name';
  const safeSortDir = sortDir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { rows } = await pool.query(
    `SELECT * FROM asset_summary ${where} ORDER BY ${safeSortBy} ${safeSortDir} NULLS LAST`,
    params
  );
  res.json(rows);
}

const ASSET_CSV_COLUMNS = [
  { key: 'asset_name', label: 'Asset Name' },
  { key: 'category', label: 'Category' },
  { key: 'serial_number', label: 'Serial Number' },
  { key: 'model_number', label: 'Model Number' },
  { key: 'asset_tag', label: 'Asset Tag' },
  { key: 'location', label: 'Location' },
  { key: 'vendor_name', label: 'Vendor' },
  { key: 'purchase_date', label: 'Purchase Date' },
  { key: 'cost', label: 'Cost (before tax)' },
  { key: 'tax_percent', label: 'Tax %' },
  { key: 'cost_with_tax', label: 'Cost (incl. Tax)' },
  { key: 'warranty_expiry', label: 'Warranty Expiry' },
  { key: 'useful_life_years', label: 'Useful Life (Years)' },
  { key: 'current_book_value', label: 'Current Book Value' },
  { key: 'status', label: 'Status', format: (v) => (v ? v.replace('_', ' ') : v) },
  { key: 'current_employee_name', label: 'Current Holder (Employee)' },
  { key: 'current_repair_vendor', label: 'Current Holder (Repair Vendor)' },
  { key: 'amc_provider', label: 'AMC Provider' },
  { key: 'amc_start_date', label: 'AMC Start Date' },
  { key: 'amc_end_date', label: 'AMC End Date' },
  { key: 'amc_cost', label: 'AMC Cost' },
];

/**
 * GET /api/assets/export?q=&status=
 * CSV of every matching asset — same filters as listAssets. Not
 * paginated (the Inventory grid itself isn't either — see README
 * section 12), so this is simply "everything currently on screen".
 */
export async function exportAssets(req, res) {
  const { q, status } = req.query;

  const clauses = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(asset_name ILIKE $${params.length}::text OR vendor_name ILIKE $${params.length}::text OR serial_number ILIKE $${params.length}::text OR model_number ILIKE $${params.length}::text OR asset_tag ILIKE $${params.length}::text OR location ILIKE $${params.length}::text)`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}::text`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT * FROM asset_summary ${where} ORDER BY asset_name ASC`,
    params
  );

  const stamp = new Date().toISOString().slice(0, 10);
  sendCsv(res, `inventory-assets-${stamp}.csv`, rows, ASSET_CSV_COLUMNS);
}

// Maps a CSV header (lowercased) to the asset field it fills — kept
// separate from ASSET_CSV_COLUMNS since not every exportable column
// makes sense to import (Status/Holder are workflow outcomes, not
// something you'd set by hand in a spreadsheet).
const IMPORT_COLUMN_MAP = {
  'asset name': 'asset_name',
  'category': 'category',
  'serial number': 'serial_number',
  'model number': 'model_number',
  'asset tag': 'asset_tag',
  'location': 'location',
  'vendor': 'vendor_name',
  'purchase date': 'purchase_date',
  'cost': 'cost',
  'tax percent': 'tax_percent',
  'tax %': 'tax_percent',
  'warranty expiry': 'warranty_expiry',
  'useful life (years)': 'useful_life_years',
  'amc provider': 'amc_provider',
  'amc start date': 'amc_start_date',
  'amc end date': 'amc_end_date',
  'amc cost': 'amc_cost',
};

/**
 * POST /api/assets/import — { csv: "<raw CSV file contents>" }
 * Bulk-loads assets from a spreadsheet someone already has (the usual
 * on-ramp when adopting a new system with existing inventory). Column
 * headers are matched case-insensitively against IMPORT_COLUMN_MAP —
 * unrecognized columns are silently ignored rather than erroring, so
 * an export from THIS app's own "Export CSV" (which has extra
 * Status/Holder/etc. columns) can be re-imported as-is.
 *
 * Every row is processed independently and reported back with its own
 * success/error (same "partial success" shape as the file-upload
 * endpoints) — one bad row (missing name, duplicate Asset Tag, bad
 * Cost) never blocks the rest of the file from importing.
 */
export async function importAssets(req, res) {
  const { csv } = req.body;
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'No CSV content received.' });
  }

  const parsedRows = parseCsv(csv);
  if (!parsedRows.length) {
    return res.status(400).json({ error: 'That CSV file has no data rows.' });
  }
  if (parsedRows.length > 500) {
    return res.status(400).json({ error: 'Import is limited to 500 rows at a time — split into smaller files.' });
  }

  const results = [];
  for (let i = 0; i < parsedRows.length; i++) {
    const raw = parsedRows[i];
    const rowNumber = i + 2; // header is row 1; data rows are 1-indexed for the user, not 0-indexed
    const mapped = {};
    for (const [rawHeader, value] of Object.entries(raw)) {
      const key = IMPORT_COLUMN_MAP[rawHeader.trim().toLowerCase()];
      if (key) mapped[key] = value;
    }

    if (!mapped.asset_name || !mapped.asset_name.trim()) {
      results.push({ row: rowNumber, success: false, error: 'Missing Asset Name.' });
      continue;
    }

    const parsedCost = parseAmount(mapped.cost);
    if (parsedCost === undefined) {
      results.push({ row: rowNumber, success: false, error: 'Invalid Cost value.' });
      continue;
    }
    const parsedAmcCost = parseAmount(mapped.amc_cost);
    if (parsedAmcCost === undefined) {
      results.push({ row: rowNumber, success: false, error: 'Invalid AMC Cost value.' });
      continue;
    }
    const parsedTaxPercent = parseAmount(mapped.tax_percent);
    if (parsedTaxPercent === undefined) {
      results.push({ row: rowNumber, success: false, error: 'Invalid Tax % value.' });
      continue;
    }
    let parsedUsefulLife = null;
    if (mapped.useful_life_years) {
      const n = parseInt(mapped.useful_life_years, 10);
      if (!Number.isInteger(n) || n <= 0) {
        results.push({ row: rowNumber, success: false, error: 'Invalid Useful Life (Years) value.' });
        continue;
      }
      parsedUsefulLife = n;
    }

    try {
      const vendorId = mapped.vendor_name ? await findOrCreateVendor(mapped.vendor_name) : null;
      await pool.query(
        `INSERT INTO assets
          (asset_name, category, serial_number, model_number, asset_tag, location, vendor_id, purchase_date, cost, tax_percent, warranty_expiry, useful_life_years,
           amc_provider, amc_start_date, amc_end_date, amc_cost)
         VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::date,$9::numeric,$10::numeric,$11::date,$12::int,$13::text,$14::date,$15::date,$16::numeric)`,
        [
          mapped.asset_name.trim(), mapped.category || null, mapped.serial_number || null, mapped.model_number || null,
          nullIfEmpty(mapped.asset_tag), mapped.location || null, vendorId,
          nullIfEmpty(mapped.purchase_date), parsedCost, parsedTaxPercent, nullIfEmpty(mapped.warranty_expiry), parsedUsefulLife,
          mapped.amc_provider || null, nullIfEmpty(mapped.amc_start_date), nullIfEmpty(mapped.amc_end_date), parsedAmcCost,
        ]
      );
      results.push({ row: rowNumber, success: true, name: mapped.asset_name.trim() });
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'assets_asset_tag_key') {
        results.push({ row: rowNumber, success: false, error: `Asset Tag "${mapped.asset_tag}" is already in use.` });
      } else {
        results.push({ row: rowNumber, success: false, error: 'Could not import this row.' });
      }
    }
  }

  res.json({ imported: results.filter((r) => r.success).length, total: results.length, results });
}
export async function getAssetSummaryCounts(req, res) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'available')::int    AS available_count,
      COUNT(*) FILTER (WHERE status = 'in_use')::int        AS in_use_count,
      COUNT(*) FILTER (WHERE status = 'under_repair')::int  AS under_repair_count,
      COUNT(*) FILTER (WHERE status = 'retired')::int       AS retired_count,
      COUNT(*) FILTER (WHERE is_amc_expiring_soon AND status <> 'retired')::int AS amc_expiring_count,
      (SELECT COALESCE(SUM(amc_cost), 0) FROM assets)                          AS total_amc_spend,
      (SELECT COALESCE(SUM(repair_cost), 0) FROM asset_holdings WHERE holder_type = 'repair') AS total_repair_spend
    FROM asset_summary
  `);
  res.json(rows[0]);
}

/**
 * GET /api/assets/:id — full detail for the drawer: the asset row,
 * EVERY holding (not just the current one — full chronological
 * history), and the field-level change log. The frontend merges the
 * two lists by timestamp for one unified History/Trail timeline.
 */
export async function getAssetDetail(req, res) {
  const { id } = req.params;

  const { rows: assetRows } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  if (!assetRows.length) return res.status(404).json({ error: 'Asset not found.' });

  const { rows: holdings } = await pool.query(
    `SELECT * FROM asset_holdings WHERE asset_id = $1::uuid ORDER BY started_at DESC, created_at DESC`,
    [id]
  );
  const { rows: changeLog } = await pool.query(
    `SELECT * FROM asset_change_log WHERE asset_id = $1::uuid ORDER BY changed_at DESC`,
    [id]
  );

  res.json({ asset: assetRows[0], holdings, changeLog });
}

/**
 * GET /api/assets/:id/qrcode — returns a PNG QR code encoding a link
 * to this asset's PUBLIC info page (routes/public.js's
 * GET /public/asset/:id — no login required, since the whole point is
 * that someone can scan the physical tag with a phone and see the
 * asset's details without needing to sign in first).
 *
 * The URL is built from the incoming request's own host
 * (req.protocol + req.get('host')) rather than a hardcoded env var —
 * this makes it correct automatically whether the backend is reached
 * at localhost:4000 in dev or a real domain in production, with
 * nothing to misconfigure.
 */
export async function getAssetQrCode(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(`SELECT id FROM assets WHERE id = $1::uuid`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Asset not found.' });

  const publicUrl = `${req.protocol}://${req.get('host')}/public/asset/${id}`;
  const png = await QRCode.toBuffer(publicUrl, { width: 320, margin: 2 });

  res.setHeader('Content-Type', 'image/png');
  res.send(png);
}

/**
 * POST /api/assets — create a new inventory item. Core purchase-style
 * fields are required; AMC fields are all optional together.
 */
export async function createAsset(req, res) {
  const {
    asset_name, category, serial_number, model_number, asset_tag, location_name, location_address, location_gst_number, vendor_name, vendor_gst_number, vendor_address, vendor_phone,
    purchase_date, cost, tax_percent, warranty_expiry, useful_life_years,
    amc_provider, amc_start_date, amc_end_date, amc_cost,
    requested_by_name, requested_by_phone, po_number,
  } = req.body;

  if (!asset_name || !asset_name.trim()) {
    return res.status(400).json({ error: 'Asset name is required.' });
  }
  if (!requested_by_name || !requested_by_name.trim()) {
    return res.status(400).json({ error: "Requester's name is required." });
  }
  if (!requested_by_phone || !requested_by_phone.trim()) {
    return res.status(400).json({ error: "Requester's phone number is required." });
  }

  const parsedCost = parseAmount(cost);
  if (parsedCost === undefined) return res.status(400).json({ error: 'Cost must be a valid non-negative number.' });
  const parsedAmcCost = parseAmount(amc_cost);
  if (parsedAmcCost === undefined) return res.status(400).json({ error: 'AMC cost must be a valid non-negative number.' });
  const parsedTaxPercent = parseAmount(tax_percent);
  if (parsedTaxPercent === undefined) return res.status(400).json({ error: 'Tax % must be a valid non-negative number.' });

  let parsedUsefulLife = null;
  if (nullIfEmpty(useful_life_years) !== null) {
    const n = parseInt(useful_life_years, 10);
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ error: 'Useful Life (Years) must be a positive whole number.' });
    }
    parsedUsefulLife = n;
  }

  // Date validation (checklist item): AMC end can't precede AMC start.
  // The DB has a matching CHECK constraint as a backstop, but this
  // gives a clear 400 instead of a raw constraint-violation message.
  if (nullIfEmpty(amc_start_date) && nullIfEmpty(amc_end_date) && amc_end_date < amc_start_date) {
    return res.status(400).json({ error: 'AMC End Date cannot be earlier than AMC Start Date.' });
  }

  const vendorId = vendor_name ? await findOrCreateVendor(vendor_name, { gst_number: vendor_gst_number, address: vendor_address, phone: vendor_phone }) : null;
  const locationId = location_name ? await findOrCreateLocation(location_name, { address: location_address, gst_number: location_gst_number }) : null;

  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO assets
        (asset_name, category, serial_number, model_number, asset_tag, location, location_id, vendor_id, purchase_date, cost, tax_percent, warranty_expiry, useful_life_years,
         amc_provider, amc_start_date, amc_end_date, amc_cost, approval_status, created_by, requested_by_name, requested_by_phone, po_number)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::uuid,$9::date,$10::numeric,$11::numeric,$12::date,$13::int,$14::text,$15::date,$16::date,$17::numeric,'pending',$18::uuid,$19::text,$20::text,$21::text)
       RETURNING id`,
      [asset_name.trim(), category || null, serial_number || null, model_number || null, nullIfEmpty(asset_tag), location_name || null, locationId, vendorId,
       nullIfEmpty(purchase_date), parsedCost, parsedTaxPercent, nullIfEmpty(warranty_expiry), parsedUsefulLife,
       amc_provider || null, nullIfEmpty(amc_start_date), nullIfEmpty(amc_end_date), parsedAmcCost,
       req.user?.id || null, requested_by_name.trim(), requested_by_phone.trim(), nullIfEmpty(po_number)]
    ));
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'assets_asset_tag_key') {
      return res.status(400).json({ error: 'That Asset Tag is already in use on another asset.' });
    }
    throw err;
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [rows[0].id]);
  res.status(201).json(full[0]);
}

/**
 * PATCH /api/assets/:id/approve — { approved: true|false, reason? }
 * Admin/senior-only (see requireAdminOrSenior in middleware/auth.js).
 * Only meaningful for an asset created directly via "New Asset" here
 * in Inventory — an asset auto-linked from an already-approved
 * purchase is inserted pre-approved (see ensureAssetFromPurchase) and
 * never reaches this endpoint in a 'pending' state.
 */
export async function approveAsset(req, res) {
  const { id } = req.params;
  const { approved, reason } = req.body;

  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approved must be true or false.' });
  }

  const { rows: existing } = await pool.query(`SELECT id, approval_status FROM assets WHERE id = $1::uuid`, [id]);
  if (!existing.length) return res.status(404).json({ error: 'Asset not found.' });
  if (existing[0].approval_status !== 'pending') {
    return res.status(400).json({ error: `This asset was already ${existing[0].approval_status}.` });
  }

  await pool.query(
    `UPDATE assets
     SET approval_status = $1::text, approved_by = $2::uuid, approved_at = now(), rejection_reason = $3::text
     WHERE id = $4::uuid`,
    [approved ? 'approved' : 'rejected', req.user?.id || null, approved ? null : (reason || null), id]
  );

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

// Fields eligible for change-log tracking on update — deliberately a
// whitelist (not "every column") so internal bookkeeping fields like
// updated_at never spam the timeline.
const TRACKED_FIELDS = [
  'asset_name', 'category', 'serial_number', 'model_number', 'asset_tag', 'location', 'location_id', 'vendor_id', 'purchase_date', 'cost', 'tax_percent', 'warranty_expiry',
  'useful_life_years', 'amc_provider', 'amc_start_date', 'amc_end_date', 'amc_cost',
];

/**
 * PATCH /api/assets/:id — edits core/AMC details. Every changed field
 * is diffed against the current row and written to asset_change_log,
 * one row per field, in the SAME transaction as the update itself —
 * so the visible data and its audit trail can never disagree about
 * what changed.
 */
export async function updateAsset(req, res) {
  const { id } = req.params;
  const body = { ...req.body };

  if (body.vendor_name !== undefined) {
    body.vendor_id = body.vendor_name ? await findOrCreateVendor(body.vendor_name, { gst_number: body.vendor_gst_number, address: body.vendor_address, phone: body.vendor_phone }) : null;
    delete body.vendor_name;
  }
  delete body.vendor_gst_number;
  delete body.vendor_address;
  delete body.vendor_phone;

  if (body.location_name !== undefined) {
    body.location_id = body.location_name ? await findOrCreateLocation(body.location_name, { address: body.location_address, gst_number: body.location_gst_number }) : null;
    body.location = body.location_name;
    delete body.location_name;
  }
  delete body.location_address;
  delete body.location_gst_number;

  if (body.cost !== undefined) {
    const parsed = parseAmount(body.cost);
    if (parsed === undefined) return res.status(400).json({ error: 'Cost must be a valid non-negative number.' });
    body.cost = parsed;
  }
  if (body.amc_cost !== undefined) {
    const parsed = parseAmount(body.amc_cost);
    if (parsed === undefined) return res.status(400).json({ error: 'AMC cost must be a valid non-negative number.' });
    body.amc_cost = parsed;
  }
  if (body.tax_percent !== undefined) {
    const parsed = parseAmount(body.tax_percent);
    if (parsed === undefined) return res.status(400).json({ error: 'Tax % must be a valid non-negative number.' });
    body.tax_percent = parsed;
  }
  for (const dateField of ['purchase_date', 'warranty_expiry', 'amc_start_date', 'amc_end_date']) {
    if (body[dateField] !== undefined) body[dateField] = nullIfEmpty(body[dateField]);
  }
  if (body.asset_tag !== undefined) body.asset_tag = nullIfEmpty(body.asset_tag);
  if (body.useful_life_years !== undefined) {
    const normalized = nullIfEmpty(body.useful_life_years);
    if (normalized !== null) {
      const n = parseInt(normalized, 10);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({ error: 'Useful Life (Years) must be a positive whole number.' });
      }
      body.useful_life_years = n;
    } else {
      body.useful_life_years = null;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(`SELECT * FROM assets WHERE id = $1::uuid FOR UPDATE`, [id]);
    const current = currentRows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Asset not found.' });
    }

    // Validate AMC date order against the POST-UPDATE values (mix of
    // whatever changed plus whatever stayed the same).
    const effectiveAmcStart = body.amc_start_date !== undefined ? body.amc_start_date : current.amc_start_date;
    const effectiveAmcEnd = body.amc_end_date !== undefined ? body.amc_end_date : current.amc_end_date;
    if (effectiveAmcStart && effectiveAmcEnd && effectiveAmcEnd < effectiveAmcStart) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'AMC End Date cannot be earlier than AMC Start Date.' });
    }

    const setClauses = [];
    const values = [];
    const logEntries = [];
    const NUMERIC_FIELDS = new Set(['cost', 'amc_cost', 'tax_percent']);

    for (const field of TRACKED_FIELDS) {
      if (body[field] === undefined) continue;
      const newValue = body[field];
      const oldValue = current[field];

      // Numeric columns come back from Postgres as strings (e.g.
      // "82000.00", to avoid floating-point precision loss) — compare
      // numerically, not as strings, or a re-save with an unchanged
      // amount would false-positive as "changed" ("82000" !== "82000.00").
      // Date columns are plain 'YYYY-MM-DD' strings on both sides (see
      // config/db.js's DATE type-parser fix), so string equality is
      // correct for every other tracked field.
      const unchanged = NUMERIC_FIELDS.has(field)
        ? Number(oldValue ?? 0) === Number(newValue ?? 0) && (oldValue == null) === (newValue == null)
        : String(oldValue ?? '') === String(newValue ?? '');
      if (unchanged) continue;

      values.push(newValue);
      setClauses.push(`${field} = $${values.length}`);
      logEntries.push({ field, oldValue, newValue });
    }

    if (setClauses.length) {
      values.push(id);
      await client.query(
        `UPDATE assets SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}::uuid`,
        values
      );

      for (const entry of logEntries) {
        await client.query(
          `INSERT INTO asset_change_log (asset_id, field_name, previous_value, new_value, changed_by)
           VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::uuid)`,
          [id, entry.field, entry.oldValue == null ? null : String(entry.oldValue), entry.newValue == null ? null : String(entry.newValue), req.user?.id || null]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && err.constraint === 'assets_asset_tag_key') {
      return res.status(400).json({ error: 'That Asset Tag is already in use on another asset.' });
    }
    throw err;
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * POST /api/assets/:id/assign — { employee_name, department, location_name, started_at, expected_return_date? }
 * location_name/department/started_at are all captured as point-in-time
 * SNAPSHOTS on the holding row (same idea as employee_name_snapshot) —
 * they record what was true at assignment time and are never rewritten
 * later, even if the employee's own profile (employees.department)
 * changes afterward. started_at defaults to today when not given, same
 * as the column's own DB-level default, but is now settable so a
 * backdated assignment can be logged accurately.
 * Blocked when status is 'under_repair' or 'retired' (spec requirement).
 */
export async function assignToEmployee(req, res) {
  const { id } = req.params;
  const { employee_name, department, location_name, started_at, expected_return_date } = req.body;

  if (!employee_name || !employee_name.trim()) {
    return res.status(400).json({ error: 'An employee name is required.' });
  }

  const assignedDate = nullIfEmpty(started_at) || new Date().toISOString().slice(0, 10);
  if (expected_return_date && expected_return_date < assignedDate) {
    return res.status(400).json({ error: 'Return date cannot be earlier than the date the asset is assigned.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: assetRows } = await client.query(`SELECT status FROM assets WHERE id = $1::uuid FOR UPDATE`, [id]);
    if (!assetRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Asset not found.' });
    }
    const currentStatus = assetRows[0].status;
    if (currentStatus === 'under_repair' || currentStatus === 'retired') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot assign an asset that is currently ${currentStatus.replace('_', ' ')}.` });
    }
    if (currentStatus === 'in_use') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This asset is already assigned — return it before reassigning.' });
    }

    const employeeId = await findOrCreateEmployee(employee_name, department);
    const locationId = location_name ? await findOrCreateLocation(location_name) : null;

    await client.query(
      `INSERT INTO asset_holdings
        (asset_id, holder_type, employee_id, employee_name_snapshot, department_snapshot, location_id, location_name_snapshot, started_at, expected_return_date)
       VALUES ($1::uuid, 'employee', $2::uuid, $3::text, $4::text, $5::uuid, $6::text, $7::date, $8::date)`,
      [id, employeeId, employee_name.trim(), department || null, locationId, location_name || null, assignedDate, nullIfEmpty(expected_return_date)]
    );
    await client.query(`UPDATE assets SET status = 'in_use', updated_at = now() WHERE id = $1::uuid`, [id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // The partial unique index (one open holding per asset) is the
    // final race-condition backstop — surface it as a clean 409
    // instead of a raw constraint-violation 500.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This asset was just assigned or dispatched by someone else — refresh and try again.' });
    }
    throw err;
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * POST /api/assets/:id/dispatch-repair — { handled_by, contact_info, expected_return_date }
 * Allowed from 'available' OR 'in_use' (a device can break while
 * someone has it) — if currently in_use, the open employee holding is
 * auto-closed in the SAME transaction first, so the audit trail shows
 * a clean end date for that assignment rather than leaving it open
 * forever underneath the new repair holding.
 */
export async function dispatchToMaintenance(req, res) {
  const { id } = req.params;
  const { handled_by, contact_info, expected_return_date } = req.body;

  if (!handled_by || !handled_by.trim()) {
    return res.status(400).json({ error: 'Technician/vendor information is required.' });
  }
  if (!expected_return_date) {
    return res.status(400).json({ error: 'An expected return date is required.' });
  }
  // Date validation (checklist item): expected return must be in the
  // future. Deliberately checked here at request time only — NOT as a
  // DB CHECK constraint, because a static "must be >= today" constraint
  // would incorrectly block legitimately CLOSING an overdue repair
  // later (the row's expected_return_date doesn't change on return,
  // but "today" has moved past it by then).
  const today = new Date().toISOString().slice(0, 10);
  if (expected_return_date <= today) {
    return res.status(400).json({ error: 'Expected return date must be in the future.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: assetRows } = await client.query(`SELECT status FROM assets WHERE id = $1::uuid FOR UPDATE`, [id]);
    if (!assetRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Asset not found.' });
    }
    const currentStatus = assetRows[0].status;
    if (currentStatus === 'under_repair' || currentStatus === 'retired') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot dispatch an asset that is currently ${currentStatus.replace('_', ' ')}.` });
    }

    if (currentStatus === 'in_use') {
      await client.query(
        `UPDATE asset_holdings SET returned_at = CURRENT_DATE, condition_note = 'Sent for repair', resulting_status = 'under_repair'
         WHERE asset_id = $1::uuid AND returned_at IS NULL`,
        [id]
      );
    }

    await client.query(
      `INSERT INTO asset_holdings (asset_id, holder_type, repair_vendor_name, repair_contact_info, expected_return_date)
       VALUES ($1::uuid, 'repair', $2::text, $3::text, $4::date)`,
      [id, handled_by.trim(), contact_info || null, expected_return_date]
    );
    await client.query(`UPDATE assets SET status = 'under_repair', updated_at = now() WHERE id = $1::uuid`, [id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This asset was just assigned or dispatched by someone else — refresh and try again.' });
    }
    throw err;
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * PATCH /api/assets/:id/return — { returned_at, condition_note, resulting_status }
 * Closes whichever holding is currently open (employee OR repair —
 * spec treats both the same way here) and sets the asset's new status
 * to whatever the admin picked based on the condition noted.
 */
export async function returnAsset(req, res) {
  const { id } = req.params;
  const { condition_note, resulting_status, repair_cost } = req.body;
  const returnedAt = nullIfEmpty(req.body.returned_at) || new Date().toISOString().slice(0, 10);

  if (!['available', 'under_repair'].includes(resulting_status)) {
    return res.status(400).json({ error: 'resulting_status must be "available" or "under_repair".' });
  }

  // Matches the frontend's date input `max` attribute — enforced here
  // too since that's only a UI hint, not a real guarantee, for anyone
  // calling this endpoint directly.
  const today = new Date().toISOString().slice(0, 10);
  if (returnedAt > today) {
    return res.status(400).json({ error: 'Return Date cannot be in the future.' });
  }

  const parsedRepairCost = parseAmount(repair_cost);
  if (parsedRepairCost === undefined) {
    return res.status(400).json({ error: 'Repair cost must be a valid non-negative number.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: openHolding } = await client.query(
      `SELECT * FROM asset_holdings WHERE asset_id = $1::uuid AND returned_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!openHolding.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "This asset isn't currently assigned or under repair." });
    }
    const holding = openHolding[0];

    // Date validation (checklist item): return date can't precede the
    // assignment's start date. The DB has a matching CHECK as a
    // backstop; this gives a clear 400 first.
    if (returnedAt < holding.started_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Return Date cannot be earlier than the assignment start date.' });
    }

    // repair_cost is only meaningful for a holding that was actually a
    // repair dispatch — silently ignored (stays NULL) for an employee
    // return, rather than erroring, since the field simply isn't shown
    // in that case on the frontend.
    await client.query(
      `UPDATE asset_holdings SET returned_at = $1::date, condition_note = $2::text, resulting_status = $3::text,
         repair_cost = CASE WHEN holder_type = 'repair' THEN $4::numeric ELSE repair_cost END
       WHERE id = $5::uuid`,
      [returnedAt, condition_note || null, resulting_status, parsedRepairCost, holding.id]
    );
    await client.query(`UPDATE assets SET status = $1::text, updated_at = now() WHERE id = $2::uuid`, [resulting_status, id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * PATCH /api/assets/:id/status — { status: 'retired' | 'available' }
 * Admin override: retiring closes any open holding automatically;
 * restoring from retired is a simple direct status change (no holding
 * implications — it's assumed to genuinely be sitting unused).
 */
export async function setAssetStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!['retired', 'available'].includes(status)) {
    return res.status(400).json({ error: 'status must be "retired" or "available" for this action.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: assetRows } = await client.query(`SELECT status FROM assets WHERE id = $1::uuid FOR UPDATE`, [id]);
    if (!assetRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Asset not found.' });
    }
    const previousStatus = assetRows[0].status;

    if (status === 'available' && previousStatus !== 'retired') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a retired asset can be restored directly to Available.' });
    }

    if (status === 'retired' && previousStatus !== 'retired') {
      await client.query(
        `UPDATE asset_holdings SET returned_at = CURRENT_DATE, condition_note = 'Retired', resulting_status = 'retired'
         WHERE asset_id = $1::uuid AND returned_at IS NULL`,
        [id]
      );
    }

    await client.query(`UPDATE assets SET status = $1::text, updated_at = now() WHERE id = $2::uuid`, [status, id]);
    await client.query(
      `INSERT INTO asset_change_log (asset_id, field_name, previous_value, new_value, changed_by)
       VALUES ($1::uuid, 'status', $2::text, $3::text, $4::uuid)`,
      [id, previousStatus, status, req.user?.id || null]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * Shared multi-file save logic for AMC contracts/invoices — mirrors
 * purchaseController.js's saveFiles: each file processed/saved
 * independently so one bad file can't lose the others.
 */
async function saveFiles(req, res, kind) {
  const { id } = req.params;

  const { rows: exists } = await pool.query(`SELECT id FROM assets WHERE id = $1::uuid`, [id]);
  if (!exists.length) return res.status(404).json({ error: 'Asset not found.' });

  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No files were uploaded (or they failed type/size validation).' });
  }

  const results = [];
  for (const file of files) {
    try {
      const saved = await processAndSaveFile(file, 'asset-files');
      await pool.query(
        `INSERT INTO asset_files (asset_id, kind, file_path, original_name, mime_type, size_bytes)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::int)`,
        [id, kind, saved.publicPath, saved.originalName, saved.mimeType, saved.sizeBytes]
      );
      results.push({ name: file.originalname, success: true });
    } catch (err) {
      console.error(`Failed to save uploaded file "${file.originalname}":`, err.message);
      results.push({ name: file.originalname, success: false, error: err.message });
    }
  }

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  const anySucceeded = results.some((r) => r.success);
  res.status(anySucceeded ? 201 : 400).json({ asset: full[0], results });
}

/** POST /api/assets/:id/amc-contracts (multipart, field "files") */
export async function saveAmcContracts(req, res) {
  return saveFiles(req, res, 'amc_contract');
}

/** POST /api/assets/:id/amc-invoices (multipart, field "files") */
export async function saveAmcInvoices(req, res) {
  return saveFiles(req, res, 'amc_invoice');
}

/** DELETE /api/assets/:id/files/:fileId */
export async function deleteAssetFile(req, res) {
  const { id, fileId } = req.params;

  const { rows } = await pool.query(
    `DELETE FROM asset_files WHERE id = $1::uuid AND asset_id = $2::uuid RETURNING file_path`,
    [fileId, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'File not found.' });

  const diskPath = path.join(UPLOAD_ROOT, rows[0].file_path.replace(/^\/uploads\//, ''));
  fs.promises.unlink(diskPath).catch((err) => console.warn(`Could not remove file ${diskPath}:`, err.message));

  const { rows: full } = await pool.query(`SELECT * FROM asset_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * DELETE /api/assets/:id — admin-only, permanent.
 * Unlike "Retire" (a soft status change — see setAssetStatus above),
 * this actually removes the asset row. Every child row (holdings,
 * change log, AMC files, notification log) cascades via ON DELETE
 * CASCADE at the DB level (see schema.sql), so the only manual
 * cleanup needed here is the physical AMC files on disk, which the DB
 * has no way to know about.
 */
export async function deleteAsset(req, res) {
  const { id } = req.params;

  const { rows: files } = await pool.query(`SELECT file_path FROM asset_files WHERE asset_id = $1::uuid`, [id]);

  const { rowCount } = await pool.query(`DELETE FROM assets WHERE id = $1::uuid`, [id]);
  if (!rowCount) return res.status(404).json({ error: 'Asset not found.' });

  for (const file of files) {
    const diskPath = path.join(UPLOAD_ROOT, file.file_path.replace(/^\/uploads\//, ''));
    fs.promises.unlink(diskPath).catch((err) => console.warn(`Could not remove file ${diskPath}:`, err.message));
  }

  res.json({ id, deleted: true });
}

/**
 * Deletes every asset tied to a given purchase (and, via cascade,
 * their holdings/change-log/files/notification rows) — used by
 * purchaseController.deletePurchase so permanently deleting an order
 * also clears out whatever units it created in Inventory, whether
 * that's one asset or the whole batch from a bulk order. Runs inside
 * the caller's transaction (pass the same `client`) so the purchase
 * and its assets disappear atomically together.
 * Returns the AMC file paths so the caller can best-effort unlink them
 * from disk after the transaction commits.
 */
export async function deleteAssetsForPurchase(client, purchaseId) {
  const { rows: files } = await client.query(
    `SELECT af.file_path FROM asset_files af JOIN assets a ON a.id = af.asset_id WHERE a.purchase_id = $1::uuid`,
    [purchaseId]
  );
  await client.query(`DELETE FROM assets WHERE purchase_id = $1::uuid`, [purchaseId]);
  return files.map((f) => f.file_path);
}

/**
 * GET /api/assets/calendar — every date-bearing event across all
 * assets: AMC end dates, warranty expiries, and open repair dispatches'
 * expected return dates. Returned as a flat list; the frontend
 * calendar component groups by day/month/week client-side — the
 * expected dataset size (a company's own asset inventory) makes that a
 * reasonable tradeoff against the complexity of server-side month
 * windowing.
 */
export async function getCalendarEvents(req, res) {
  const { rows } = await pool.query(`
    SELECT id AS asset_id, asset_name, amc_end_date AS date, 'amc_end'::text AS event_type
    FROM assets WHERE amc_end_date IS NOT NULL AND status <> 'retired'
    UNION ALL
    SELECT id AS asset_id, asset_name, warranty_expiry AS date, 'warranty_expiry'::text AS event_type
    FROM assets WHERE warranty_expiry IS NOT NULL AND status <> 'retired'
    UNION ALL
    SELECT a.id AS asset_id, a.asset_name, h.expected_return_date AS date, 'maintenance_return'::text AS event_type
    FROM asset_holdings h JOIN assets a ON a.id = h.asset_id
    WHERE h.holder_type = 'repair' AND h.returned_at IS NULL AND h.expected_return_date IS NOT NULL
    ORDER BY date ASC
  `);
  res.json(rows);
}
