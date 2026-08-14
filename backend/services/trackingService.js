// =====================================================================
// trackingService.js
// Automation layer that keeps `order_status` in sync with reality.
//
// Two integration patterns are supported — use whichever the courier
// offers:
//
//   1. WEBHOOK (preferred): the courier calls our
//      POST /api/webhooks/courier endpoint whenever a shipment updates.
//      See routes/notifications.js -> handleCourierWebhook().
//
//   2. POLLING (fallback for couriers with no webhooks): a cron job
//      periodically calls the courier's tracking API for every
//      purchase that isn't yet "delivered". This file mocks that call
//      in `fetchTrackingStatusFromCourier` — swap the mock for a real
//      fetch() to BlueDart/FedEx/DHL/Delhivery's tracking API.
//
// Both paths funnel through `applyStatusUpdate`, which is also what
// keeps the two in sync and where email triggers are fired from.
// =====================================================================
import cron from 'node-cron';
import { pool } from '../config/db.js';
import { sendPurchaseAlert, wasRecentlyNotified, sendAssetAlert, wasRecentlyNotifiedForAsset } from './notificationService.js';
import { ensureAssetFromPurchase } from '../controllers/assetController.js';

// Courier tracking states are normalized into our internal status enum.
// Extend this map as you wire up real courier APIs — each courier has
// its own vocabulary (e.g. BlueDart: "OFD", FedEx: "OT", DHL: "WC").
const COURIER_STATUS_MAP = {
  PICKED_UP: 'shipped',
  IN_TRANSIT: 'shipped',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  EXCEPTION: 'delayed',
};

/**
 * MOCK: replace this with a real fetch() to the courier's tracking API,
 * e.g.:
 *   const res = await fetch(`https://api.bluedart.com/track/${trackingNumber}`, {
 *     headers: { Authorization: `Bearer ${process.env.BLUEDART_API_KEY}` }
 *   });
 *   const data = await res.json();
 *   return COURIER_STATUS_MAP[data.status];
 *
 * Kept as a mock here so the project runs with zero external API keys.
 */
async function fetchTrackingStatusFromCourier(courierName, trackingNumber) {
  // Simulated response — in a real integration this is where the
  // courier's raw status code gets mapped through COURIER_STATUS_MAP.
  const simulatedStatuses = ['shipped', 'out_for_delivery', 'delivered'];
  return simulatedStatuses[Math.floor(Math.random() * simulatedStatuses.length)];
}

/**
 * Applies a new status to a purchase, records an audit event, and fires
 * the "status_update" email if the status actually changed.
 * This is the single choke point both the webhook and the polling job
 * call through, so notification logic only lives in one place.
 */
export async function applyStatusUpdate(purchaseId, newStatus, source = 'courier_webhook', note = null) {
  const { rows: existingRows } = await pool.query(
    `SELECT * FROM purchase_summary WHERE id = $1::uuid`,
    [purchaseId]
  );
  const purchase = existingRows[0];
  if (!purchase) return null;

  const previousStatus = purchase.order_status;
  if (previousStatus === newStatus) return purchase; // no-op, nothing changed

  // NOTE (dry-run fix): the previous version of this query reused the
  // same $1 placeholder both as a plain assignment (order_status = $1)
  // AND inside a CASE WHEN $1 = 'delivered' comparison. node-postgres
  // infers each placeholder's type from how it's used; the same
  // placeholder appearing in two different expression shapes is
  // exactly what triggers "inconsistent types deduced for parameter
  // $1". Using a SEPARATE, explicitly-cast placeholder for each usage
  // (and casting every placeholder to its column's real type) removes
  // the ambiguity entirely — this is the fix requested for PATCH
  // status-update endpoints specifically.
  await pool.query(
    `UPDATE purchases
     SET order_status = $1::text,
         actual_delivery_date = CASE WHEN $2::text = 'delivered' THEN CURRENT_DATE ELSE actual_delivery_date END,
         delivered_quantity = CASE WHEN $2::text = 'delivered' THEN quantity ELSE delivered_quantity END,
         updated_at = now()
     WHERE id = $3::uuid`,
    [newStatus, newStatus, purchaseId]
  );

  await pool.query(
    `INSERT INTO delivery_events (purchase_id, status, note, source) VALUES ($1::uuid, $2::text, $3::text, $4::text)`,
    [purchaseId, newStatus, note, source]
  );

  const { rows: updatedRows } = await pool.query(
    `SELECT * FROM purchase_summary WHERE id = $1::uuid`,
    [purchaseId]
  );
  const updatedPurchase = updatedRows[0];

  // Auto-link into Inventory Management the moment this purchase is
  // actually delivered — runs BEFORE the email notification so a slow
  // or unreachable mail server can never delay inventory sync. See
  // assetController.ensureAssetFromPurchase for why this is safe to
  // call unconditionally (idempotent, and never touches the
  // purchase-side flow above even if it fails).
  if (newStatus === 'delivered' && previousStatus !== 'delivered') {
    try {
      await ensureAssetFromPurchase(updatedPurchase);
    } catch (err) {
      console.error('Auto-link to Inventory failed for purchase', purchaseId, err);
    }
  }

  // Trigger: "An email must be sent whenever an order status updates"
  // Fire-and-forget: don't let a slow/unreachable SMTP server block
  // the response or delay anything downstream.
  sendPurchaseAlert('status_update', updatedPurchase, { previousStatus })
    .catch((err) => console.error('Failed to send status_update email', err));

  return updatedPurchase;
}

/**
 * Polling fallback: walk every non-delivered purchase that has a
 * tracking number and ask the courier for its latest status.
 * Wire this up to a cron schedule in server.js if a courier has no
 * webhook support.
 */
export async function pollAllActiveShipments() {
  // Excludes 'partially_delivered' as well as 'delivered'/'cancelled' —
  // a purchase already mid-way through a manually-tracked partial
  // delivery shouldn't have a generic courier status poll fast-forward
  // it straight to fully "delivered" (see applyStatusUpdate below,
  // which treats 'delivered' as "the whole order arrived" and creates
  // Inventory assets for every remaining unit accordingly).
  const { rows: activePurchases } = await pool.query(
    `SELECT id, courier_name, tracking_number FROM purchases
     WHERE order_status NOT IN ('delivered', 'cancelled', 'partially_delivered') AND tracking_number IS NOT NULL`
  );

  for (const purchase of activePurchases) {
    const latestStatus = await fetchTrackingStatusFromCourier(
      purchase.courier_name,
      purchase.tracking_number
    );
    if (latestStatus) {
      await applyStatusUpdate(purchase.id, latestStatus, 'courier_webhook', 'Auto-updated via polling');
    }
  }
}

/**
 * Status trigger: flags purchases whose expected_delivery_date has
 * passed but which are not yet delivered, marks them "delayed", and
 * sends an "overdue_delivery" email (at most once per 24h per purchase).
 */
export async function flagOverdueDeliveries() {
  const { rows: overdue } = await pool.query(
    `SELECT * FROM purchase_summary WHERE is_overdue = true`
  );

  for (const purchase of overdue) {
    if (purchase.order_status !== 'delayed') {
      await pool.query(`UPDATE purchases SET order_status = 'delayed', updated_at = now() WHERE id = $1`, [purchase.id]);
    }
    const alreadyNotified = await wasRecentlyNotified(purchase.id, 'overdue_delivery', 24);
    if (!alreadyNotified) {
      await sendPurchaseAlert('overdue_delivery', purchase);
    }
  }
}

/**
 * Status trigger: flags purchases that still have a balance due and
 * reminds the team (at most once every 3 days per purchase). Call this
 * on whatever cadence fits your payment terms.
 */
export async function flagPaymentsDue() {
  const { rows: unpaid } = await pool.query(
    `SELECT * FROM purchase_summary WHERE has_balance_due = true AND order_status != 'cancelled'`
  );

  for (const purchase of unpaid) {
    const alreadyNotified = await wasRecentlyNotified(purchase.id, 'payment_due_reminder', 72);
    if (!alreadyNotified) {
      await sendPurchaseAlert('payment_due_reminder', purchase);
    }
  }
}

/**
 * Maintenance alert: surfaces any purchase whose maintenance_date is
 * within the next 7 days (is_maintenance_due, computed in the DB view)
 * by emailing/texting the team. The item itself doesn't move anywhere —
 * it's already sitting in `purchases` with maintenance_status =
 * 'scheduled'; the dashboard's listPurchases query independently pulls
 * it back in based on this same is_maintenance_due flag (see
 * purchaseController.js). This function's only job is the alert.
 */
export async function checkMaintenanceAlerts() {
  const { rows: dueForMaintenance } = await pool.query(
    `SELECT * FROM purchase_summary WHERE is_maintenance_due = true AND archived_at IS NULL`
  );

  for (const purchase of dueForMaintenance) {
    const alreadyNotified = await wasRecentlyNotified(purchase.id, 'maintenance_due', 24);
    if (!alreadyNotified) {
      await sendPurchaseAlert('maintenance_due', purchase);
    }
  }
}

/**
 * Permanently deletes purchases that have been sitting in History for
 * more than 3 months. History is a soft-delete (purchases.archived_at)
 * so it can be browsed/restored — this is what makes that window
 * actually expire instead of accumulating forever.
 */
export async function purgeOldHistory() {
  const { rowCount } = await pool.query(
    `DELETE FROM purchases WHERE archived_at IS NOT NULL AND archived_at < now() - interval '3 months'`
  );
  if (rowCount > 0) {
    console.log(`[cron] Purged ${rowCount} purchase(s) from history older than 3 months.`);
  }
}

/**
 * Auto-rejects signups nobody ever approved. Without this, a pending
 * account sits in the "Pending approval" panel forever with no way to
 * clear it except an admin manually clicking Reject (see
 * authController.deleteUser) — fine for a handful of signups, but on
 * a public-facing deployment abandoned/spam signups would otherwise
 * accumulate indefinitely. An already-approved account is never
 * touched here, regardless of age — this only ever looks at
 * is_approved = false rows, same scoping as the manual Reject action.
 * Threshold is configurable since "how long is too long to wait for
 * an admin" varies by team — defaults to 14 days.
 */
export async function purgeStaleUnapprovedUsers() {
  const days = Number(process.env.PENDING_USER_EXPIRY_DAYS) || 14;
  const { rowCount } = await pool.query(
    `DELETE FROM users WHERE is_approved = false AND created_at < now() - ($1 || ' days')::interval`,
    [days]
  );
  if (rowCount > 0) {
    console.log(`[cron] Auto-rejected ${rowCount} signup(s) pending approval for more than ${days} day(s).`);
  }
}

/**
 * AMC renewal alert (Inventory module): surfaces any asset whose AMC
 * ends within 30 days by emailing/texting the team. Mirrors
 * checkMaintenanceAlerts() above — the asset itself doesn't move
 * anywhere; asset_summary's is_amc_expiring_soon flag is what the
 * Inventory dashboard's visual alert also reads independently, so this
 * function's only job is the notification.
 */
export async function checkAmcRenewalAlerts() {
  const { rows: expiringSoon } = await pool.query(
    `SELECT * FROM asset_summary WHERE is_amc_expiring_soon = true AND status <> 'retired'`
  );

  for (const asset of expiringSoon) {
    const alreadyNotified = await wasRecentlyNotifiedForAsset(asset.id, 'amc_expiring', 24);
    if (!alreadyNotified) {
      await sendAssetAlert('amc_expiring', asset);
    }
  }
}

/**
 * Registers the recurring automation jobs. Call once from server.js.
 * Schedule is configurable via OVERDUE_CHECK_CRON (defaults to 8am daily).
 */
export function scheduleAutomationJobs() {
  const schedule = process.env.OVERDUE_CHECK_CRON || '0 8 * * *';
  cron.schedule(schedule, async () => {
    console.log('[cron] Running daily delivery/payment/maintenance/AMC checks…');
    await flagOverdueDeliveries();
    await flagPaymentsDue();
    await checkMaintenanceAlerts();
    await checkAmcRenewalAlerts();
    await purgeOldHistory();
    await purgeStaleUnapprovedUsers();
  });
}
