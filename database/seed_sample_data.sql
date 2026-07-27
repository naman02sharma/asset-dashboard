-- =====================================================================
-- OPTIONAL sample data — run this only if you want a few example rows
-- to explore the dashboard with. Skip it entirely for a real deployment.
--   psql asset_dashboard -f database/seed_sample_data.sql
-- To remove it later, run database/clear_seed_data.sql.
-- =====================================================================

INSERT INTO vendors (id, name, website, contact_email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Dell Technologies', 'dell.com', 'sales@dell.com'),
    ('22222222-2222-2222-2222-222222222222', 'Herman Miller',     'hermanmiller.com', 'orders@hermanmiller.com'),
    ('33333333-3333-3333-3333-333333333333', 'Cisco Systems',     'cisco.com', 'enterprise@cisco.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, name, address) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mumbai HQ', 'Panvel, Navi Mumbai, MH'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bengaluru Office', 'Whitefield, Bengaluru, KA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchases (id, item_name, description, vendor_id, quantity, unit_cost,
                        order_status, order_date, expected_delivery_date,
                        delivery_location_id, courier_name, tracking_number)
VALUES
    ('c1111111-0000-0000-0000-000000000001', 'Dell Latitude 5440 Laptop', '16GB RAM / 512GB SSD, for engineering team',
     '11111111-1111-1111-1111-111111111111', 25, 82000.00, 'shipped', '2026-06-20', '2026-07-25',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BlueDart', 'BD1234567890'),
    ('c1111111-0000-0000-0000-000000000002', 'Aeron Office Chair', 'Ergonomic chairs for new hires',
     '22222222-2222-2222-2222-222222222222', 40, 45000.00, 'ordered', '2026-07-01', '2026-08-10',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'FedEx', 'FX9988776655'),
    ('c1111111-0000-0000-0000-000000000003', 'Cisco Catalyst 9200 Switch', '48-port network switch',
     '33333333-3333-3333-3333-333333333333', 6, 210000.00, 'delivered', '2026-05-10', '2026-06-01',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DHL', 'DHL5544332211')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchases (id, item_name, description, vendor_id, quantity, unit_cost,
                        order_status, order_date, expected_delivery_date,
                        delivery_location_id, courier_name, tracking_number)
VALUES
    ('c1111111-0000-0000-0000-000000000004', 'Dell UltraSharp Monitor 27"', 'Dual monitor setup for design team',
     '11111111-1111-1111-1111-111111111111', 30, 28000.00, 'delayed', '2026-06-01', '2026-07-05',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BlueDart', 'BD1112223334')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (purchase_id, amount, paid_on, method, reference) VALUES
    ('c1111111-0000-0000-0000-000000000001', 1025000.00, '2026-06-21', 'Bank Transfer', 'INV-2026-1001'),
    ('c1111111-0000-0000-0000-000000000001',  200000.00, '2026-07-10', 'Bank Transfer', 'INV-2026-1001-B'),
    ('c1111111-0000-0000-0000-000000000002',  900000.00, '2026-07-02', 'Credit Card',   'INV-2026-1002'),
    ('c1111111-0000-0000-0000-000000000003', 1260000.00, '2026-05-11', 'Bank Transfer', 'INV-2026-1003'),
    ('c1111111-0000-0000-0000-000000000004',  300000.00, '2026-06-02', 'Bank Transfer', 'INV-2026-1004');
