-- Star reviews (1 to 5) with an optional comment, and the id of the post in the reviews channel so a later comment can be added to it.
ALTER TABLE orders ADD COLUMN rating INTEGER;
ALTER TABLE orders ADD COLUMN review_text TEXT;
ALTER TABLE orders ADD COLUMN review_msg_id INTEGER;
