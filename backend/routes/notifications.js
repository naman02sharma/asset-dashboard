// =====================================================================
// notifications.js
// Inbound webhook that a courier (BlueDart/FedEx/DHL/Delhivery/etc.)
// calls when a shipment's status changes. This is the "push" half of
// the tracking automation described in trackingService.js — the
// "pull" half is pollAllActiveShipments(), used for couriers that
// don't support webhooks.
//
// Example inbound payload (shape varies per courier — normalize it in
// the mapping below):
//   { "tracking_number": "BD1234567890", "status": "OUT_FOR_DELIVERY" }
// =====================================================================
import { Router } from 'express';
import { pool } from '../config/db.js';
import { applyStatusUpdate } from '../services/trackingService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// Maps each courier's raw status vocabulary to our internal enum.
// Add an entry here whenever a new courier is integrated.
const STATUS_NORMALIZERS = {
  bluedart: { PICKED_UP: 'shipped', IN_TRANSIT: 'shipped', OFD: 'out_for_delivery', DLVD: 'delivered' },
  fedex:    { PU: 'shipped', IT: 'shipped', OD: 'out_for_delivery', DL: 'delivered' },
  dhl:      { transit: 'shipped', 'with-delivery-courier': 'out_for_delivery', delivered: 'delivered' },
};

router.post('/courier', asyncHandler(async (req, res) => {
  const { tracking_number, status, courier = 'bluedart' } = req.body;

  if (!tracking_number || !status) {
    return res.status(400).json({ error: 'tracking_number and status are required.' });
  }

  const normalizer = STATUS_NORMALIZERS[courier.toLowerCase()];
  const normalizedStatus = normalizer?.[status];

  if (!normalizedStatus) {
    return res.status(422).json({ error: `Unrecognized status "${status}" for courier "${courier}".` });
  }

  const { rows } = await pool.query(`SELECT id FROM purchases WHERE tracking_number = $1`, [tracking_number]);
  const purchase = rows[0];
  if (!purchase) return res.status(404).json({ error: 'No purchase matches that tracking number.' });

  const updated = await applyStatusUpdate(purchase.id, normalizedStatus, 'courier_webhook');
  res.json(updated);
}));

export default router;
