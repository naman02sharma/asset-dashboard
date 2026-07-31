import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

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

export default router;
