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

export default router;
