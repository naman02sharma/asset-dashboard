// =====================================================================
// purchaseController.js
// Business logic behind /api/purchases routes. Kept separate from the
// route definitions so it's easy to unit-test independent of Express.
//
// Type-safety note (dry-run pass): every query parameter below is
// explicitly cast (::uuid, ::text, ::numeric, ::date, ::boolean) even
// where the pg driver would probably infer it correctly on its own.
// This is deliberate — the classic "inconsistent types deduced for
// parameter $1" error shows up specifically when the SAME placeholder
// is reused across differently-shaped expressions (a plain assignment
// vs. a CASE WHEN comparison, for example), and explicit casts remove
// that ambiguity everywhere, not just where it's already bitten us
// once (see trackingService.js -> applyStatusUpdate for that case).
// =====================================================================
import { pool } from '../config/db.js';
import { sendPurchaseAlert } from '../services/notificationService.js';
import { applyStatusUpdate } from '../services/trackingService.js';
import { publicPathFor, processAndSaveFile, UPLOAD_ROOT } from '../middleware/upload.js';
import { sendCsv } from '../utils/csv.js';
import { ensureAssetFromPurchase, deleteAssetsForPurchase } from './assetController.js';
import { generateUniqueLocationCode, previewNextPoNumber } from '../utils/poNumber.js';
import fs from 'fs';
import path from 'path';

const SORTABLE_COLUMNS = new Set([
  'item_name', 'vendor_name', 'total_cost', 'total_cost_with_tax', 'amount_paid',
  'amount_remaining', 'expected_delivery_date', 'order_status', 'quantity',
  'actual_delivery_date', 'maintenance_date', 'po_number', 'order_date',
]);

// Converts '' (what an empty optional <input> sends) to null. Passing
// '' straight into a ::date or ::uuid cast throws
// "invalid input syntax for type date/uuid" — this is the fix for
// that class of error across every endpoint that has an optional
// date/uuid/numeric field.
function nullIfEmpty(value) {
  return value === '' || value === undefined ? null : value;
}

// 'YYYY-MM-DD' for export filenames — plain string, no timezone math
// needed since it's cosmetic (just today's date in the filename).
function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

// Parses a value the frontend sent as a financial amount, rejecting
// anything that isn't a finite, non-negative number. Returns null
// (not NaN) on failure so callers can do a simple `if (parsed === null)`
// validation check.
function parseAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * GET /api/purchases — the main dashboard.
 * Shows active, non-delivered purchases, PLUS any delivered purchase
 * whose maintenance is due within 7 days (is_maintenance_due, computed
 * in the DB view) — those reappear tagged "Maintenance" per the spec,
 * even though they otherwise live in Successful Order History.
 * Supports search (?q=), status filter (?status=), and sort.
 */
export async function listPurchases(req, res) {
  const { q, status, sortBy = 'expected_delivery_date', sortDir = 'asc' } = req.query;

  const clauses = ['archived_at IS NULL', `(order_status <> 'delivered' OR is_maintenance_due = true)`];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(item_name ILIKE $${params.length}::text OR vendor_name ILIKE $${params.length}::text)`);
  }
  if (status) {
    params.push(status);
    clauses.push(`order_status = $${params.length}::text`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const safeSortBy = SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'expected_delivery_date';
  const safeSortDir = sortDir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { rows } = await pool.query(
    `SELECT * FROM purchase_summary ${where} ORDER BY ${safeSortBy} ${safeSortDir} NULLS LAST`,
    params
  );

  res.json(rows);
}

/**
 * GET /api/purchases/completed — "Successful Order History".
 * Every delivered, non-archived purchase — this is the SAME
 * `purchases` row as when it lived on the dashboard (never copied),
 * so vendor/location/file relationships can't be dropped by the move,
 * and there's no possibility of it existing in two places at once.
 * Supports search, vendor filter, a delivery-date range, and
 * page-based pagination so the page stays fast with hundreds of rows.
 */
export async function getCompletedOrders(req, res) {
  const { q, vendor, dateFrom, dateTo } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;

  const clauses = ['archived_at IS NULL', `order_status IN ('delivered', 'partially_delivered')`];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(item_name ILIKE $${params.length}::text OR vendor_name ILIKE $${params.length}::text)`);
  }
  if (vendor) {
    params.push(vendor);
    clauses.push(`vendor_name = $${params.length}::text`);
  }
  if (nullIfEmpty(dateFrom)) {
    params.push(dateFrom);
    clauses.push(`actual_delivery_date >= $${params.length}::date`);
  }
  if (nullIfEmpty(dateTo)) {
    params.push(dateTo);
    clauses.push(`actual_delivery_date <= $${params.length}::date`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM purchase_summary ${where}`,
    params
  );
  const total = countRows[0].total;

  params.push(pageSize, offset);
  const { rows } = await pool.query(
    `SELECT * FROM purchase_summary ${where}
     ORDER BY actual_delivery_date DESC NULLS LAST
     LIMIT $${params.length - 1}::int OFFSET $${params.length}::int`,
    params
  );

  res.json({ rows, total, page, pageSize });
}

// --- CSV export column definitions (shared by both export endpoints below) ---
const PURCHASE_CSV_COLUMNS = [
  { key: 'item_name', label: 'Item Name' },
  { key: 'po_number', label: 'PO Number' },
  { key: 'description', label: 'Description' },
  { key: 'vendor_name', label: 'Vendor' },
  { key: 'vendor_gst_number', label: 'Vendor GST' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'delivered_quantity', label: 'Delivered Quantity' },
  { key: 'unit_cost', label: 'Unit Cost' },
  { key: 'total_cost', label: 'Total Cost (before tax)' },
  { key: 'tax_percent', label: 'Tax %' },
  { key: 'total_cost_with_tax', label: 'Total Cost (incl. Tax)' },
  { key: 'amount_paid', label: 'Amount Paid' },
  { key: 'amount_remaining', label: 'Amount Remaining' },
  { key: 'order_status', label: 'Status' },
  { key: 'order_date', label: 'Order Date' },
  { key: 'expected_delivery_date', label: 'Expected Delivery Date' },
  { key: 'actual_delivery_date', label: 'Actual Delivery Date' },
  { key: 'delivery_location', label: 'Delivery Location' },
  { key: 'insurance_done', label: 'Insured', format: (v) => (v ? 'Yes' : 'No') },
  { key: 'maintenance_date', label: 'Next Maintenance Date' },
];

/**
 * GET /api/purchases/export?q=&status=&sortBy=&sortDir=
 * CSV of exactly what the Home Dashboard shows right now — same
 * filters as listPurchases, just written out as a file instead of
 * JSON. No pagination concern here since the Dashboard itself isn't
 * paginated (see README section 12 for why).
 */
export async function exportPurchases(req, res) {
  const { q, status, sortBy = 'expected_delivery_date', sortDir = 'asc' } = req.query;

  const clauses = ['archived_at IS NULL', `(order_status <> 'delivered' OR is_maintenance_due = true)`];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(item_name ILIKE $${params.length}::text OR vendor_name ILIKE $${params.length}::text)`);
  }
  if (status) {
    params.push(status);
    clauses.push(`order_status = $${params.length}::text`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const safeSortBy = SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'expected_delivery_date';
  const safeSortDir = sortDir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { rows } = await pool.query(
    `SELECT * FROM purchase_summary ${where} ORDER BY ${safeSortBy} ${safeSortDir} NULLS LAST`,
    params
  );

  sendCsv(res, `asset-purchases-${todayStamp()}.csv`, rows, PURCHASE_CSV_COLUMNS);
}

/**
 * GET /api/purchases/completed/export?q=&vendor=&dateFrom=&dateTo=
 * CSV of EVERY matching completed order — deliberately ignores
 * page/pageSize (unlike getCompletedOrders' JSON response, which is
 * paginated for on-screen performance). An export is a one-time file
 * the user wants everything in, not just what's currently on screen.
 */
export async function exportCompletedOrders(req, res) {
  const { q, vendor, dateFrom, dateTo } = req.query;

  const clauses = ['archived_at IS NULL', `order_status IN ('delivered', 'partially_delivered')`];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(item_name ILIKE $${params.length}::text OR vendor_name ILIKE $${params.length}::text)`);
  }
  if (vendor) {
    params.push(vendor);
    clauses.push(`vendor_name = $${params.length}::text`);
  }
  if (nullIfEmpty(dateFrom)) {
    params.push(dateFrom);
    clauses.push(`actual_delivery_date >= $${params.length}::date`);
  }
  if (nullIfEmpty(dateTo)) {
    params.push(dateTo);
    clauses.push(`actual_delivery_date <= $${params.length}::date`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;

  const { rows } = await pool.query(
    `SELECT * FROM purchase_summary ${where} ORDER BY actual_delivery_date DESC NULLS LAST`,
    params
  );

  sendCsv(res, `successful-order-history-${todayStamp()}.csv`, rows, PURCHASE_CSV_COLUMNS);
}

/**
 * GET /api/purchases/history
 * Purchases that were "moved to history" (soft-deleted) within the
 * last 3 months. Anything older is permanently purged by the daily
 * cron job — see trackingService.js -> purgeOldHistory().
 * NOTE: this is unrelated to Successful Order History above — this is
 * for manually deleted items, kept recoverable for a while.
 */
export async function getPurchaseHistory(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM purchase_summary
     WHERE archived_at IS NOT NULL AND archived_at > now() - interval '3 months'
     ORDER BY archived_at DESC`
  );
  res.json(rows);
}

/**
 * GET /api/purchases/summary
 * Powers the four (now six) KPI cards. Counts ALL active purchases
 * (including delivered/completed ones) toward total spend — completed
 * purchases still represent real money spent — but only counts
 * non-delivered ones toward "Pending Deliveries".
 *
 * pending_delivery_amount_remaining / upcoming_maintenance_cost exist
 * separately from total_remaining because that figure blends together
 * balance due on EVERY active purchase (delivered ones included) —
 * it can't answer "how much do I still owe on things I'm waiting on"
 * or "what's coming up in maintenance spend" on its own.
 */
export async function getPurchaseSummary(req, res) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(total_cost_with_tax), 0) AS total_value,
      COALESCE(SUM(amount_paid), 0)      AS total_paid,
      COALESCE(SUM(amount_remaining), 0) AS total_remaining,
      COUNT(*) FILTER (WHERE order_status NOT IN ('delivered', 'cancelled')) AS pending_deliveries,
      COUNT(*) FILTER (WHERE is_maintenance_due) AS maintenance_due_count,
      -- Balance still owed specifically on orders not yet delivered —
      -- what you'll actually need to pay out as those deliveries land.
      COALESCE(SUM(amount_remaining) FILTER (WHERE order_status NOT IN ('delivered', 'cancelled')), 0)
        AS pending_delivery_amount_remaining,
      -- Cost of maintenance that's been scheduled but not yet
      -- performed (maintenance_status = 'scheduled' always means
      -- still-upcoming — it flips to 'completed' once done, see
      -- schema.sql) — regardless of how soon it falls due, unlike
      -- maintenance_due_count above which is only the next-7-days
      -- subset used for the dashboard alert banner.
      COALESCE(SUM(maintenance_cost) FILTER (WHERE maintenance_status = 'scheduled'), 0)
        AS upcoming_maintenance_cost,
      COUNT(*) FILTER (WHERE maintenance_status = 'scheduled') AS upcoming_maintenance_count
    FROM purchase_summary
    WHERE archived_at IS NULL
  `);
  res.json(rows[0]);
}

/**
 * Finds a vendor by name (case-insensitive) or creates one on the fly.
 */
async function findOrCreateVendor(name, { gst_number, address, phone } = {}) {
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
    `INSERT INTO vendors (name, gst_number, address, contact_phone) VALUES ($1::text,$2::text,$3::text,$4::text) RETURNING id`,
    [trimmed, gst_number || null, address || null, phone || null]
  );
  return created.rows[0].id;
}

/**
 * Same pattern as findOrCreateVendor, for delivery locations.
 */
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
    `INSERT INTO locations (name, address, gst_number, code) VALUES ($1::text,$2::text,$3::text,$4::text) RETURNING id`,
    [trimmed, address || null, gst_number || null, code]
  );
  return created.rows[0].id;
}

/**
 * POST /api/purchases
 * Creates a new asset purchase order. Accepts a free-text vendor name
 * (looked up or created automatically) and an optional "amount already
 * paid", recorded as an initial payment. File uploads (if any) are a
 * SEPARATE follow-up request from the frontend after this succeeds and
 * returns an id — see saveInsurancePhotos/saveInvoiceFiles below. This
 * is deliberate: a failed file upload should never roll back an
 * otherwise-successful purchase creation.
 */
/**
 * GET /api/purchases/next-po?location=<name>
 * Powers the "Generate PO" button on both creation forms (New Asset
 * Purchase on the dashboard AND Inventory's New Asset — see
 * utils/poNumber.js for the actual derivation). Accepts any
 * authenticated user (employee/senior/admin all create purchases and
 * assets), doesn't require an admin/senior role. Preview only —
 * nothing is written to the database by this endpoint; the number
 * only becomes real once the purchase/asset is actually submitted
 * with it as po_number.
 */
export async function getNextPoNumber(req, res) {
  const { location } = req.query;
  if (!location || !location.trim()) {
    return res.status(400).json({ error: 'location is required.' });
  }
  const result = await previewNextPoNumber(location);
  res.json(result);
}

/**
 * GET /api/purchases/search-po?q=<partial or full po_number>
 * Powers PO-number matches in the global search bar (see
 * GlobalSearch.jsx) and the "Location POs" page's own PO search.
 * Deliberately spans BOTH purchases AND assets (a standalone
 * Inventory "New Asset" has its own po_number, independent of the
 * purchases table — see 019_po_number_generator.sql) and, unlike
 * listPurchases, is NOT restricted to non-archived/non-delivered rows
 * — a searched PO number should surface its full details regardless
 * of where that purchase currently sits in its lifecycle.
 */
export async function searchByPoNumber(req, res) {
  const { q } = req.query;
  if (!q || !q.trim()) return res.json({ purchases: [], assets: [] });
  const needle = `%${q.trim()}%`;

  const [purchaseRows, assetRows] = await Promise.all([
    pool.query(`SELECT * FROM purchase_summary WHERE po_number ILIKE $1::text ORDER BY created_at DESC LIMIT 20`, [needle]),
    pool.query(`SELECT * FROM asset_summary WHERE po_number ILIKE $1::text ORDER BY created_at DESC LIMIT 20`, [needle]),
  ]);

  res.json({ purchases: purchaseRows.rows, assets: assetRows.rows });
}

export async function createPurchase(req, res) {
  const {
    item_name, po_number, description, vendor_name, vendor_gst_number, vendor_address, vendor_phone,
    quantity, unit_cost, tax_percent, amount_paid, order_date,
    expected_delivery_date, delivery_location_id,
    location_name, location_address, location_gst_number,
    courier_name, tracking_number,
    is_delivered,
    requested_by_name, requested_by_phone,
  } = req.body;

  if (!item_name || !vendor_name || !quantity || unit_cost == null) {
    return res.status(400).json({ error: 'item_name, vendor_name, quantity, and unit_cost are required.' });
  }
  if (!requested_by_name || !requested_by_name.trim()) {
    return res.status(400).json({ error: "Requester's name is required." });
  }
  if (!requested_by_phone || !requested_by_phone.trim()) {
    return res.status(400).json({ error: "Requester's phone number is required." });
  }
  const parsedQuantity = parseInt(quantity, 10);
  const parsedUnitCost = parseAmount(unit_cost);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive whole number.' });
  }
  if (parsedUnitCost === null) {
    return res.status(400).json({ error: 'Unit cost must be a valid non-negative number.' });
  }
  let parsedTaxPercent = null;
  if (nullIfEmpty(tax_percent) !== null) {
    parsedTaxPercent = parseAmount(tax_percent);
    if (parsedTaxPercent === null) {
      return res.status(400).json({ error: 'Tax % must be a valid non-negative number.' });
    }
  }

  const vendorId = await findOrCreateVendor(vendor_name, {
    gst_number: vendor_gst_number, address: vendor_address, phone: vendor_phone,
  });

  const locationId = nullIfEmpty(delivery_location_id)
    || (await findOrCreateLocation(location_name, { address: location_address, gst_number: location_gst_number }));

  const { rows } = await pool.query(
    `INSERT INTO purchases
      (item_name, po_number, description, vendor_id, quantity, unit_cost, tax_percent,
       order_date, expected_delivery_date, delivery_location_id, courier_name, tracking_number, order_status, delivered_quantity, actual_delivery_date,
       approval_status, created_by, requested_by_name, requested_by_phone)
     VALUES ($1::text,$2::text,$3::text,$4::uuid,$5::int,$6::numeric,$7::numeric,COALESCE($8::date, CURRENT_DATE),$9::date,$10::uuid,$11::text,$12::text,$13::text,$14::int,$15::date,'pending',$16::uuid,$17::text,$18::text)
     RETURNING id`,
    [item_name, po_number || null, description || null, vendorId, parsedQuantity, parsedUnitCost, parsedTaxPercent,
     nullIfEmpty(order_date), nullIfEmpty(expected_delivery_date), nullIfEmpty(locationId), courier_name || null, tracking_number || null,
     is_delivered ? 'delivered' : 'ordered',
     is_delivered ? parsedQuantity : 0,
     is_delivered ? (nullIfEmpty(order_date) || todayStamp()) : null,
     req.user?.id || null, requested_by_name.trim(), requested_by_phone.trim()]
  );
  const purchaseId = rows[0].id;

  const parsedAmountPaid = parseAmount(amount_paid);
  if (parsedAmountPaid && parsedAmountPaid > 0) {
    await pool.query(
      `INSERT INTO payments (purchase_id, amount, method) VALUES ($1::uuid, $2::numeric, 'Initial payment')`,
      [purchaseId, parsedAmountPaid]
    );
  }

  const { rows: fullRows } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [purchaseId]);

  if (is_delivered) {
    try {
      await ensureAssetFromPurchase(fullRows[0]);
    } catch (err) {
      console.error('Auto-link to Inventory failed for createPurchase', purchaseId, err);
    }
  }

  res.status(201).json(fullRows[0]);
}

/**
 * POST /api/purchases/batch
 * Multi-item purchase: several line items (different asset names, PO
 * numbers, quantities, unit costs) bought together from the SAME
 * vendor in one submission — e.g. a chair, a table, and a hat on one
 * order. Each item still becomes its own independent `purchases` row
 * (own order_status, own partial-delivery progress, own Inventory
 * rows via ensureAssetFromPurchase — nothing about how a single item
 * is tracked afterward changes), but every row created here shares one
 * `purchase_order_id` (migration 015) purely so the UI can recognize
 * and group them as "the same order" without changing any of the
 * per-item logic those rows already go through everywhere else.
 *
 * Vendor and delivery location are resolved ONCE up front (same
 * findOrCreateVendor/findOrCreateLocation as the single-item path) and
 * reused for every line item, since a multi-item purchase is by
 * definition one vendor/one delivery. Delivery status ("Delivery
 * Pending" vs "Already Delivered") is likewise one choice for the
 * whole order, applied identically to every item — matching the New
 * Asset Purchase form's single Delivery Status control.
 *
 * Body: { vendor_name, vendor_gst_number?, vendor_address?, vendor_phone?,
 *   delivery_location_id?, location_name?, location_address?, location_gst_number?,
 *   order_date?, expected_delivery_date?, courier_name?, tracking_number?,
 *   is_delivered?, items: [{ item_name, po_number?, description?, quantity, unit_cost, amount_paid? }, ...] }
 */
export async function createPurchaseOrder(req, res) {
  const {
    vendor_name, vendor_gst_number, vendor_address, vendor_phone,
    delivery_location_id, location_name, location_address, location_gst_number,
    order_date, expected_delivery_date, courier_name, tracking_number,
    is_delivered, items,
    requested_by_name, requested_by_phone,
  } = req.body;

  if (!vendor_name || !vendor_name.trim()) {
    return res.status(400).json({ error: 'vendor_name is required.' });
  }
  if (!requested_by_name || !requested_by_name.trim()) {
    return res.status(400).json({ error: "Requester's name is required." });
  }
  if (!requested_by_phone || !requested_by_phone.trim()) {
    return res.status(400).json({ error: "Requester's phone number is required." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required.' });
  }

  // Validate every line item up front — an all-or-nothing check, so a
  // bad row (say, item 3 of 5) never leaves items 1-2 created and 4-5
  // rejected. Each error message references its 1-based position in
  // the list so the frontend can point at the exact row.
  const parsedItems = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const label = `Line item ${i + 1}`;
    if (!item.item_name || !item.item_name.trim()) {
      return res.status(400).json({ error: `${label}: item name is required.` });
    }
    const parsedQuantity = parseInt(item.quantity, 10);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: `${label}: quantity must be a positive whole number.` });
    }
    const parsedUnitCost = parseAmount(item.unit_cost);
    if (parsedUnitCost === null) {
      return res.status(400).json({ error: `${label}: unit cost must be a valid non-negative number.` });
    }
    let parsedTaxPercent = null;
    if (nullIfEmpty(item.tax_percent) !== null) {
      parsedTaxPercent = parseAmount(item.tax_percent);
      if (parsedTaxPercent === null) {
        return res.status(400).json({ error: `${label}: tax % must be a valid non-negative number.` });
      }
    }
    const parsedAmountPaid = item.amount_paid === '' || item.amount_paid == null ? 0 : parseAmount(item.amount_paid);
    if (parsedAmountPaid === null) {
      return res.status(400).json({ error: `${label}: amount paid must be a valid non-negative number.` });
    }
    parsedItems.push({
      item_name: item.item_name.trim(),
      po_number: item.po_number || null,
      description: item.description || null,
      quantity: parsedQuantity,
      unit_cost: parsedUnitCost,
      tax_percent: parsedTaxPercent,
      amount_paid: parsedAmountPaid,
    });
  }

  const vendorId = await findOrCreateVendor(vendor_name, {
    gst_number: vendor_gst_number, address: vendor_address, phone: vendor_phone,
  });
  const locationId = nullIfEmpty(delivery_location_id)
    || (await findOrCreateLocation(location_name, { address: location_address, gst_number: location_gst_number }));

  const { rows: idRows } = await pool.query(`SELECT gen_random_uuid() AS id`);
  const purchaseOrderId = idRows[0].id;

  const createdIds = [];
  for (const item of parsedItems) {
    const { rows } = await pool.query(
      `INSERT INTO purchases
        (item_name, po_number, description, vendor_id, quantity, unit_cost, tax_percent,
         order_date, expected_delivery_date, delivery_location_id, courier_name, tracking_number,
         order_status, delivered_quantity, actual_delivery_date, purchase_order_id,
         approval_status, created_by, requested_by_name, requested_by_phone)
       VALUES ($1::text,$2::text,$3::text,$4::uuid,$5::int,$6::numeric,$7::numeric,COALESCE($8::date, CURRENT_DATE),$9::date,$10::uuid,$11::text,$12::text,$13::text,$14::int,$15::date,$16::uuid,'pending',$17::uuid,$18::text,$19::text)
       RETURNING id`,
      [item.item_name, item.po_number, item.description, vendorId, item.quantity, item.unit_cost, item.tax_percent,
       nullIfEmpty(order_date), nullIfEmpty(expected_delivery_date), nullIfEmpty(locationId), courier_name || null, tracking_number || null,
       is_delivered ? 'delivered' : 'ordered',
       is_delivered ? item.quantity : 0,
       is_delivered ? (nullIfEmpty(order_date) || todayStamp()) : null,
       purchaseOrderId,
       req.user?.id || null, requested_by_name.trim(), requested_by_phone.trim()]
    );
    const purchaseId = rows[0].id;
    createdIds.push(purchaseId);

    if (item.amount_paid > 0) {
      await pool.query(
        `INSERT INTO payments (purchase_id, amount, method) VALUES ($1::uuid, $2::numeric, 'Initial payment')`,
        [purchaseId, item.amount_paid]
      );
    }
  }

  const { rows: fullRows } = await pool.query(
    `SELECT * FROM purchase_summary WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [createdIds]
  );

  if (is_delivered) {
    for (const purchase of fullRows) {
      try {
        await ensureAssetFromPurchase(purchase);
      } catch (err) {
        console.error('Auto-link to Inventory failed for createPurchaseOrder item', purchase.id, err);
      }
    }
  }

  res.status(201).json({ purchase_order_id: purchaseOrderId, items: fullRows });
}

/**
 * PATCH /api/purchases/:id/approve — admin-or-senior review gate for a
 * pending purchase (see 018_asset_approval_workflow.sql). Mirrors
 * assetController's approveAsset field-for-field: validates `approved`
 * is a boolean, rejects if the purchase isn't currently 'pending' (so
 * a decision can't be made twice), then records who decided and when.
 *
 * On approval, ALSO re-fetches the now-approved row from
 * purchase_summary and calls ensureAssetFromPurchase on it. This is
 * necessary because every call site that could have auto-created an
 * Inventory asset at creation/delivery time (createPurchase,
 * createPurchaseOrder, recordPartialDelivery, trackingService) ran
 * while the purchase was still 'pending' — ensureAssetFromPurchase's
 * own guard clause no-ops on anything not yet approved, so those
 * assets were deliberately deferred rather than created. Approval is
 * what finally lets them through; without this backfill call, an
 * already-delivered purchase that gets approved would sit approved
 * forever without ever reaching Inventory.
 */
export async function approvePurchase(req, res) {
  const { id } = req.params;
  const { approved, reason } = req.body;

  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approved must be true or false.' });
  }

  const { rows: existing } = await pool.query(`SELECT id, approval_status FROM purchases WHERE id = $1::uuid`, [id]);
  if (!existing.length) return res.status(404).json({ error: 'Purchase not found.' });
  if (existing[0].approval_status !== 'pending') {
    return res.status(400).json({ error: `This purchase was already ${existing[0].approval_status}.` });
  }

  await pool.query(
    `UPDATE purchases
     SET approval_status = $1::text, approved_by = $2::uuid, approved_at = now(), rejection_reason = $3::text
     WHERE id = $4::uuid`,
    [approved ? 'approved' : 'rejected', req.user?.id || null, approved ? null : (reason || null), id]
  );

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);

  if (approved && full.length) {
    try {
      await ensureAssetFromPurchase(full[0]);
    } catch (err) {
      console.error('Auto-link to Inventory failed for approvePurchase', id, err);
    }
  }

  res.json(full[0]);
}

// Fields eligible for change-log tracking on a general edit —
// deliberately a whitelist, same reasoning as assetController's
// TRACKED_FIELDS. Money (amount_paid) and status/insurance/maintenance
// are deliberately EXCLUDED here — each already has its own
// purpose-built endpoint (advance-payment, status, insurance,
// maintenance) with its own validation and its own log
// (financial_audit_log for money), so routing them through this
// generic editor too would let the two paths disagree about what
// changed. delivered_quantity is excluded for the same reason: it's
// only ever moved by the delivery flow (recordPartialDelivery /
// updatePurchaseStatus), never hand-edited.
const PURCHASE_TRACKED_FIELDS = [
  'item_name', 'po_number', 'description', 'vendor_id', 'quantity', 'unit_cost', 'tax_percent',
  'order_date', 'expected_delivery_date', 'delivery_location_id', 'courier_name', 'tracking_number',
];

/**
 * PATCH /api/purchases/:id — admin-only general edit of a purchase
 * record's own fields (Asset Purchase / Order History / anywhere else
 * this row is shown — there's only one row, see section 5 of the
 * README). Every changed field is diffed against the current row and
 * written to purchase_change_log, one row per field, in the SAME
 * transaction as the update — so the visible data and its audit trail
 * can never disagree about what changed. Mirrors assetController's
 * updateAsset field-for-field.
 *
 * Accepts vendor_name / location_name as free text, same
 * lookup-or-create behavior as POST /api/purchases (findOrCreateVendor
 * / findOrCreateLocation) — an admin can retype an existing vendor or
 * type a brand new one without needing its id.
 */
export async function updatePurchase(req, res) {
  const { id } = req.params;
  const body = { ...req.body };

  if (body.vendor_name !== undefined) {
    if (!body.vendor_name || !body.vendor_name.trim()) {
      return res.status(400).json({ error: 'Vendor name cannot be empty.' });
    }
    body.vendor_id = await findOrCreateVendor(body.vendor_name, {
      gst_number: body.vendor_gst_number, address: body.vendor_address, phone: body.vendor_phone,
    });
    delete body.vendor_name;
    delete body.vendor_gst_number;
    delete body.vendor_address;
    delete body.vendor_phone;
  }
  if (body.location_name !== undefined) {
    body.delivery_location_id = body.location_name
      ? await findOrCreateLocation(body.location_name, { address: body.location_address, gst_number: body.location_gst_number })
      : null;
    delete body.location_name;
    delete body.location_address;
    delete body.location_gst_number;
  }

  if (body.item_name !== undefined && !body.item_name.trim()) {
    return res.status(400).json({ error: 'Item name cannot be empty.' });
  }
  if (body.unit_cost !== undefined) {
    const parsed = parseAmount(body.unit_cost);
    if (parsed === null) return res.status(400).json({ error: 'Unit cost must be a valid non-negative number.' });
    body.unit_cost = parsed;
  }
  if (body.tax_percent !== undefined) {
    const normalized = nullIfEmpty(body.tax_percent);
    if (normalized === null) {
      body.tax_percent = null;
    } else {
      const parsed = parseAmount(normalized);
      if (parsed === null) return res.status(400).json({ error: 'Tax % must be a valid non-negative number.' });
      body.tax_percent = parsed;
    }
  }
  if (body.quantity !== undefined) {
    const n = parseInt(body.quantity, 10);
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive whole number.' });
    }
    body.quantity = n;
  }
  if (body.order_date !== undefined && !body.order_date) {
    return res.status(400).json({ error: 'Purchase date cannot be cleared.' });
  }
  for (const dateField of ['expected_delivery_date']) {
    if (body[dateField] !== undefined) body[dateField] = nullIfEmpty(body[dateField]);
  }
  if (body.po_number !== undefined) body.po_number = nullIfEmpty(body.po_number);
  if (body.description !== undefined) body.description = nullIfEmpty(body.description);
  if (body.courier_name !== undefined) body.courier_name = nullIfEmpty(body.courier_name);
  if (body.tracking_number !== undefined) body.tracking_number = nullIfEmpty(body.tracking_number);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(`SELECT * FROM purchases WHERE id = $1::uuid FOR UPDATE`, [id]);
    const current = currentRows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    // Quantity can never drop below what's already been delivered — the
    // same invariant the `delivered_quantity <= quantity` CHECK
    // constraint enforces, checked here first so it fails with a clear
    // 400 instead of a raw constraint-violation error.
    if (body.quantity !== undefined && body.quantity < current.delivered_quantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Quantity can't be less than the ${current.delivered_quantity} unit(s) already delivered.`,
      });
    }

    const setClauses = [];
    const values = [];
    const logEntries = [];
    const NUMERIC_FIELDS = new Set(['unit_cost']);

    for (const field of PURCHASE_TRACKED_FIELDS) {
      if (body[field] === undefined) continue;
      const newValue = body[field];
      const oldValue = current[field];

      // Same comparison-by-type reasoning as assetController.updateAsset:
      // numeric columns come back from Postgres as strings, so compare
      // numerically or an unchanged re-save false-positives as "changed".
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
        `UPDATE purchases SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}::uuid`,
        values
      );

      for (const entry of logEntries) {
        await client.query(
          `INSERT INTO purchase_change_log (purchase_id, field_name, previous_value, new_value, changed_by)
           VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::uuid)`,
          [id, entry.field, entry.oldValue == null ? null : String(entry.oldValue), entry.newValue == null ? null : String(entry.newValue), req.user?.id || null]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * PATCH /api/purchases/:id/status
 * Manually updates order status. Routed through
 * trackingService.applyStatusUpdate so notification + audit-log logic
 * runs the same way regardless of who triggered it.
 *
 * IMPORTANT (frontend contract): `status` must be a plain string, e.g.
 * "delivered" — never the raw onChange event object. The table's
 * status dropdown (StatusSelect) already does `onChange={(e) =>
 * onChange(e.target.value)}`, extracting the string before it ever
 * reaches this handler, which is what this endpoint's request body
 * assumes.
 */
export async function updatePurchaseStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (typeof status !== 'string' || !status.trim()) {
    return res.status(400).json({ error: 'status must be a non-empty string.' });
  }

  const updated = await applyStatusUpdate(id, status, 'manual');
  if (!updated) return res.status(404).json({ error: 'Purchase not found.' });

  res.json(updated);
}

/**
 * PATCH /api/purchases/:id/delivery-date
 */
export async function updateDeliveryDate(req, res) {
  const { id } = req.params;
  const expected_delivery_date = nullIfEmpty(req.body.expected_delivery_date);

  const { rows: beforeRows } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  const before = beforeRows[0];
  if (!before) return res.status(404).json({ error: 'Purchase not found.' });

  await pool.query(
    `UPDATE purchases SET expected_delivery_date = $1::date, updated_at = now() WHERE id = $2::uuid`,
    [expected_delivery_date, id]
  );

  const { rows: afterRows } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  const after = afterRows[0];

  await sendPurchaseAlert('delivery_date_change', after, { previousDate: before.expected_delivery_date });

  res.json(after);
}

/**
 * POST /api/purchases/:id/payments
 * Records a (possibly partial) NEW payment against a purchase — for
 * adding another installment. For CORRECTING an existing paid amount
 * (the dashboard's "Modify" toggle), see updateAdvancePayment below,
 * which also writes to the audit log; this endpoint doesn't, since a
 * new payment isn't a correction of anything.
 */
export async function recordPayment(req, res) {
  const { id } = req.params;
  const amount = parseAmount(req.body.amount);
  const { paid_on, method, reference } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'A positive payment amount is required.' });
  }

  await pool.query(
    `INSERT INTO payments (purchase_id, amount, paid_on, method, reference)
     VALUES ($1::uuid,$2::numeric,COALESCE($3::date, CURRENT_DATE),$4::text,$5::text)`,
    [id, amount, nullIfEmpty(paid_on), method || null, reference || null]
  );

  const { rows } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  const purchase = rows[0];
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

  await sendPurchaseAlert('payment_milestone', purchase, { paymentAmount: amount });

  res.status(201).json(purchase);
}

/**
 * PATCH /api/purchases/:id/advance-payment
 * The dashboard's "Modify" toggle: lets Advance Money Paid be edited
 * directly to a NEW TOTAL (not "add this much more"). Internally this
 * still goes through the payments table — it inserts one ADJUSTMENT
 * row for the difference (which may be negative, e.g. correcting an
 * overstated amount) rather than rewriting payment history — so
 * amount_remaining recalculates automatically via purchase_summary's
 * existing SUM(payments), with no separate "recompute balances"
 * step to keep in sync and no risk of drifting from the ledger.
 *
 * Every edit is also written to financial_audit_log (previous value,
 * new value, who, when) inside the SAME transaction as the payment
 * adjustment, so the two can never end up out of sync if one write
 * succeeds and the other fails.
 */
export async function updateAdvancePayment(req, res) {
  const { id } = req.params;
  const newAmountPaid = parseAmount(req.body.amount_paid);

  if (newAmountPaid === null) {
    return res.status(400).json({ error: 'amount_paid must be a valid non-negative number.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // purchase_summary is a VIEW — it can't be locked directly with
    // FOR UPDATE. Lock the underlying `purchases` row FIRST, then read
    // the current amount_paid — reading before locking would leave a
    // window where a second concurrent "Modify" save could read the
    // same stale amount_paid and compute an overlapping diff. (This
    // lock fully serializes concurrent edits through this same
    // endpoint; it does not lock the `payments` table itself, so it
    // doesn't also serialize against a simultaneous plain
    // POST /payments call on the same purchase — a narrower guarantee,
    // but it covers the actual failure mode this endpoint introduces.)
    const { rows: lockedRows } = await client.query(
      `SELECT id FROM purchases WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    if (!lockedRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    const { rows: currentRows } = await client.query(
      `SELECT * FROM purchase_summary WHERE id = $1::uuid`,
      [id]
    );
    const current = currentRows[0];

    const previousAmountPaid = Number(current.amount_paid);
    const diff = Math.round((newAmountPaid - previousAmountPaid) * 100) / 100;

    if (diff !== 0) {
      await client.query(
        `INSERT INTO payments (purchase_id, amount, method) VALUES ($1::uuid, $2::numeric, 'Adjustment (Modify)')`,
        [id, diff]
      );
      await client.query(
        `INSERT INTO financial_audit_log (purchase_id, field_name, previous_value, new_value, changed_by)
         VALUES ($1::uuid, 'amount_paid', $2::numeric, $3::numeric, $4::uuid)`,
        [id, previousAmountPaid, newAmountPaid, req.user?.id || null]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // let asyncHandler -> errorHandler format the response
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * DELETE /api/purchases/:id?mode=permanent|history
 */
export async function deletePurchase(req, res) {
  const { id } = req.params;
  const mode = req.query.mode === 'permanent' ? 'permanent' : 'history';

  if (mode === 'permanent') {
    // Permanently deleting an order also removes whatever it created
    // in Inventory Management — every asset unit tied to this
    // purchase_id, whether that's a single item or the full batch
    // from a bulk order (see assetController.ensureAssetFromPurchase
    // for how one purchase can spawn many asset rows). Done inside
    // one transaction so the purchase and its assets disappear
    // together, never one without the other.
    const client = await pool.connect();
    let orphanedAssetFiles = [];
    try {
      await client.query('BEGIN');
      orphanedAssetFiles = await deleteAssetsForPurchase(client, id);
      const { rowCount } = await client.query(`DELETE FROM purchases WHERE id = $1::uuid`, [id]);
      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Purchase not found.' });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    for (const filePath of orphanedAssetFiles) {
      const diskPath = path.join(UPLOAD_ROOT, filePath.replace(/^\/uploads\//, ''));
      fs.promises.unlink(diskPath).catch((err) => console.warn(`Could not remove file ${diskPath}:`, err.message));
    }

    return res.json({ id, deleted: true, mode: 'permanent' });
  }

  const { rows } = await pool.query(
    `UPDATE purchases SET archived_at = now(), updated_at = now() WHERE id = $1::uuid RETURNING id`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Purchase not found.' });
  res.json({ id, archived: true, mode: 'history' });
}

/**
 * PATCH /api/purchases/:id/restore
 */
export async function restorePurchase(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE purchases SET archived_at = NULL, updated_at = now() WHERE id = $1::uuid RETURNING id`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Purchase not found.' });
  res.json({ id, restored: true });
}

/**
 * PATCH /api/purchases/:id/insurance
 * Toggling insurance OFF also deletes any uploaded photo/invoice FILE
 * ROWS (purchase_files) for this purchase, and best-effort removes the
 * actual files from disk — re-enabling insurance later starts from a
 * clean slate rather than resurrecting stale documents. Disk deletion
 * failures are logged, not thrown — a missing/already-gone file should
 * never block the status toggle itself from succeeding.
 */
export async function updateInsuranceStatus(req, res) {
  const { id } = req.params;
  const insuranceDone = !!req.body.insurance_done;

  const { rows } = await pool.query(
    `UPDATE purchases SET insurance_done = $1::boolean, updated_at = now() WHERE id = $2::uuid RETURNING id`,
    [insuranceDone, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Purchase not found.' });

  if (!insuranceDone) {
    const { rows: files } = await pool.query(
      `DELETE FROM purchase_files WHERE purchase_id = $1::uuid RETURNING file_path`,
      [id]
    );
    for (const file of files) {
      const diskPath = path.join(UPLOAD_ROOT, file.file_path.replace(/^\/uploads\//, ''));
      fs.promises.unlink(diskPath).catch((err) => console.warn(`Could not remove file ${diskPath}:`, err.message));
    }
    await pool.query(
      `UPDATE purchases SET insurance_photo_path = NULL, invoice_path = NULL WHERE id = $1::uuid`,
      [id]
    );
  }

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * Shared multi-file save logic for both insurance photos and invoices.
 * Each file is compressed/written/inserted independently — one bad
 * file (rejected earlier by multer's fileFilter would already have
 * stopped the whole request, but a compression or disk-write failure
 * for one file here should NOT lose the others) so failures are
 * collected per-file and returned alongside the successes rather than
 * thrown.
 */
async function saveFiles(req, res, kind, subfolder) {
  const { id } = req.params;

  const { rows: exists } = await pool.query(`SELECT id FROM purchases WHERE id = $1::uuid`, [id]);
  if (!exists.length) return res.status(404).json({ error: 'Purchase not found.' });

  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No files were uploaded (or they failed type/size validation).' });
  }

  const results = [];
  for (const file of files) {
    try {
      const saved = await processAndSaveFile(file, subfolder);
      await pool.query(
        `INSERT INTO purchase_files (purchase_id, kind, file_path, original_name, mime_type, size_bytes)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::int)`,
        [id, kind, saved.publicPath, saved.originalName, saved.mimeType, saved.sizeBytes]
      );
      results.push({ name: file.originalname, success: true });
    } catch (err) {
      console.error(`Failed to save uploaded file "${file.originalname}":`, err.message);
      results.push({ name: file.originalname, success: false, error: err.message });
    }
  }

  // Uploading proof implies the asset is insured — self-correct the
  // flag even if the frontend somehow let this request through with
  // it still off, so data never ends up inconsistent (files present
  // but insurance_done = false).
  if (kind === 'insurance_photo' || kind === 'invoice') {
    await pool.query(`UPDATE purchases SET insurance_done = true WHERE id = $1::uuid AND insurance_done = false`, [id]);
  }

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  const anySucceeded = results.some((r) => r.success);
  res.status(anySucceeded ? 201 : 400).json({ purchase: full[0], results });
}

/** POST /api/purchases/:id/insurance-photos (multipart, field "photos", up to 10) */
export async function saveInsurancePhotos(req, res) {
  return saveFiles(req, res, 'insurance_photo', 'insurance-photos');
}

/** POST /api/purchases/:id/invoices (multipart, field "invoices", up to 10) */
export async function saveInvoiceFiles(req, res) {
  return saveFiles(req, res, 'invoice', 'invoices');
}

/**
 * DELETE /api/purchases/:id/files/:fileId
 * Removes a single uploaded file (one photo or one invoice page) —
 * used by the "x" on an individual thumbnail, as opposed to turning
 * insurance off entirely (which clears all of them).
 */
export async function deletePurchaseFile(req, res) {
  const { id, fileId } = req.params;

  const { rows } = await pool.query(
    `DELETE FROM purchase_files WHERE id = $1::uuid AND purchase_id = $2::uuid RETURNING file_path`,
    [fileId, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'File not found.' });

  const diskPath = path.join(UPLOAD_ROOT, rows[0].file_path.replace(/^\/uploads\//, ''));
  fs.promises.unlink(diskPath).catch((err) => console.warn(`Could not remove file ${diskPath}:`, err.message));

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * PATCH /api/purchases/:id/maintenance
 * Schedules (or reschedules/clears) maintenance for a purchase —
 * available from the Successful Order History page. Setting a date
 * automatically sets maintenance_status = 'scheduled'; clearing the
 * date (sending null) clears the schedule and any pending alert.
 */
export async function scheduleMaintenance(req, res) {
  const { id } = req.params;
  const maintenanceDate = nullIfEmpty(req.body.maintenance_date);
  const recurring = !!req.body.maintenance_recurring;
  const cost = req.body.maintenance_cost === '' || req.body.maintenance_cost == null
    ? null
    : parseAmount(req.body.maintenance_cost);

  let periodMonths = null;
  if (recurring) {
    const parsedPeriod = parseInt(req.body.maintenance_period_months, 10);
    periodMonths = Number.isInteger(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : 6; // default: every 6 months
  }

  const status = maintenanceDate ? 'scheduled' : null;

  const { rows } = await pool.query(
    `UPDATE purchases SET
       maintenance_date = $1::date,
       maintenance_period_months = $2::int,
       maintenance_recurring = $3::boolean,
       maintenance_cost = $4::numeric,
       maintenance_status = $5::text,
       updated_at = now()
     WHERE id = $6::uuid
     RETURNING id`,
    [maintenanceDate, periodMonths, recurring, cost, status, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Purchase not found.' });

  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * PATCH /api/purchases/:id/maintenance/complete
 * The Home Dashboard's "Successfully Completed" action on a
 * maintenance alert. If recurring, computes the next maintenance_date
 * (current date + period, using Postgres interval math so month
 * lengths are handled correctly rather than approximated in JS) and
 * re-schedules; otherwise clears the schedule entirely so the item
 * stops reappearing as an alert.
 */
export async function completeMaintenance(req, res) {
  const { id } = req.params;

  const { rows } = await pool.query(
    `UPDATE purchases SET
       maintenance_completed_at = now(),
       maintenance_date = CASE
         WHEN maintenance_recurring THEN (maintenance_date + (COALESCE(maintenance_period_months, 6)::text || ' months')::interval)::date
         ELSE NULL
       END,
       maintenance_status = CASE WHEN maintenance_recurring THEN 'scheduled' ELSE NULL END,
       updated_at = now()
     WHERE id = $1::uuid AND maintenance_status = 'scheduled'
     RETURNING id`,
    [id]
  );
  const { rows: full } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(full[0]);
}

/**
 * GET /api/purchases/:id/audit — everything that's ever happened to
 * this purchase, for the History timeline: every status change
 * (manual or courier-driven), every payment recorded, and every
 * "Modify" edit to Advance Money Paid. All three already get written
 * append-only as a side effect of their own endpoints (see
 * trackingService.applyStatusUpdate, recordPayment, and
 * updateAdvancePayment above) — this just reads them back out.
 * Mirrors the pattern assetController.getAssetDetail already uses for
 * the Inventory side (holdings + change log): fetch each raw list,
 * let the frontend merge them into one chronological feed.
 */
export async function getPurchaseAudit(req, res) {
  const { id } = req.params;

  const { rows: exists } = await pool.query(`SELECT id FROM purchases WHERE id = $1::uuid`, [id]);
  if (!exists.length) return res.status(404).json({ error: 'Purchase not found.' });

  const { rows: deliveryEvents } = await pool.query(
    `SELECT * FROM delivery_events WHERE purchase_id = $1::uuid ORDER BY occurred_at DESC`,
    [id]
  );
  const { rows: payments } = await pool.query(
    `SELECT * FROM payments WHERE purchase_id = $1::uuid ORDER BY paid_on DESC, created_at DESC`,
    [id]
  );
  const { rows: financialAuditLog } = await pool.query(
    `SELECT fal.*, u.name AS changed_by_name
     FROM financial_audit_log fal
     LEFT JOIN users u ON u.id = fal.changed_by
     WHERE fal.purchase_id = $1::uuid
     ORDER BY fal.changed_at DESC`,
    [id]
  );
  // Field-level edits made via the admin "Edit" modal (updatePurchase) —
  // separate from financial_audit_log above, which only ever tracks
  // Advance Money Paid corrections.
  const { rows: changeLog } = await pool.query(
    `SELECT pcl.*, u.name AS changed_by_name
     FROM purchase_change_log pcl
     LEFT JOIN users u ON u.id = pcl.changed_by
     WHERE pcl.purchase_id = $1::uuid
     ORDER BY pcl.changed_at DESC`,
    [id]
  );

  res.json({ deliveryEvents, payments, financialAuditLog, changeLog });
}

/**
 * GET /api/purchases/spend-trend?months=6
 * Monthly total spend + order count for the Home Dashboard's trend
 * chart. Zero-filled via generate_series so a month with no orders
 * still shows up as a real 0 rather than being skipped (which would
 * make the chart's x-axis lie about even spacing). Archived/deleted
 * purchases are excluded, same as every other summary figure.
 */
export async function getSpendTrend(req, res) {
  const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));

  const { rows } = await pool.query(
    `SELECT
        to_char(months.month, 'Mon YYYY')       AS label,
        months.month                             AS month_start,
        COALESCE(SUM(p.total_cost_with_tax), 0)::numeric  AS total_spend,
        COUNT(p.id)::int                         AS order_count
     FROM generate_series(
        date_trunc('month', CURRENT_DATE) - ($1::int - 1) * INTERVAL '1 month',
        date_trunc('month', CURRENT_DATE),
        INTERVAL '1 month'
     ) AS months(month)
     LEFT JOIN purchases p
        ON date_trunc('month', p.order_date) = months.month
        AND p.archived_at IS NULL
     GROUP BY months.month
     ORDER BY months.month ASC`,
    [months]
  );

  res.json(rows);
}

/**
 * GET /api/purchases/by-month?month=2026-06-01
 * Backs clicking a bar in the Order History spend chart — "what did
 * we actually buy this month?" Same archived_at/order_date filtering
 * as getSpendTrend, so the list always matches what that bar's total
 * was computed from.
 */
export async function getPurchasesByMonth(req, res) {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'A month is required.' });

  const { rows } = await pool.query(
    `SELECT * FROM purchase_summary
     WHERE archived_at IS NULL
       AND date_trunc('month', order_date) = date_trunc('month', $1::date)
     ORDER BY order_date ASC`,
    [month]
  );
  res.json(rows);
}

/**
 * PATCH /api/purchases/:id/record-delivery — { quantity_delivered, delivery_date? }
 * Handles split/partial deliveries — "40 ordered, vendor delivers 10
 * now, 30 later." Each call:
 *  1. Adds quantity_delivered to delivered_quantity (capped at the
 *     purchase's total quantity — can't over-deliver).
 *  2. Sets order_status to 'delivered' once the running total reaches
 *     quantity, or 'partially_delivered' if there's still more coming.
 *  3. Logs a delivery_events row so this shows up in the purchase's
 *     History timeline alongside every other status change.
 *  4. Creates exactly `quantity_delivered` new linked assets — see
 *     assetController.ensureAssetFromPurchase, which is what makes
 *     this safe to call multiple times across several partial
 *     deliveries without ever creating more assets than were ordered.
 *
 * Payment is untouched by this endpoint on purpose — Advance Payment/
 * amount_paid already tracks money independently of how many units
 * have physically arrived, so a partial delivery doesn't need to (and
 * shouldn't) touch it.
 */
export async function recordPartialDelivery(req, res) {
  const { id } = req.params;
  const qty = parseInt(req.body.quantity_delivered, 10);

  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Quantity delivered must be a positive whole number.' });
  }

  const { rows: existingRows } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  const purchase = existingRows[0];
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

  const remaining = purchase.quantity - purchase.delivered_quantity;
  if (qty > remaining) {
    return res.status(400).json({ error: `Only ${remaining} unit(s) remain undelivered on this purchase.` });
  }

  const today = new Date().toISOString().slice(0, 10);
  const deliveryDate = nullIfEmpty(req.body.delivery_date) || today;
  const newDeliveredQty = purchase.delivered_quantity + qty;
  const isFullyDelivered = newDeliveredQty >= purchase.quantity;
  const newStatus = isFullyDelivered ? 'delivered' : 'partially_delivered';

  await pool.query(
    `UPDATE purchases
     SET delivered_quantity = $1::int,
         order_status = $2::text,
         actual_delivery_date = CASE WHEN $3 THEN COALESCE(actual_delivery_date, $4::date) ELSE actual_delivery_date END,
         updated_at = now()
     WHERE id = $5::uuid`,
    [newDeliveredQty, newStatus, isFullyDelivered, deliveryDate, id]
  );

  // BUGFIX: this used to hardcode occurred_at to now() -- discarding
  // the delivery_date the frontend (RecordDeliveryModal) already
  // collects and sends on every partial delivery. That meant a
  // backdated delivery (e.g. "this batch actually arrived last
  // Tuesday") was recorded with today's date/time on the History
  // timeline instead of the date actually picked.
  //
  // For the common case (no backdating -- deliveryDate is today),
  // still use now() so same-day multiple partial deliveries on one
  // purchase keep a real, distinct, sortable time-of-day instead of
  // all landing on the same midnight timestamp. Only a genuinely
  // backdated date falls back to midnight on that day, since no real
  // time is known for it.
  await pool.query(
    `INSERT INTO delivery_events (purchase_id, status, source, note, occurred_at)
     VALUES ($1::uuid, $2::text, 'manual', $3::text, CASE WHEN $4::date = CURRENT_DATE THEN now() ELSE $4::date END)`,
    [id, newStatus, `${qty} of ${purchase.quantity} unit(s) delivered (${newDeliveredQty} of ${purchase.quantity} total so far)`, deliveryDate]
  );

  // Auto-link into Inventory: create exactly the newly-delivered units.
  const { rows: refreshed } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  try {
    await ensureAssetFromPurchase(refreshed[0], qty);
  } catch (err) {
    console.error('Auto-link to Inventory failed for partial delivery on purchase', id, err);
  }

  const { rows: final } = await pool.query(`SELECT * FROM purchase_summary WHERE id = $1::uuid`, [id]);
  res.json(final[0]);
}
