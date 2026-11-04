-- Plainer wording for two policy sections. Only rows still holding the original text are changed.
UPDATE policy_sections SET title_en = 'Who is responsible',
  body_en = 'Neon Store runs these services itself. If something goes wrong with an order, open a ticket in Support and a person will sort it out.'
  WHERE title_en = 'Our commitment' AND body_en LIKE 'We are fully responsible%';
UPDATE policy_sections SET title_en = 'Fixed rates',
  body_en = 'The rate you confirm is locked for that order. If the rate changes later, your order keeps the price you agreed to.'
  WHERE title_en = 'Our promise' AND body_en LIKE 'We promise to be honest%';
