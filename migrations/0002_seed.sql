-- Starting values. Payment accounts, USDT networks and services are NOT seeded: the owner adds them in the app
-- (Admin tab > Setup), so nothing about the shop's own accounts or prices lives in code.

-- Rates are ETB cents per 1 USDT. 0 = not set yet (the shop stays closed until the owner sets them).
INSERT INTO settings (key, value, updated_at) VALUES
  ('buy_rate_cents',      '0',          unixepoch()),   -- ETB the customer pays for 1 USDT
  ('sell_rate_cents',     '0',          unixepoch()),   -- ETB the customer receives for 1 USDT
  ('rate_updated_at',     '0',          unixepoch()),
  ('min_usdt_micro',      '5000000',    unixepoch()),   -- 5 USDT, changeable
  ('max_usdt_micro',      '0',          unixepoch()),   -- 0 = not set: the owner must enter it
  ('stock_usdt_micro',    '',           unixepoch()),   -- USDT the shop holds; '' = not tracked (no cap)
  ('stock_show',          '1',          unixepoch()),   -- 1: customers see how much is available
  ('stock_add_on_sell',   '1',          unixepoch()),   -- 1: USDT bought from customers is added to stock when the order completes
  ('order_ttl_min',       '30',         unixepoch()),
  ('max_open_orders',     '3',          unixepoch()),
  ('paused',              '0',          unixepoch()),
  ('proof_retention_days','90',         unixepoch()),   -- proofs of finished orders are deleted after this many days; 0 = keep
  ('admin_chat_id',       '',           unixepoch()),   -- where alerts go; empty = a private message to every admin
  ('alerts_tested',       '0',          unixepoch()),
  ('bot_username',        '',           unixepoch());

-- Terms and policies (draft: the owner should read and edit these in the app before opening).
-- The refund rule of the old bot was about deposits; this shop has no deposits, so it covers orders instead.
INSERT INTO policy_sections (sort, title_en, title_am, body_en, body_am) VALUES
  (1, 'How orders work', 'ትዕዛዝ እንዴት ይሰራል',
   'Every order has a payment window shown on the order. Pay the exact amount, then send your receipt in the app or in the chat. A team member checks it by hand and confirms. You are told here and by message at every step.',
   'እያንዳንዱ ትዕዛዝ በትዕዛዙ ላይ የሚታይ የክፍያ ጊዜ አለው። ትክክለኛውን መጠን ይክፈሉ፣ ከዚያም ደረሰኙን በመተግበሪያው ወይም በውይይቱ ይላኩ። የቡድን አባል በእጅ አረጋግጦ ያጸድቃል። በእያንዳንዱ ደረጃ እዚህና በመልዕክት ይነገርዎታል።'),
  (2, 'Refund policy', 'የገንዘብ ተመላሽ ፖሊሲ',
   'If we cannot complete your order after your payment was confirmed, we refund the full amount you paid. Once USDT or a service has been delivered, the order is final, except as described in the warranty section. USDT sent to a wallet address or network you entered wrongly cannot be recovered. A wrong profile link on a service order cannot be refunded. If you paid after the window closed, send the receipt anyway: we will either complete the order or refund you.',
   'ክፍያዎ ከተረጋገጠ በኋላ ትዕዛዝዎን ማጠናቀቅ ካልቻልን የከፈሉትን ሙሉ መጠን እንመልሳለን። USDT ወይም አገልግሎት ከደረሰ በኋላ ትዕዛዙ የመጨረሻ ነው፤ በዋስትና ክፍል ከተገለጸው በስተቀር። በስህተት ወደ ገቡት የዋሌት አድራሻ ወይም ኔትወርክ የተላከ USDT ሊመለስ አይችልም። በአገልግሎት ትዕዛዝ ላይ የተሳሳተ የፕሮፋይል ሊንክ ገንዘብ አይመለስበትም። የክፍያ ጊዜው ካለፈ በኋላ ከከፈሉ ደረሰኙን ይላኩ፤ ትዕዛዙን እናጠናቅቃለን ወይም እንመልስልዎታለን።'),
  (3, 'Warranty (services)', 'ዋስትና (አገልግሎቶች)',
   'Some services list a warranty period. If what we delivered drops during that period, we replace it or compensate you, as listed on the service. Services with no warranty listed are not covered.',
   'አንዳንድ አገልግሎቶች የዋስትና ጊዜ ይዘረዝራሉ። በዚያ ጊዜ ውስጥ የላክነው ቁጥር ቢቀንስ በአገልግሎቱ ላይ በተዘረዘረው መሠረት እንተካለን ወይም እንካሳለን። ዋስትና ያልተዘረዘረላቸው አገልግሎቶች አይሸፈኑም።'),
  (4, 'Our commitment', 'ቁርጠኝነታችን',
   'We are fully responsible for our services and work to make sure no customer is harmed or annoyed.',
   'ለአገልግሎቶቻችን ሙሉ ኃላፊነት እንወስዳለን፤ ማንም ደንበኛ እንዳይጎዳ ወይም እንዳይበሳጭ እንተጋለን።'),
  (5, 'Our promise', 'ቃል ኪዳናችን',
   'We promise to be honest and faithful with you, and to be the best at providing these services.',
   'ከእርስዎ ጋር ሐቀኛና ታማኝ ለመሆን፣ እነዚህን አገልግሎቶች በመስጠትም ምርጥ ለመሆን ቃል እንገባለን።'),
  (6, 'Safety tips', 'የደህንነት ምክሮች',
   'Only this official bot and app will ask for your payment receipt. Never share your wallet seed phrase or private key. Always send the exact ETB amount: paying more or less delays your order. Pick the network your wallet supports and double-check your address: transfers cannot be undone.',
   'የክፍያ ደረሰኝዎን የሚጠይቀው ይህ ይፋዊ ቦት እና መተግበሪያ ብቻ ነው። የዋሌት ሲድ ፍሬዝዎን ወይም የግል ቁልፍዎን ለማንም አያጋሩ። ሁልጊዜ ትክክለኛውን የብር መጠን ይላኩ፤ ከዚያ በላይ ወይም በታች መክፈል ትዕዛዝዎን ያዘገያል። ዋሌትዎ የሚደግፈውን ኔትወርክ ይምረጡ፣ አድራሻዎንም ደግመው ያረጋግጡ፤ ዝውውሮች ሊመለሱ አይችሉም።');
