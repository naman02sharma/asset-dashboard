// =====================================================================
// utils/poNumber.js
// Shared by purchaseController.js and assetController.js (both
// findOrCreateLocation copies, plus the "Generate PO" preview
// endpoint) so the location-code and PO-sequence logic lives in
// exactly one place instead of drifting between two copies.
// =====================================================================
import { pool } from '../config/db.js';

// Derives a 3-letter PO-number prefix from a location name (e.g.
// "Kolkata" -> "KOL"), guaranteed not to collide with any code
// already stored on ANOTHER location. Same candidate order as this
// feature's migration (019_po_number_generator.sql)'s one-time
// backfill: first 3 letters of the name, then "first 2 letters +
// digit" as a fallback for a genuine collision (e.g. "Delhi" vs
// "Delta Nagar"). Does NOT persist anything itself — the caller
// (findOrCreateLocation, or the preview endpoint below) decides
// whether to store the result.
export async function generateUniqueLocationCode(name, excludeId = null) {
  const letters = (name || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  let base = letters.slice(0, 3);
  if (base.length === 0) base = 'GEN';
  else if (base.length < 3) base = base.padEnd(3, 'X');

  const { rows } = await pool.query(
    excludeId
      ? `SELECT code FROM locations WHERE code IS NOT NULL AND id <> $1::uuid`
      : `SELECT code FROM locations WHERE code IS NOT NULL`,
    excludeId ? [excludeId] : []
  );
  const used = new Set(rows.map((r) => r.code));
  if (!used.has(base)) return base;

  for (let suffix = 1; suffix <= 99; suffix++) {
    const candidate = (base.slice(0, 2) + suffix).slice(0, 3);
    if (!used.has(candidate)) return candidate;
  }
  // Astronomically unlikely fallback (100+ locations colliding on the
  // same 2-letter root) — still deterministic-ish and still unique.
  return (base.slice(0, 1) + String(Date.now()).slice(-2)).slice(0, 3);
}

// The ONE global PO sequence, shared across every location and both
// creation flows (purchases.po_number and assets.po_number) — e.g.
// the first PO ever generated (any location) is #01, the next one
// (any location) is #02, and so on. Numbers off the HIGHEST suffix
// EVER issued (parsed back out of existing po_number values via
// regexp), not a COUNT — same defensive pattern as
// ensureAssetFromPurchase's asset-tag numbering, immune to rows being
// deleted later (deleting PO #03 doesn't let a future PO reuse #03).
export async function getNextGlobalPoSequence() {
  const { rows } = await pool.query(`
    SELECT COALESCE(MAX(n), 0) AS max_n FROM (
      SELECT (regexp_match(po_number, '_(\\d+)$'))[1]::int AS n
      FROM purchases WHERE po_number ~ '_[0-9]+$'
      UNION ALL
      SELECT (regexp_match(po_number, '_(\\d+)$'))[1]::int AS n
      FROM assets WHERE po_number ~ '_[0-9]+$'
    ) all_nums
  `);
  return (rows[0].max_n || 0) + 1;
}

// Powers the "Generate PO" button on both creation forms (New Asset
// Purchase and Inventory's New Asset — see GET /api/purchases/next-po).
// Works whether the typed location already exists (reuses its stored
// code) or is brand new (derives what code it WOULD get, without
// creating the location row yet — that only happens for real when the
// purchase/asset is actually submitted, via findOrCreateLocation).
// Purely a preview: calling this twice in a row without an actual
// create in between returns the same number both times.
export async function previewNextPoNumber(locationName) {
  const trimmed = (locationName || '').trim();
  if (!trimmed) return { po_number: null, location_code: null };

  const existing = await pool.query(
    `SELECT code FROM locations WHERE LOWER(name) = LOWER($1::text)`,
    [trimmed]
  );
  const code = existing.rows.length && existing.rows[0].code
    ? existing.rows[0].code
    : await generateUniqueLocationCode(trimmed);

  const nextSeq = await getNextGlobalPoSequence();
  const po_number = `po_${code.toLowerCase()}_${String(nextSeq).padStart(2, '0')}`;
  return { po_number, location_code: code };
}
