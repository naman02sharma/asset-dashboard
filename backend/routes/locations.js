import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// Powers the location autocomplete suggestions on the New Purchase form.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, address, gst_number FROM locations ORDER BY name`);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, address, gst_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Location name is required.' });

  const { rows } = await pool.query(
    `INSERT INTO locations (name, address, gst_number) VALUES ($1,$2,$3) RETURNING id`,
    [name, address, gst_number]
  );
  res.status(201).json({ id: rows[0].id });
}));

export default router;
