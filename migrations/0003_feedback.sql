-- Customer feedback after an order is completed ("good" or "bad"), posted to the shop's reviews channel.
ALTER TABLE orders ADD COLUMN feedback TEXT;
ALTER TABLE orders ADD COLUMN feedback_at INTEGER;
