// =====================================================================
// smsService.js
// Sends SMS delivery/payment alerts to users who chose notify_channel
// = 'sms'. MOCKED for now — logs to the console instead of an actual
// carrier call, so the project runs with zero paid API keys.
//
// To go live with Twilio (https://www.twilio.com):
//   npm install twilio
//   import twilio from 'twilio';
//   const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
//   await client.messages.create({
//     to: phoneNumber,
//     from: process.env.TWILIO_FROM_NUMBER,
//     body: message,
//   });
// =====================================================================

/**
 * Builds a short SMS-friendly message per trigger type. Kept separate
 * from emailService's HTML templates since SMS needs to be terse.
 */
function buildSmsMessage(triggerType, purchase, extra = {}) {
  const messages = {
    status_update: `${purchase.item_name}: status changed to "${purchase.order_status}".`,
    delivery_date_change: `${purchase.item_name}: new expected delivery date ${purchase.expected_delivery_date}.`,
    payment_milestone: `${purchase.item_name}: payment of ₹${Number(extra.paymentAmount).toLocaleString('en-IN')} recorded.`,
    overdue_delivery: `⚠ ${purchase.item_name} is overdue — was expected ${purchase.expected_delivery_date}.`,
    payment_due_reminder: `${purchase.item_name}: ₹${Number(purchase.amount_remaining).toLocaleString('en-IN')} balance still due.`,
    maintenance_due: `🔧 ${purchase.item_name}: maintenance due ${purchase.maintenance_date} (within 7 days).`,
    // Called with an ASSET row — see the note in emailService.js's
    // amc_expiring template for why the parameter is still named `purchase`.
    amc_expiring: `📄 ${purchase.asset_name}: AMC with ${purchase.amc_provider || 'provider'} ends ${purchase.amc_end_date} (within 30 days).`,
  };
  return messages[triggerType] || `Update on ${purchase.item_name || purchase.asset_name || 'an item'}.`;
}

/**
 * MOCK send — replace the body of this function with a real Twilio
 * call (see header comment) once TWILIO_* env vars are set.
 */
export async function sendSms(phoneNumber, triggerType, purchase, extra = {}) {
  const message = buildSmsMessage(triggerType, purchase, extra);
  console.log(`[SMS MOCK] -> ${phoneNumber}: ${message}`);
  // Always "succeeds" in mock mode. A real Twilio integration should
  // return true/false based on the API response, mirroring emailService.
  return true;
}
