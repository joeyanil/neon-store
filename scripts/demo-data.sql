-- TEST DATA for the test shop. Run once by `npm run ship` (guarded by the 'demo_seeded' marker), so a redeploy never
-- re-adds rows you deleted. It only fills in what is still EMPTY or at its default: anything you entered yourself is kept.
-- Everything here is a PLACEHOLDER: prices, account numbers and addresses are fake. Do not send real money to them.
-- To remove it before going live: delete `&& wrangler d1 execute ... demo-data.sql` from the "ship" script in package.json
-- and run scripts/clear-demo.sql (it switches off or deletes every row whose code starts with 'demo-').

-- Rates, limits, stock: only where still at the starting value
UPDATE settings SET value = '16850', updated_at = unixepoch() WHERE key = 'buy_rate_cents' AND value IN ('', '0') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
UPDATE settings SET value = '16300', updated_at = unixepoch() WHERE key = 'sell_rate_cents' AND value IN ('', '0') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
UPDATE settings SET value = CAST(unixepoch() AS TEXT), updated_at = unixepoch() WHERE key = 'rate_updated_at' AND value IN ('', '0') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
UPDATE settings SET value = '1000000000', updated_at = unixepoch() WHERE key = 'max_usdt_micro' AND value IN ('', '0') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
UPDATE settings SET value = '500000000', updated_at = unixepoch() WHERE key = 'stock_usdt_micro' AND value = '' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');

-- Payment accounts (only if none exist yet)
INSERT INTO birr_methods (code, kind, label_en, label_am, account_name, account_number, note, accept_buy, pay_sell, active, sort, created_at, updated_at)
SELECT 'demo-telebirr', 'mobile', 'Telebirr', 'ቴሌብር', 'TEST ACCOUNT', '0900000000', 'Test shop: do not send real money.', 1, 1, 1, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM birr_methods) AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO birr_methods (code, kind, label_en, label_am, account_name, account_number, note, accept_buy, pay_sell, active, sort, created_at, updated_at)
SELECT 'demo-cbe', 'bank', 'Commercial Bank of Ethiopia', 'የኢትዮጵያ ንግድ ባንክ', 'TEST ACCOUNT', '1000000000000', 'Test shop: do not send real money.', 1, 1, 1, 2, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM birr_methods WHERE code <> 'demo-telebirr') AND NOT EXISTS (SELECT 1 FROM birr_methods WHERE code = 'demo-cbe') AND (SELECT COUNT(*) FROM birr_methods) = 1 AND EXISTS (SELECT 1 FROM birr_methods WHERE code = 'demo-telebirr') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');

-- USDT networks (only if none exist yet). Deposit addresses are fake: the BEP20 one is the null address.
INSERT INTO usdt_networks (code, kind, label, deposit_address, accept_sell, send_buy, active, sort, created_at, updated_at)
SELECT 'demo-trc20', 'tron', 'USDT · TRON (TRC20)', '', 0, 1, 1, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM usdt_networks) AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO usdt_networks (code, kind, label, deposit_address, accept_sell, send_buy, active, sort, created_at, updated_at)
SELECT 'demo-bep20', 'evm', 'USDT · BNB Chain (BEP20)', '0x0000000000000000000000000000000000000000', 1, 1, 1, 2, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM usdt_networks) = 1 AND EXISTS (SELECT 1 FROM usdt_networks WHERE code = 'demo-trc20') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO usdt_networks (code, kind, label, deposit_address, accept_sell, send_buy, active, sort, created_at, updated_at)
SELECT 'demo-bybit', 'bybit_uid', 'Bybit UID (internal transfer)', '00000000', 1, 1, 1, 3, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM usdt_networks) = 2 AND EXISTS (SELECT 1 FROM usdt_networks WHERE code = 'demo-bep20') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');

-- Services (only if the price list is empty). Prices are ETB cents per 1,000: PLACEHOLDERS until the shop owner sends the real ones.
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tg-subs', 'telegram', 'Telegram subscribers', 9000, 100, 100000, 'Starts within 24 hours', 30, 'Test price: placeholder.', 1, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM service_items) AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tg-views', 'telegram', 'Telegram post views', 1500, 500, 1000000, 'Starts within 1 hour', 0, 'Test price: placeholder.', 1, 2, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 1 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tg-subs') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tg-likes', 'telegram', 'Telegram post likes', 3000, 50, 50000, 'Starts within 1 hour', 0, 'Test price: placeholder.', 1, 3, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 2 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tg-views') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tg-comments', 'telegram', 'Telegram comments', 60000, 10, 1000, 'Starts within 24 hours', 0, 'Test price: placeholder.', 1, 4, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 3 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tg-likes') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-ig-followers', 'instagram', 'Instagram followers', 15000, 100, 100000, 'Starts within 24 hours', 30, 'Test price: placeholder.', 1, 5, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 4 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tg-comments') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-ig-likes', 'instagram', 'Instagram likes', 5000, 50, 50000, 'Starts within 1 hour', 0, 'Test price: placeholder.', 1, 6, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 5 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-ig-followers') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-ig-comments', 'instagram', 'Instagram comments', 80000, 10, 1000, 'Starts within 24 hours', 0, 'Test price: placeholder.', 1, 7, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 6 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-ig-likes') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-ig-auto', 'instagram', 'Instagram auto likes (new posts)', 7000, 100, 50000, 'Runs on your next posts', 0, 'Test price: placeholder.', 1, 8, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 7 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-ig-comments') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tt-followers', 'tiktok', 'TikTok followers', 14000, 100, 100000, 'Starts within 24 hours', 30, 'Test price: placeholder.', 1, 9, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 8 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-ig-auto') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tt-views', 'tiktok', 'TikTok views', 1200, 500, 1000000, 'Starts within 1 hour', 0, 'Test price: placeholder.', 1, 10, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 9 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tt-followers') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tt-likes', 'tiktok', 'TikTok likes', 4000, 50, 50000, 'Starts within 1 hour', 0, 'Test price: placeholder.', 1, 11, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 10 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tt-views') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tt-shares', 'tiktok', 'TikTok shares', 6000, 50, 50000, 'Starts within 6 hours', 0, 'Test price: placeholder.', 1, 12, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 11 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tt-likes') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-tt-favorites', 'tiktok', 'TikTok favorites', 5000, 50, 50000, 'Starts within 6 hours', 0, 'Test price: placeholder.', 1, 13, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 12 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tt-shares') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-yt-subs', 'youtube', 'YouTube subscribers', 40000, 50, 10000, 'Starts within 48 hours', 30, 'Test price: placeholder.', 1, 14, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 13 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-tt-favorites') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
INSERT INTO service_items (code, platform, name_en, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
SELECT 'demo-yt-views', 'youtube', 'YouTube views', 12000, 500, 1000000, 'Starts within 24 hours', 0, 'Test price: placeholder.', 1, 15, unixepoch(), unixepoch()
WHERE (SELECT COUNT(*) FROM service_items) = 14 AND EXISTS (SELECT 1 FROM service_items WHERE code = 'demo-yt-subs') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');

-- Remember that this ran, so deleted rows are never re-added by a later deploy.
INSERT INTO settings (key, value, updated_at) SELECT 'demo_seeded', '1', unixepoch() WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'demo_seeded');
