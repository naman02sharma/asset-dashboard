import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdminOrSenior } from '../middleware/auth.js';

const router = Router();

// Powers the vendor autocomplete suggestions on the New Purchase form.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, website, gst_number, address, contact_phone, contact_email
     FROM vendors ORDER BY name`
  );
  res.json(rows);
}));

// Deliberately NOT admin-gated: creating a vendor is something any
// logged-in user already does implicitly just by typing a new vendor
// name on the New Purchase form (findOrCreateVendor in
// purchaseController.js) — any employee can already trigger this path,
// so gating the Vendor Management page's own "Add Vendor" button would
// just be a second, inconsistent way to do the same thing. Matches the
// same create-is-open/edit-is-admin-only split used for purchases and
// assets (createPurchase/createAsset aren't admin-gated; updatePurchase/
// updateAsset are).
router.post('/', asyncHandler(async (req, res) => {
  const { name, website, contact_email, contact_phone, gst_number, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Vendor name is required.' });

  const { rows } = await pool.query(
    `INSERT INTO vendors (name, website, contact_email, contact_phone, gst_number, address)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, website, contact_email, contact_phone, gst_number, address]
  );
  res.status(201).json({ id: rows[0].id });
}));

// BUGFIX (uniformity audit): this was the only "edit an existing
// record" endpoint in the whole app with no requireAdmin gate —
// PATCH /purchases/:id and PATCH /assets/:id both require admin, and
// the frontend elsewhere hides every edit control behind isAdmin (see
// PurchaseTable/InventoryPage/CompletedOrdersPage). VendorManagementPage
// showed its Edit pencil to every user regardless of role, and this
// route would have honored that request from a non-admin. Both sides
// fixed together (see VendorManagementPage.jsx).
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, website, contact_email, contact_phone, gst_number, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Vendor name is required.' });

  const { rows } = await pool.query(
    `UPDATE vendors
     SET name = $1, website = $2, contact_email = $3, contact_phone = $4, gst_number = $5, address = $6
     WHERE id = $7::uuid
     RETURNING *`,
    [name, website, contact_email, contact_phone, gst_number, address, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Vendor not found.' });
  res.json(rows[0]);
}));

// DELETE /vendors/:id — admin OR senior (a deliberate, narrow
// exception to the usual "delete is admin-only" rule everywhere else
// in the app, per explicit request). purchases.vendor_id and
// assets.vendor_id are both ON DELETE RESTRICT, so the database
// itself refuses to delete a vendor that's still referenced by any
// purchase or asset — caught here and turned into a clear 409 instead
// of a raw Postgres foreign-key error reaching the frontend.
//
// NOTE on why this can 409 even after "deleting" every purchase/asset
// from this vendor in the UI: the normal Delete button on a purchase
// only archives it (archived_at set, row kept — see
// purchaseController.deletePurchase's default 'history' mode) so it
// still counts here. Only a *permanent* delete (from the History
// page, admin-only) actually removes the row and clears this vendor
// reference. Assets' Delete button IS a real hard delete already.
router.delete('/:id', requireAdminOrSenior, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Checked up front (rather than only reacting to the FK error) so
  // the message can say exactly how many purchases/assets are in the
  // way, including archived-but-not-permanently-deleted ones — that's
  // the detail that was missing before and made the plain 409 feel
  // opaque/broken from the frontend.
  const { rows: usage } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM purchases WHERE vendor_id = $1::uuid) AS purchase_count,
       (SELECT COUNT(*)::int FROM assets WHERE vendor_id = $1::uuid) AS asset_count`,
    [id]
  );
  const { purchase_count, asset_count } = usage[0];
  if (purchase_count > 0 || asset_count > 0) {
    const parts = [];
    if (purchase_count > 0) parts.push(`${purchase_count} purchase${purchase_count === 1 ? '' : 's'}`);
    if (asset_count > 0) parts.push(`${asset_count} asset${asset_count === 1 ? '' : 's'}`);
    return res.status(409).json({
      error: `This vendor still has ${parts.join(' and ')} attached (this includes archived/deleted-from-view purchases — archiving doesn't remove the record). Permanently delete those from the History page, or reassign them to a different vendor, before deleting this vendor.`,
    });
  }

  try {
    const { rowCount } = await pool.query(`DELETE FROM vendors WHERE id = $1::uuid`, [id]);
    if (!rowCount) return res.status(404).json({ error: 'Vendor not found.' });
    res.status(204).send();
  } catch (err) {
    // Safety net for a race (something got attached between the check
    // above and this DELETE) — Postgres reports an ON DELETE RESTRICT
    // violation as '23001' (restrict_violation), NOT the more
    // commonly-checked '23503' (foreign_key_violation); both handled.
    if (err.code === '23001' || err.code === '23503') {
      return res.status(409).json({ error: 'This vendor has existing purchases or assets and cannot be deleted. Reassign or remove those first.' });
    }
    throw err;
  }
}));

export default router;
