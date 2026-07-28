// =====================================================================
// emailService.js
// Renders and sends a single alert email via Gmail (Nodemailer).
// Recipient selection lives in notificationService.js (it loops over
// every user's chosen channel) — this file only knows how to render
// and send to ONE address, and stays a plain, testable function.
// =====================================================================
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// A single reusable transporter. Gmail requires an "App Password"
// (not the account password) when 2-Step Verification is enabled.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  family: 4,
});

/**
 * Renders a plain, readable subject + HTML body for a given trigger type.
 * Keeping templates here (rather than inline in routes) makes it trivial
 * to add a new trigger without touching controller logic.
 */
export function buildEmailContent(triggerType, purchase, extra = {}) {
  const templates = {
    status_update: {
      subject: `Order status updated: ${purchase.item_name}`,
      html: `
        <p><strong>${purchase.item_name}</strong> (Vendor: ${purchase.vendor_name}) status changed
        from <strong>${extra.previousStatus}</strong> to <strong>${purchase.order_status}</strong>.</p>
        <p>Quantity: ${purchase.quantity} · Total cost: ₹${Number(purchase.total_cost).toLocaleString('en-IN')}</p>
      `,
    },
    delivery_date_change: {
      subject: `Delivery date changed: ${purchase.item_name}`,
      html: `
        <p>The expected delivery date for <strong>${purchase.item_name}</strong>
        (Vendor: ${purchase.vendor_name}) changed from
        <strong>${extra.previousDate ?? 'N/A'}</strong> to
        <strong>${purchase.expected_delivery_date}</strong>.</p>
      `,
    },
    payment_milestone: {
      subject: `Payment recorded: ${purchase.item_name}`,
      html: `
        <p>A payment of <strong>₹${Number(extra.paymentAmount).toLocaleString('en-IN')}</strong>
        was recorded for <strong>${purchase.item_name}</strong> (Vendor: ${purchase.vendor_name}).</p>
        <p>Total paid: ₹${Number(purchase.amount_paid).toLocaleString('en-IN')} of
        ₹${Number(purchase.total_cost).toLocaleString('en-IN')}
        (Remaining: ₹${Number(purchase.amount_remaining).toLocaleString('en-IN')})</p>
      `,
    },
    overdue_delivery: {
      subject: `⚠ Delivery overdue: ${purchase.item_name}`,
      html: `
        <p><strong>${purchase.item_name}</strong> from ${purchase.vendor_name} was expected on
        <strong>${purchase.expected_delivery_date}</strong> and has not been marked delivered.</p>
      `,
    },
    payment_due_reminder: {
      subject: `Payment reminder: ${purchase.item_name}`,
      html: `
        <p><strong>${purchase.item_name}</strong> from ${purchase.vendor_name} has an outstanding
        balance of <strong>₹${Number(purchase.amount_remaining).toLocaleString('en-IN')}</strong>.</p>
      `,
    },
    maintenance_due: {
      subject: `🔧 Maintenance due soon: ${purchase.item_name}`,
      html: `
        <p><strong>${purchase.item_name}</strong> (Vendor: ${purchase.vendor_name}) has maintenance
        scheduled for <strong>${purchase.maintenance_date}</strong> — within the next 7 days.</p>
        <p>Location: ${purchase.delivery_location || 'N/A'}</p>
        ${purchase.maintenance_cost ? `<p>Estimated cost: ₹${Number(purchase.maintenance_cost).toLocaleString('en-IN')}</p>` : ''}
      `,
    },
    // NOTE: this one is called with an ASSET row (asset_summary), not a
    // purchase row — the `purchase` parameter name is inherited from
    // this function's original purchase-only scope; see
    // notificationService.sendAssetAlert for the asset-shaped caller.
    amc_expiring: {
      subject: `📄 AMC expiring soon: ${purchase.asset_name}`,
      html: `
        <p><strong>${purchase.asset_name}</strong>'s AMC with
        <strong>${purchase.amc_provider || 'the current provider'}</strong> ends on
        <strong>${purchase.amc_end_date}</strong> — within the next 30 days.</p>
        ${purchase.amc_cost ? `<p>Current AMC cost: ₹${Number(purchase.amc_cost).toLocaleString('en-IN')}</p>` : ''}
        <p>Status: ${purchase.status}</p>
      `,
    },
  };

  return templates[triggerType];
}

/**
 * Sends one rendered email to one address. Returns true/false —
 * never throws, so one bad address can't block other recipients or
 * crash the request that triggered the alert.
 */
export async function sendEmail(to, triggerType, purchase, extra = {}) {
  const content = buildEmailContent(triggerType, purchase, extra);
  if (!content) throw new Error(`Unknown notification trigger type: ${triggerType}`);

  try {
    await transporter.sendMail({
      from: `"Asset Dashboard" <${process.env.GMAIL_USER}>`,
      to,
      subject: content.subject,
      html: content.html,
    });
    return true;
  } catch (err) {
    console.error(`Failed to send "${triggerType}" email to ${to}:`, err.message);
    return false;
  }
}

/**
 * Sends the "reset your password" email. Kept fully separate from
 * sendEmail/buildEmailContent above — those are purpose-built around
 * a `purchase` object, and a password reset has no purchase to
 * reference. Never throws (same "best-effort" contract as sendEmail)
 * so a delivery failure surfaces as a false return, not a crash.
 */
export async function sendPasswordResetEmail(to, resetLink) {
  try {
    await transporter.sendMail({
      from: `"Asset Dashboard" <${process.env.GMAIL_USER}>`,
      to,
      subject: 'Reset your Asset Dashboard password',
      html: `
        <p>We received a request to reset your password.</p>
        <p><a href="${resetLink}">Click here to choose a new password</a> — this link expires in 30 minutes.</p>
        <p>If you didn't request this, you can safely ignore this email — your password won't change unless you click the link above and set a new one.</p>
      `,
    });
    return true;
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
    return false;
  }
}
