// =====================================================================
// invoiceExtractionService.js
// Backs the "Upload invoice to auto-fill" option on New Purchase.
//
// Deliberately does NOT call any AI vendor's API (no Claude, Gemini,
// or ChatGPT key involved anywhere) -- everything here runs locally:
//   1. Digital PDFs: pdf-parse pulls the embedded text directly.
//   2. Scanned PDFs (no embedded text): pdf-parse renders page 1 to a
//      PNG, then tesseract.js (open-source OCR, runs on-device) reads it.
//   3. Photos/screenshots (JPEG/PNG): tesseract.js reads them directly.
// A set of regex heuristics then pulls the fields a typical vendor
// invoice contains (GSTIN, phone, dates, totals, a line-item table)
// out of that raw text.
//
// This is a best-effort reader, not a guarantee -- invoices vary a lot
// in layout, and OCR on a low-quality photo will miss things. Anything
// it can't confidently find comes back as null/empty so the person
// fills it in by hand, exactly as if they'd typed the form from
// scratch for that field.
// =====================================================================

import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';

// One OCR worker, created lazily on first use and reused after that --
// spinning a fresh tesseract worker up per request (each one loads a
// ~10MB language model) would make every extraction slow.
let workerPromise = null;
function getOcrWorker() {
  if (!workerPromise) workerPromise = createWorker('eng');
  return workerPromise;
}

async function ocrImageBuffer(buffer) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(buffer);
  return data.text || '';
}

async function readPdfBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    if (text && text.trim().replace(/\s+/g, '').length > 40) {
      return text; // digital PDF -- real embedded text, no OCR needed
    }
    // Little to no embedded text usually means a scanned page -- render
    // it to an image and OCR that instead.
    const shot = await parser.getScreenshot({ scale: 2, partial: [1] });
    const pageImage = shot?.pages?.[0]?.data;
    if (!pageImage) return text || '';
    return await ocrImageBuffer(pageImage);
  } finally {
    await parser.destroy();
  }
}

// --- Field heuristics -------------------------------------------------

function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function parseAmount(raw) {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Accepts DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, or "12 Jan 2026" style
// dates and normalizes to YYYY-MM-DD. Returns null if it can't tell.
function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/) || s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const parts = m.slice(1);
    const monthToken = parts.find((p) => isNaN(Number(p)) && p.length >= 3);
    const dayToken = parts.find((p) => !isNaN(Number(p)) && Number(p) <= 31);
    const yearToken = parts.find((p) => !isNaN(Number(p)) && Number(p) > 31);
    const monthIdx = months.indexOf(monthToken?.slice(0, 3).toLowerCase());
    if (monthIdx >= 0 && dayToken && yearToken) {
      return `${yearToken}-${String(monthIdx + 1).padStart(2, '0')}-${String(dayToken).padStart(2, '0')}`;
    }
  }
  return null;
}

function extractLineItems(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const headerIdx = lines.findIndex((l) => /\b(description|item|particulars?|product)\b/i.test(l) && /\b(qty|quantity|rate|amount|price)\b/i.test(l));
  if (headerIdx === -1) return []; // no recognizable table -- let the person add items by hand

  const stopIdx = lines.findIndex((l, i) => i > headerIdx && /\b(sub\s*-?\s*total|grand\s*total|total\s*amount|amount\s*payable|tax\s*amount)\b/i.test(l));
  const region = lines.slice(headerIdx + 1, stopIdx === -1 ? lines.length : stopIdx);

  const skipPattern = /\b(page \d|www\.|@|gstin|pan\s*no|ifsc|account\s*no|bank|declaration|terms)\b/i;
  const numberToken = /-?\d[\d,]*\.?\d*/g;

  const items = [];
  for (const line of region.slice(0, 30)) {
    if (skipPattern.test(line)) continue;
    const allMatches = [...line.matchAll(numberToken)];
    if (allMatches.length < 2) continue;

    // Only the trailing 2-3 numbers are treated as the qty/rate/amount
    // columns — taking every number on the line would misread a model
    // number inside the item name itself (e.g. "Dell Laptop 5420") as
    // a data column and chop it out of the description.
    const trailing = allMatches.slice(-3);
    const descriptionEnd = trailing[0].index;
    const description = line.slice(0, descriptionEnd).replace(/^[.\-\s]+|[.\-\s]+$/g, '').trim();
    if (!description || description.length < 2) continue;

    const nums = trailing.map((m) => parseAmount(m[0])).filter((n) => n != null);
    if (!nums.length) continue;

    const total = nums[nums.length - 1];
    const unitCost = nums.length >= 2 ? nums[nums.length - 2] : total;
    const maybeQty = nums.length >= 3 ? nums[0] : 1;
    const quantity = maybeQty > 0 && maybeQty < 1000 && Number.isInteger(maybeQty) ? maybeQty : 1;

    items.push({
      item_name: description.slice(0, 120),
      description: null,
      quantity,
      unit_cost: unitCost,
      tax_percent: null,
    });
    if (items.length >= 15) break;
  }
  return items;
}

function extractFields(text) {
  const flat = text.replace(/[ \t]+/g, ' ');

  const vendorGst = firstMatch(flat, [/\bGSTIN?\s*[:\-]?\s*([0-9A-Z]{15})\b/i]);
  const vendorPhone = firstMatch(flat, [/(?:Phone|Mobile|Contact|Tel|Ph)\.?\s*(?:No\.?)?\s*[:\-]?\s*(\+?[0-9][0-9\-\s]{7,14}[0-9])/i]);
  const invoiceNumber = firstMatch(flat, [/(?:Tax\s*)?Invoice\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Za-z0-9\/\-]+)/i, /Bill\s*No\.?\s*[:\-]?\s*([A-Za-z0-9\/\-]+)/i]);
  const rawDate = firstMatch(flat, [
    /(?:Invoice\s*Date|Order\s*Date|Bill\s*Date|Date)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(?:Invoice\s*Date|Order\s*Date|Bill\s*Date|Date)\s*[:\-]?\s*(\d{4}-\d{1,2}-\d{1,2})/i,
    /(?:Invoice\s*Date|Order\s*Date|Bill\s*Date|Date)\s*[:\-]?\s*(\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/i,
    /(?:Invoice\s*Date|Order\s*Date|Bill\s*Date|Date)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i,
  ]);

  let vendorName = firstMatch(flat, [/(?:Sold\s*By|Vendor|Seller|Company\s*Name|From)\s*[:\-]\s*([^\n,]{2,80})/i]);
  if (!vendorName) {
    const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2 && !/^(invoice|tax invoice|bill|receipt)$/i.test(l));
    vendorName = firstLine ? firstLine.slice(0, 80) : null;
  }

  const subtotal = parseAmount(firstMatch(flat, [/Sub\s*-?\s*Total\s*[:\-]?\s*[₹$]?\s*([\d,]+\.?\d{0,2})/i]));
  const taxAmount = parseAmount(firstMatch(flat, [/(?:Total\s*Tax|Tax\s*Amount|GST\s*Amount)\s*[:\-]?\s*[₹$]?\s*([\d,]+\.?\d{0,2})/i]));
  let taxPercent = parseAmount(firstMatch(flat, [/(\d{1,2}(?:\.\d+)?)\s?%\s*(?:GST|Tax|VAT)/i]));
  if (taxPercent == null && subtotal && taxAmount) {
    taxPercent = Math.round((taxAmount / subtotal) * 100);
  }

  const items = extractLineItems(text);
  if (taxPercent != null) items.forEach((it) => { it.tax_percent = taxPercent; });

  return {
    vendor_name: vendorName,
    vendor_gst_number: vendorGst,
    vendor_address: null, // address block layout varies too much to locate reliably -- left for manual entry
    vendor_phone: vendorPhone,
    order_date: normalizeDate(rawDate),
    invoice_number: invoiceNumber,
    items: items.length ? items : [{ item_name: '', description: null, quantity: 1, unit_cost: null, tax_percent: taxPercent }],
  };
}

/**
 * @param {{ buffer: Buffer, mimetype: string }} file - a multer memory-storage file (image/jpeg, image/png, or application/pdf)
 * @returns {Promise<object>} best-effort extraction -- any field it couldn't find comes back null
 */
export async function extractInvoiceData(file) {
  let text;
  try {
    text = file.mimetype === 'application/pdf'
      ? await readPdfBuffer(file.buffer)
      : await ocrImageBuffer(file.buffer);
  } catch (readErr) {
    const err = new Error(`Could not read that invoice file: ${readErr.message}`);
    err.status = 422;
    throw err;
  }

  if (!text || !text.trim()) {
    const err = new Error('Could not make out any text on that invoice -- try a clearer photo or fill the form in by hand.');
    err.status = 422;
    throw err;
  }

  return extractFields(text);
}
