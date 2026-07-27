-- =====================================================================
-- Removes ONLY the 4 sample purchases (and their payments/vendors/
-- locations) that shipped with this project, by their fixed seed IDs.
-- Safe to run even if you've already added your own real purchases:
--   * Purchases are matched by their exact seed IDs, so your own
--     purchases are never touched.
--   * Vendors/locations are only removed if NO purchase (seed or
--     real) still references them — if you used "Cisco Systems" (or
--     any other seed vendor/location) for a real purchase, that
--     vendor/location is safely left in place instead of erroring out.
--   psql asset_dashboard -f database/clear_seed_data.sql
-- =====================================================================

DELETE FROM purchases WHERE id IN (
    'c1111111-0000-0000-0000-000000000001',
    'c1111111-0000-0000-0000-000000000002',
    'c1111111-0000-0000-0000-000000000003',
    'c1111111-0000-0000-0000-000000000004'
); -- payments and delivery_events for these cascade-delete automatically

DELETE FROM vendors v WHERE v.id IN (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'
) AND NOT EXISTS (
    SELECT 1 FROM purchases p WHERE p.vendor_id = v.id
); -- skips any seed vendor still used by a real purchase, instead of erroring

DELETE FROM locations l WHERE l.id IN (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
) AND NOT EXISTS (
    SELECT 1 FROM purchases p WHERE p.delivery_location_id = l.id
); -- skips any seed location still used by a real purchase, instead of erroring
