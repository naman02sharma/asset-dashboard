// =====================================================================
// csv.js
// Converts an array of row objects into CSV text. Shared by every
// export endpoint (purchases, completed orders, inventory) so quoting/
// escaping rules only live in one place.
// =====================================================================

/**
 * Escapes a single CSV field per RFC 4180: wrap in double quotes if it
 * contains a comma, quote, or newline, and double up any internal
 * quotes. Null/undefined become an empty field, not the string "null".
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds CSV text from `rows` (array of objects) using `columns`
 * (array of { key, label, format? }) to control column order, header
 * text, and optional per-column value formatting (e.g. currency,
 * date) independent of the raw DB value.
 */
export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeField(c.format ? c.format(row[c.key], row) : row[c.key])).join(',')
  );
  // Leading BOM so Excel opens UTF-8 (₹, etc.) correctly instead of mangling it.
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

/** Sends `rows` as a downloadable CSV file response. */
export function sendCsv(res, filename, rows, columns) {
  const csv = toCsv(rows, columns);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/**
 * Parses CSV text (RFC 4180 — handles quoted fields containing commas,
 * quotes, or newlines) into an array of row objects keyed by the
 * header row. Symmetric with toCsv above, so a file exported from
 * this app (or Excel/Google Sheets) round-trips through Import
 * cleanly. Used by assetController.importAssets.
 */
export function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, ''); // strip Excel's UTF-8 BOM if present
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!nonEmpty.length) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
}
