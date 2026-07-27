// =====================================================================
// notificationService.js
// Single entry point every controller/service calls to send an alert.
// Looks up every registered user's notification preference (Gmail
// address or phone number, connected via Settings in the app) and
// dispatches through emailService or smsService accordingly, logging
// each attempt to notification_log.
//
// Two public entry points — sendPurchaseAlert (purchases) and
// sendAssetAlert (inventory module) — share the same recipient-lookup
// and email/sms dispatch logic via the private dispatchAlert() below;
// they differ only in which notification_log column (purchase_id vs
// asset_id) the send gets attributed to.
// =====================================================================
import { pool } from '../config/db.js';
import { sendEmail } from './emailService.js';
import { sendSms } from './smsService.js';

async function getRecipients() {
  const { rows: users } = await pool.query(
    `SELECT id, notify_channel, notify_email, notify_phone FROM users`
  );
  // Falls back to NOTIFY_TO_EMAIL from .env if no users have registered
  // yet, so notifications still work before anyone has logged in.
  return users.length
    ? users
    : process.env.NOTIFY_TO_EMAIL
      ? [{ id: null, notify_channel: 'email', notify_email: process.env.NOTIFY_TO_EMAIL }]
      : [];
}

async function dispatchAlert({ triggerType, entity, extra, entityLabel, logColumn }) {
  const recipients = await getRecipients();

  for (const user of recipients) {
    let success = false;
    let recipientAddress = '';

    if (user.notify_channel === 'sms' && user.notify_phone) {
      recipientAddress = user.notify_phone;
      success = await sendSms(user.notify_phone, triggerType, entity, extra);
    } else if (user.notify_email) {
      recipientAddress = user.notify_email;
      success = await sendEmail(user.notify_email, triggerType, entity, extra);
    } else {
      continue; // user has no usable contact method set — skip silently
    }

    await pool.query(
      `INSERT INTO notification_log (${logColumn}, trigger_type, recipient, subject, success)
       VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::boolean)`,
      [entity.id, triggerType, recipientAddress, `${triggerType} — ${entityLabel}`, success]
    );
  }
}

/** Sends `triggerType` alert about a PURCHASE to every user account. */
export async function sendPurchaseAlert(triggerType, purchase, extra = {}) {
  await dispatchAlert({ triggerType, entity: purchase, extra, entityLabel: purchase.item_name, logColumn: 'purchase_id' });
}

/** Sends `triggerType` alert about an inventory ASSET to every user account. */
export async function sendAssetAlert(triggerType, asset, extra = {}) {
  await dispatchAlert({ triggerType, entity: asset, extra, entityLabel: asset.asset_name, logColumn: 'asset_id' });
}

/**
 * Guards against sending the same alert twice for the same purchase
 * within a cooldown window (default: 1 day) — used by the daily cron
 * job so it doesn't re-notify on every tick.
 */
export async function wasRecentlyNotified(purchaseId, triggerType, withinHours = 24) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE purchase_id = $1::uuid AND trigger_type = $2::text
       AND sent_at > now() - ($3::text || ' hours')::interval
     LIMIT 1`,
    [purchaseId, triggerType, withinHours]
  );
  return rows.length > 0;
}

/** Same as wasRecentlyNotified, keyed by asset_id instead of purchase_id. */
export async function wasRecentlyNotifiedForAsset(assetId, triggerType, withinHours = 24) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE asset_id = $1::uuid AND trigger_type = $2::text
       AND sent_at > now() - ($3::text || ' hours')::interval
     LIMIT 1`,
    [assetId, triggerType, withinHours]
  );
  return rows.length > 0;
}
