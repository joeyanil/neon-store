-- Removes the test data added by demo-data.sql. Rows an order already points at are switched off instead of deleted.
-- Run:  npx wrangler d1 execute neon-p2p --remote --file=scripts/clear-demo.sql
UPDATE birr_methods SET active = 0 WHERE code LIKE 'demo-%';
UPDATE usdt_networks SET active = 0 WHERE code LIKE 'demo-%';
UPDATE service_items SET active = 0 WHERE code LIKE 'demo-%';
DELETE FROM birr_methods WHERE code LIKE 'demo-%' AND code NOT IN (SELECT method_code FROM orders);
DELETE FROM usdt_networks WHERE code LIKE 'demo-%' AND code NOT IN (SELECT network_code FROM orders WHERE network_code IS NOT NULL);
DELETE FROM service_items WHERE code LIKE 'demo-%' AND code NOT IN (SELECT service_code FROM orders WHERE service_code IS NOT NULL);
