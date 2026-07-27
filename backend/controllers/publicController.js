import { pool } from '../config/db.js';

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateFmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * GET /public/asset/:id — NO AUTHENTICATION. This is deliberately
 * public: the entire point of an asset's QR code (see
 * assetController.getAssetQrCode) is that anyone holding the physical
 * item — an employee, an IT technician, an auditor — can scan the
 * label and immediately see what it is, without needing an account or
 * logging in first.
 *
 * Server-rendered plain HTML on purpose (not part of the React SPA):
 * this is a single read-only page with no interactivity needed, so
 * there's no reason to ship the whole app bundle just to display a
 * few fields after a phone-camera scan.
 *
 * Kept deliberately minimal in what it exposes — asset identity/
 * status/vendor/AMC info, and the PO number + description from the
 * linked purchase. No cost/payment figures, no employee-assignment
 * history, no internal audit trail — those stay behind login.
 */
export async function getPublicAssetPage(req, res) {
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT a.*, p.po_number, p.description AS purchase_description
     FROM asset_summary a
     LEFT JOIN purchases p ON p.id = a.purchase_id
     WHERE a.id = $1::uuid`,
    [id]
  );
  const asset = rows[0];

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!asset) {
    return res.status(404).send(renderPage('Asset not found', `
      <p class="muted">This QR code doesn't match any asset on record — it may have been removed.</p>
    `));
  }

  const statusLabel = {
    available: 'Available', in_use: 'In Use', under_repair: 'Under Repair', retired: 'Retired',
  }[asset.status] || asset.status;

  const amcBlock = asset.amc_provider || asset.amc_end_date ? `
    <div class="row"><span>AMC provider</span><strong>${escapeHtml(asset.amc_provider) || '—'}</strong></div>
    <div class="row"><span>AMC ends</span><strong>${dateFmt(asset.amc_end_date)}</strong></div>
  ` : `<div class="row"><span>AMC</span><strong>No active contract</strong></div>`;

  const body = `
    <h1>${escapeHtml(asset.asset_name)}</h1>
    <span class="badge">${escapeHtml(statusLabel)}</span>

    <div class="card">
      <div class="row"><span>Asset tag</span><strong>${escapeHtml(asset.asset_tag) || '—'}</strong></div>
      <div class="row"><span>PO number</span><strong>${escapeHtml(asset.po_number) || '—'}</strong></div>
      <div class="row"><span>Category</span><strong>${escapeHtml(asset.category) || '—'}</strong></div>
      <div class="row"><span>Serial number</span><strong>${escapeHtml(asset.serial_number) || '—'}</strong></div>
      <div class="row"><span>Location</span><strong>${escapeHtml(asset.location) || '—'}</strong></div>
      <div class="row"><span>Vendor</span><strong>${escapeHtml(asset.vendor_name) || '—'}</strong></div>
      <div class="row"><span>Purchase date</span><strong>${dateFmt(asset.purchase_date)}</strong></div>
      <div class="row"><span>Warranty expiry</span><strong>${dateFmt(asset.warranty_expiry)}</strong></div>
      ${amcBlock}
    </div>

    ${asset.purchase_description ? `
      <div class="card">
        <p class="label">Description</p>
        <p>${escapeHtml(asset.purchase_description)}</p>
      </div>
    ` : ''}
  `;

  res.send(renderPage(asset.asset_name, body));
}

function renderPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Asset Info</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 48px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #FCFCFE; color: #272635;
  }
  .wrap { max-width: 420px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .badge {
    display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 10px;
    border-radius: 999px; background: #EEFAFD; color: #146178; margin-bottom: 16px;
  }
  .card {
    background: #fff; border: 1px solid #E8E9F3; border-radius: 12px;
    padding: 14px 16px; margin-bottom: 12px;
  }
  .row {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 6px 0; border-bottom: 1px solid #F5F6FA; font-size: 14px;
  }
  .row:last-child { border-bottom: none; }
  .row span { color: #87878C; }
  .row strong { text-align: right; font-weight: 500; }
  .label { font-size: 12px; color: #87878C; margin: 0 0 4px; }
  .muted { color: #87878C; font-size: 14px; }
  footer { text-align: center; font-size: 11px; color: #A6A6A8; margin-top: 24px; }
</style>
</head>
<body>
  <div class="wrap">
    ${bodyHtml}
    <footer>Scanned asset info — Asset Purchase Dashboard</footer>
  </div>
</body>
</html>`;
}
