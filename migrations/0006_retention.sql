-- Review totals live in settings so the average survives when old orders are deleted.
INSERT OR REPLACE INTO settings (key, value, updated_at)
  SELECT 'review_count', CAST(COUNT(rating) AS TEXT), strftime('%s','now') FROM orders;
INSERT OR REPLACE INTO settings (key, value, updated_at)
  SELECT 'review_sum', CAST(COALESCE(SUM(rating), 0) AS TEXT), strftime('%s','now') FROM orders;
