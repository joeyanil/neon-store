// English and Amharic text. Amharic copy should be read by a native speaker before launch (see docs/DECISIONS.md).
const en = {
  app_name: 'Neon Store',
  nav_market: 'Market', nav_rates: 'Rates', nav_orders: 'Orders', nav_support: 'Support',
  back: 'Back', retry: 'Try again', close: 'Close', done: 'Done', copy: 'Copy', copied: 'Copied',

  hello: 'Hello, {name}',
  hello_sub: 'Swap USDT and birr, or grow your social pages.',
  buy_verb: 'Buy USDT', buy_hint: 'You pay in birr',
  sell_verb: 'Sell USDT', sell_hint: 'You get paid in birr',
  per_usdt: 'ETB per USDT', rate_soon: 'Rate coming soon', rates_updated: 'Rates updated {when}',
  paused_banner: 'Trading is paused. You can still track your orders.',
  rates_not_ready: 'Rates are not set yet. Check back soon.',
  open_orders: 'Open orders', recent_orders: 'Recent orders', see_all: 'See all',
  no_orders_title: 'No orders yet', no_orders_body: 'Your orders and their history will appear here.',
  start_trading: 'Start trading',

  trade_buy_title: 'Buy USDT', trade_sell_title: 'Sell USDT',
  amount_usdt: 'Amount in USDT', amount_ph: '0.00',
  range_hint: 'Min {min} · Max {max} USDT',
  you_pay: 'You pay', you_get: 'You get', rate_label: 'Rate',
  pay_with: 'Pay birr with', receive_via: 'Get birr on', network: 'USDT network',
  addr_label: 'Where should we send your USDT?', addr_ph_TRC20: 'Starts with T', addr_ph_BEP20: 'Starts with 0x', addr_ph_BYBIT_UID: 'Your Bybit UID (numbers)',
  addr_bad_TRC20: 'Enter a valid TRC20 address.', addr_bad_BEP20: 'Enter a valid BEP20 address.', addr_bad_BYBIT_UID: 'Enter a valid Bybit UID.',
  addr_warn: 'Check the address twice. Sent USDT cannot be recovered.',
  holder_name: 'Account holder name', holder_ph: 'Name on the account',
  account_no: 'Account or phone number', account_ph: 'Bank account or Telebirr number',
  name_bad: 'Enter the full name on the account.', account_bad: 'Enter a valid account or phone number.',
  amount_bad: 'Enter an amount, up to 6 decimals.', amount_min: 'The minimum is {min} USDT.', amount_max: 'The maximum is {max} USDT.',
  review_order: 'Review order', review_title: 'Check your order', confirm_order: 'Confirm order',
  rate_lock: 'The rate is locked for {min} minutes after you confirm.',
  row_you_buy: 'You buy', row_you_sell: 'You sell', row_total_pay: 'You pay', row_total_get: 'You get',
  row_method: 'Payment method', row_network: 'Network', row_address: 'Your USDT address', row_payout: 'Birr goes to',
  creating: 'Creating order…', order_created: 'Order created',

  status_awaiting_payment: 'Waiting for payment', status_evidence_submitted: 'Being checked', status_processing: 'In progress',
  status_completed: 'Completed', status_rejected: 'Rejected', status_cancelled: 'Cancelled', status_expired: 'Expired',
  order_buy: 'Buy {amount} USDT', order_sell: 'Sell {amount} USDT',
  order_no: 'Order number', order_total: 'Total', order_rate: 'Rate (locked)',
  time_left: 'Time left', time_up: 'Time is up',
  pay_title_buy: 'Send birr', pay_title_sell: 'Send USDT',
  pay_exact_birr: 'Send exactly', pay_exact_usdt: 'Send exactly',
  pay_to_name: 'Account name', pay_to_number: 'Account number', pay_via: 'Pay via',
  pay_addr: 'Deposit address', pay_network: 'Network',
  pay_note_buy: 'After you pay, add your receipt below so we can confirm it.',
  pay_note_sell: 'Send only USDT on {network}. Other coins or networks are lost. Then add your transaction ID or a screenshot below.',
  evidence_title_buy: 'Your payment screenshot', evidence_title_sell: 'Your transfer screenshot',
  evidence_ph_buy: 'Transaction number (optional)', evidence_ph_sell: 'Transaction ID or hash (optional)',
  attach_photo: 'Add your screenshot (required)', change_photo: 'Change screenshot', photo_hint: 'JPG, PNG or WebP',
  send_receipt: 'Send receipt', receipt_sent: 'Receipt sent',
  evidence_needed_buy: 'Add your receipt screenshot or the transaction number.', evidence_needed_sell: 'Add the transaction ID or a screenshot.',
  add_another: 'Add another receipt',
  cancel_order: 'Cancel order', cancel_confirm: 'Cancel this order? You have not sent any payment details yet.', order_cancelled: 'Order cancelled',
  wait_review_title: 'We are checking your payment', wait_review_body: 'An admin is confirming it now. You will get a message here as soon as it moves.',
  proc_title_buy: 'Payment confirmed', proc_body_buy: 'We are sending your USDT to your address.',
  proc_title_sell: 'USDT received', proc_body_sell: 'We are sending your birr to your account.',
  done_title_buy: 'USDT sent', done_body_buy: 'Your USDT is on its way to your address.',
  done_title_sell: 'Birr sent', done_body_sell: 'Your birr was sent to your account.',
  reference: 'Reference', rejected_title: 'This order was not accepted', rejected_body: 'If you already paid, contact support now and mention the order number.',
  expired_title: 'This order expired', expired_body: 'No payment details arrived in time. If you already paid, contact support now and mention the order number.',
  cancelled_title: 'You cancelled this order', cancelled_body: 'Nothing was charged.',
  contact_support: 'Contact support', new_order: 'New order', history: 'History',
  ev_created: 'Order created', ev_receipt: 'Receipt sent', ev_receipt_more: 'Another receipt sent', ev_processing_buy: 'Payment confirmed', ev_processing_sell: 'USDT received',
  ev_completed_buy: 'USDT sent', ev_completed_sell: 'Birr sent', ev_rejected: 'Order rejected', ev_cancelled: 'You cancelled the order', ev_expired: 'Order expired', ev_reference: 'Reference added',
  by_you: 'You', by_admin: 'Team', by_system: 'Automatic',
  order_id_copied: 'Order number copied',

  orders_title: 'Your orders', filter_active: 'Open', filter_done: 'History', load_more: 'Show more',
  empty_active_title: 'No open orders', empty_active_body: 'Start a buy or sell and it will appear here.',
  empty_done_title: 'No history yet', empty_done_body: 'Finished orders are kept here.',

  rates_title: 'Rates', rates_sub: 'Rates are set by the team and can change during the day.',
  rate_you_buy: 'You buy at', rate_you_sell: 'You sell at', order_size: 'Order size', calc_title: 'Quick calculator', calc_amount: 'USDT amount',
  calc_buy: 'To buy this you pay', calc_sell: 'Selling this you get', order_window: 'Time to pay', minutes: '{n} minutes', rate_when_updated: 'Last updated',

  support_title: 'Support', support_sub: 'A person reads every message.',
  support_chat: 'Message support', support_hint: 'Include your order number so we can find it fast.',
  support_unavailable: 'Support contact is not set up yet.',
  faq_title: 'Common questions',
  faq1_q: 'How does an order work?', faq1_a: 'Pick an amount and place the order. Send the payment, then upload your receipt. An admin checks it and finishes the order. You get a message at each step.',
  faq2_q: 'How long does it take?', faq2_a: 'It starts once an admin confirms your payment. If it feels slow, message support with your order number.',
  faq3_q: 'I paid but my order says expired', faq3_a: 'Contact support right away with your order number and receipt. Do not pay again.',
  faq4_q: 'Which network should I use?', faq4_a: 'Use the network you chose in the order. Sending on another network can lose your funds.',
  faq5_q: 'Is the rate fixed?', faq5_a: 'Yes. The rate you see when you confirm is locked for that order. New orders use the new rate.',
  settings_title: 'Settings', language: 'Language', theme: 'Appearance', theme_auto: 'Auto', theme_light: 'Light', theme_dark: 'Dark',
  allow_msgs: 'Get order updates here', allow_msgs_body: 'Allow the bot to message you when an order moves.', allow: 'Allow messages', allowed_msgs: 'Order updates are on',

  err_network_error: 'No connection. Check your internet and try again.',
  err_server_error: 'Something went wrong on our side. Try again in a moment.',
  err_unauthorized: 'Open this app from Telegram.',
  err_session_expired: 'Your session ended. Close the app and open it again.',
  err_rate_not_set: 'Rates are not set yet. Try again soon.',
  err_paused: 'Trading is paused for now. Check back soon.',
  err_bad_amount: 'Enter an amount in USDT, up to 6 decimals.',
  err_amount_out_of_range: 'That amount is outside the allowed range.',
  err_bad_address: 'That address does not look right. Check it and try again.',
  err_bad_method: 'Choose a payment method.', err_bad_network: 'Choose a network.',
  err_bad_name: 'Enter the account holder name.', err_bad_account: 'Enter a valid account or phone number.',
  err_too_many_open: 'You have too many open orders. Finish or cancel one first.',
  err_not_configured: 'This option is not available right now. Choose another.',
  err_not_found: 'We could not find that order.',
  err_not_open: 'This order is no longer waiting for payment details.',
  err_expired: 'This order expired. If you already paid, contact support with your order number.',
  err_no_evidence: 'Add a screenshot or transaction number first.', err_screenshot_required: 'A screenshot of your payment is required. Add one and send again.',
  err_bad_photo: 'Use a JPG, PNG or WebP image.', err_photo_too_large: 'That image is too large. Use one under 6 MB.',
  err_too_many_evidence: 'You reached the limit for this order. Contact support.',
  err_not_cancellable: 'This order can no longer be cancelled because payment details were already sent.',
  err_admin_unreachable: 'We could not reach the team right now. Try again in a minute.',

  min_ago: '{n} min ago', hour_ago: '{n} h ago', day_ago: '{n} d ago', just_now: 'just now', today: 'Today', yesterday: 'Yesterday',
};

const am = {
  app_name: 'ኒዮን ስቶር',
  nav_market: 'ገበያ', nav_rates: 'ዋጋ', nav_orders: 'ትዕዛዞች', nav_support: 'ድጋፍ',
  back: 'ተመለስ', retry: 'እንደገና ሞክር', close: 'ዝጋ', done: 'ተጠናቋል', copy: 'ቅዳ', copied: 'ተቀድቷል',

  hello: 'ሰላም {name}',
  hello_sub: 'USDT በብር ይግዙ ወይም ይሽጡ። እያንዳንዱ ትዕዛዝ በአስተዳዳሪ ይረጋገጣል።',
  buy_verb: 'USDT ግዛ', buy_hint: 'በብር ይከፍላሉ',
  sell_verb: 'USDT ሽጥ', sell_hint: 'በብር ይከፈላሉ',
  per_usdt: 'ብር በ1 USDT', rate_soon: 'ዋጋ በቅርቡ ይገባል', rates_updated: 'ዋጋ የተሻሻለው {when}',
  paused_banner: 'ግብይት ለጊዜው ቆሟል። ትዕዛዞችዎን መከታተል ይችላሉ።',
  rates_not_ready: 'ዋጋ እየተሰራ ነው። ከጥቂት ደቂቃዎች በኋላ ይመለሱ።',
  open_orders: 'ክፍት ትዕዛዞች', recent_orders: 'የቅርብ ጊዜ ትዕዛዞች', see_all: 'ሁሉንም ይመልከቱ',
  no_orders_title: 'እስካሁን ትዕዛዝ የለም', no_orders_body: 'የግዢና የሽያጭ ትዕዛዞችዎ ከሙሉ ታሪካቸው ጋር እዚህ ይታያሉ።',
  start_trading: 'ግብይት ጀምር',

  trade_buy_title: 'USDT ግዛ', trade_sell_title: 'USDT ሽጥ',
  amount_usdt: 'የ USDT መጠን', amount_ph: '0.00',
  range_hint: 'ዝቅተኛ {min} · ከፍተኛ {max} USDT',
  you_pay: 'የሚከፍሉት', you_get: 'የሚያገኙት', rate_label: 'ዋጋ',
  pay_with: 'ብሩን የሚከፍሉበት', receive_via: 'ብሩን የሚቀበሉበት', network: 'የ USDT ኔትወርክ',
  addr_label: 'USDT ወደ የት ይላክልዎ?', addr_ph_TRC20: 'በ T ይጀምራል', addr_ph_BEP20: 'በ 0x ይጀምራል', addr_ph_BYBIT_UID: 'የ Bybit UID (ቁጥሮች)',
  addr_bad_TRC20: 'ትክክለኛ TRC20 አድራሻ ያስገቡ።', addr_bad_BEP20: 'ትክክለኛ BEP20 አድራሻ ያስገቡ።', addr_bad_BYBIT_UID: 'ትክክለኛ Bybit UID ያስገቡ።',
  addr_warn: 'አድራሻውን ሁለት ጊዜ ያረጋግጡ። የተላከ USDT መመለስ አይቻልም።',
  holder_name: 'የሂሳቡ ባለቤት ስም', holder_ph: 'በሂሳቡ ላይ ያለው ስም',
  account_no: 'የሂሳብ ወይም ስልክ ቁጥር', account_ph: 'የባንክ ሂሳብ ወይም ቴሌብር ቁጥር',
  name_bad: 'በሂሳቡ ላይ ያለውን ሙሉ ስም ያስገቡ።', account_bad: 'ትክክለኛ የሂሳብ ወይም የስልክ ቁጥር ያስገቡ።',
  amount_bad: 'መጠን ያስገቡ፣ እስከ 6 የአስርዮሽ ቦታ።', amount_min: 'ዝቅተኛው {min} USDT ነው።', amount_max: 'ከፍተኛው {max} USDT ነው።',
  review_order: 'ትዕዛዙን ገምግም', review_title: 'ትዕዛዝዎን ያረጋግጡ', confirm_order: 'ትዕዛዙን አረጋግጥ',
  rate_lock: 'ካረጋገጡ በኋላ ዋጋው ለ{min} ደቂቃ ይቆለፋል።',
  row_you_buy: 'የሚገዙት', row_you_sell: 'የሚሸጡት', row_total_pay: 'የሚከፍሉት', row_total_get: 'የሚያገኙት',
  row_method: 'የክፍያ መንገድ', row_network: 'ኔትወርክ', row_address: 'የ USDT አድራሻዎ', row_payout: 'ብሩ የሚላከው ወደ',
  creating: 'ትዕዛዙ እየተፈጠረ ነው…', order_created: 'ትዕዛዙ ተፈጥሯል',

  status_awaiting_payment: 'ክፍያ በመጠበቅ ላይ', status_evidence_submitted: 'በመረጋገጥ ላይ', status_processing: 'በሂደት ላይ',
  status_completed: 'ተጠናቋል', status_rejected: 'አልተቀበለም', status_cancelled: 'ተሰርዟል', status_expired: 'ጊዜው አልፏል',
  order_buy: '{amount} USDT ግዢ', order_sell: '{amount} USDT ሽያጭ',
  order_no: 'የትዕዛዝ ቁጥር', order_total: 'ጠቅላላ', order_rate: 'ዋጋ (የተቆለፈ)',
  time_left: 'የቀረ ጊዜ', time_up: 'ጊዜው አልቋል',
  pay_title_buy: 'ብር ይላኩ', pay_title_sell: 'USDT ይላኩ',
  pay_exact_birr: 'በትክክል ይላኩ', pay_exact_usdt: 'በትክክል ይላኩ',
  pay_to_name: 'የሂሳብ ስም', pay_to_number: 'የሂሳብ ቁጥር', pay_via: 'የክፍያ መንገድ',
  pay_addr: 'የገቢ አድራሻ', pay_network: 'ኔትወርክ',
  pay_note_buy: 'ከከፈሉ በኋላ እናረጋግጠው ዘንድ ደረሰኝዎን ከታች ያክሉ።',
  pay_note_sell: 'USDT ብቻ በ{network} ይላኩ። ሌላ ሳንቲም ወይም ኔትወርክ ይጠፋል። ከዚያ የግብይት መለያ ቁጥሩን ወይም ስክሪንሾት ከታች ያክሉ።',
  evidence_title_buy: 'የክፍያ ደረሰኝዎ', evidence_title_sell: 'የዝውውር ማስረጃዎ',
  evidence_ph_buy: 'በደረሰኙ ላይ ያለው የግብይት ቁጥር (አማራጭ)', evidence_ph_sell: 'የግብይት መለያ ቁጥር ወይም ሃሽ',
  attach_photo: 'ስክሪንሾትዎን ያክሉ (ግዴታ)', change_photo: 'ስክሪንሾት ቀይር', photo_hint: 'JPG፣ PNG ወይም WebP',
  send_receipt: 'ደረሰኝ ላክ', receipt_sent: 'ደረሰኝ ተልኳል',
  evidence_needed_buy: 'የደረሰኝ ስክሪንሾት ወይም የግብይት ቁጥር ያክሉ።', evidence_needed_sell: 'የግብይት መለያ ቁጥር ወይም ስክሪንሾት ያክሉ።',
  add_another: 'ሌላ ደረሰኝ ያክሉ',
  cancel_order: 'ትዕዛዙን ሰርዝ', cancel_confirm: 'ይህን ትዕዛዝ ይሰርዙ? እስካሁን የክፍያ ዝርዝር አልላኩም።', order_cancelled: 'ትዕዛዙ ተሰርዟል',
  wait_review_title: 'ክፍያዎን እያረጋገጥን ነው', wait_review_body: 'አስተዳዳሪ አሁን እያረጋገጠው ነው። ሲቀጥል እዚህ መልዕክት ይደርስዎታል።',
  proc_title_buy: 'ክፍያ ተረጋግጧል', proc_body_buy: 'USDT ወደ አድራሻዎ እየላክን ነው።',
  proc_title_sell: 'USDT ደርሷል', proc_body_sell: 'ብሩን ወደ ሂሳብዎ እየላክን ነው።',
  done_title_buy: 'USDT ተልኳል', done_body_buy: 'USDT ወደ አድራሻዎ እየሄደ ነው።',
  done_title_sell: 'ብር ተልኳል', done_body_sell: 'ብሩ ወደ ሂሳብዎ ተልኳል።',
  reference: 'ማጣቀሻ', rejected_title: 'ይህ ትዕዛዝ አልተቀበለም', rejected_body: 'ቀድሞ ከከፈሉ አሁኑኑ ድጋፍን ያነጋግሩ፣ የትዕዛዙንም ቁጥር ይጥቀሱ።',
  expired_title: 'የዚህ ትዕዛዝ ጊዜ አልፏል', expired_body: 'የክፍያ ዝርዝር በጊዜው አልደረሰም። ቀድሞ ከከፈሉ አሁኑኑ ድጋፍን ያነጋግሩ፣ የትዕዛዙንም ቁጥር ይጥቀሱ።',
  cancelled_title: 'ይህን ትዕዛዝ ሰርዘዋል', cancelled_body: 'ምንም አልተከፈለም።',
  contact_support: 'ድጋፍን አነጋግር', new_order: 'አዲስ ትዕዛዝ', history: 'ታሪክ',
  ev_created: 'ትዕዛዙ ተፈጥሯል', ev_receipt: 'ደረሰኝ ተልኳል', ev_receipt_more: 'ሌላ ደረሰኝ ተልኳል', ev_processing_buy: 'ክፍያ ተረጋግጧል', ev_processing_sell: 'USDT ደርሷል',
  ev_completed_buy: 'USDT ተልኳል', ev_completed_sell: 'ብር ተልኳል', ev_rejected: 'ትዕዛዙ አልተቀበለም', ev_cancelled: 'ትዕዛዙን ሰርዘዋል', ev_expired: 'የትዕዛዙ ጊዜ አልፏል', ev_reference: 'ማጣቀሻ ተጨምሯል',
  by_you: 'እርስዎ', by_admin: 'ቡድኑ', by_system: 'በራስ-ሰር',
  order_id_copied: 'የትዕዛዝ ቁጥሩ ተቀድቷል',

  orders_title: 'ትዕዛዞችዎ', filter_active: 'ክፍት', filter_done: 'ታሪክ', load_more: 'ተጨማሪ አሳይ',
  empty_active_title: 'ክፍት ትዕዛዝ የለም', empty_active_body: 'ግዢ ወይም ሽያጭ ይጀምሩ፣ እዚህ ይታያል።',
  empty_done_title: 'እስካሁን ታሪክ የለም', empty_done_body: 'የተጠናቀቁ ትዕዛዞች እዚህ ይቀመጣሉ።',

  rates_title: 'ዋጋ', rates_sub: 'ዋጋው በቡድኑ ይወሰናል፣ በቀን ውስጥም ሊለወጥ ይችላል።',
  rate_you_buy: 'የሚገዙበት ዋጋ', rate_you_sell: 'የሚሸጡበት ዋጋ', order_size: 'የትዕዛዝ መጠን', calc_title: 'ፈጣን ማስያ', calc_amount: 'የ USDT መጠን',
  calc_buy: 'ይህን ለመግዛት የሚከፍሉት', calc_sell: 'ይህን ሲሸጡ የሚያገኙት', order_window: 'ለመክፈል የሚሰጥ ጊዜ', minutes: '{n} ደቂቃ', rate_when_updated: 'መጨረሻ የተሻሻለው',

  support_title: 'ድጋፍ', support_sub: 'እውነተኛ ሰዎች፣ ብዙውን ጊዜ በፍጥነት ይመልሳሉ።',
  support_chat: 'ለድጋፍ ጻፍ', support_hint: 'በፍጥነት እንድናገኘው የትዕዛዝ ቁጥርዎን ያካትቱ።',
  support_unavailable: 'የድጋፍ አድራሻ እስካሁን አልተዘጋጀም።',
  faq_title: 'የተለመዱ ጥያቄዎች',
  faq1_q: 'ትዕዛዝ እንዴት ይሰራል?', faq1_a: 'መጠን መርጠው ትዕዛዙን ያስገባሉ። ከዚያ ክፍያውን ልከው ደረሰኝዎን ይጭናሉ። አስተዳዳሪ አረጋግጦ ትዕዛዝዎን ያጠናቅቃል። በእያንዳንዱ ደረጃ መልዕክት ይደርስዎታል።',
  faq2_q: 'ምን ያህል ጊዜ ይወስዳል?', faq2_a: 'አስተዳዳሪው ክፍያዎን ካረጋገጠ በኋላ አብዛኞቹ ትዕዛዞች በደቂቃዎች ውስጥ ይጠናቀቃሉ። ከዘገየ የትዕዛዝ ቁጥርዎን ይዘው ለድጋፍ ይጻፉ።',
  faq3_q: 'ከፍያለሁ ግን ትዕዛዙ ጊዜው አልፏል ይላል', faq3_a: 'የትዕዛዝ ቁጥርዎንና ደረሰኝዎን ይዘው አሁኑኑ ድጋፍን ያነጋግሩ። እንደገና አይክፈሉ።',
  faq4_q: 'የትኛውን ኔትወርክ ልጠቀም?', faq4_a: 'በትዕዛዙ ላይ የመረጡትን ኔትወርክ ይጠቀሙ። በሌላ ኔትወርክ መላክ ገንዘብዎን ለዘላለም ሊያጠፋ ይችላል።',
  faq5_q: 'ዋጋው ቋሚ ነው?', faq5_a: 'አዎ። ሲያረጋግጡ ያዩት ዋጋ ለዚያ ትዕዛዝ ይቆለፋል። አዲስ ትዕዛዝ አዲሱን ዋጋ ይጠቀማል።',
  settings_title: 'ቅንብሮች', language: 'ቋንቋ', theme: 'መልክ', theme_auto: 'ራስ-ሰር', theme_light: 'ብሩህ', theme_dark: 'ጨለማ',
  allow_msgs: 'የትዕዛዝ ዜናዎችን እዚህ ያግኙ', allow_msgs_body: 'ትዕዛዝ ሲቀጥል ቦቱ መልዕክት እንዲልክልዎ ይፍቀዱ።', allow: 'መልዕክቶችን ፍቀድ', allowed_msgs: 'የትዕዛዝ ዜናዎች በርተዋል',

  err_network_error: 'ግንኙነት የለም። ኢንተርኔትዎን ያረጋግጡና እንደገና ይሞክሩ።',
  err_server_error: 'በእኛ በኩል ችግር ተፈጥሯል። ጥቂት ቆይተው እንደገና ይሞክሩ።',
  err_unauthorized: 'ይህን መተግበሪያ ከቴሌግራም ይክፈቱ።',
  err_session_expired: 'ክፍለ ጊዜዎ አብቅቷል። መተግበሪያውን ዘግተው እንደገና ይክፈቱ።',
  err_rate_not_set: 'ዋጋ እየተሻሻለ ነው። ከጥቂት ደቂቃዎች በኋላ ይሞክሩ።',
  err_paused: 'ግብይት ለጊዜው ቆሟል። በቅርቡ ይመለሱ።',
  err_bad_amount: 'የ USDT መጠን ያስገቡ፣ እስከ 6 የአስርዮሽ ቦታ።',
  err_amount_out_of_range: 'ይህ መጠን ከተፈቀደው ክልል ውጭ ነው።',
  err_bad_address: 'አድራሻው ትክክል አይመስልም። አረጋግጠው እንደገና ይሞክሩ።',
  err_bad_method: 'የክፍያ መንገድ ይምረጡ።', err_bad_network: 'ኔትወርክ ይምረጡ።',
  err_bad_name: 'የሂሳቡን ባለቤት ስም ያስገቡ።', err_bad_account: 'ትክክለኛ የሂሳብ ወይም የስልክ ቁጥር ያስገቡ።',
  err_too_many_open: 'ብዙ ክፍት ትዕዛዞች አሉዎት። መጀመሪያ አንዱን ይጨርሱ ወይም ይሰርዙ።',
  err_not_configured: 'ይህ አማራጭ አሁን አይገኝም። ሌላ ይምረጡ።',
  err_not_found: 'ያንን ትዕዛዝ ማግኘት አልቻልንም።',
  err_not_open: 'ይህ ትዕዛዝ የክፍያ ዝርዝር አይጠብቅም።',
  err_expired: 'የዚህ ትዕዛዝ ጊዜ አልፏል። ቀድሞ ከከፈሉ የትዕዛዝ ቁጥርዎን ይዘው ድጋፍን ያነጋግሩ።',
  err_no_evidence: 'መጀመሪያ ስክሪንሾት ወይም የግብይት ቁጥር ያክሉ።', err_screenshot_required: 'የክፍያ ስክሪንሾት ግዴታ ነው። ያክሉና እንደገና ይላኩ።',
  err_bad_photo: 'JPG፣ PNG ወይም WebP ምስል ይጠቀሙ።', err_photo_too_large: 'ምስሉ በጣም ትልቅ ነው። ከ6 MB በታች የሆነ ይጠቀሙ።',
  err_too_many_evidence: 'ለዚህ ትዕዛዝ የተፈቀደውን ገደብ ደርሰዋል። ድጋፍን ያነጋግሩ።',
  err_not_cancellable: 'የክፍያ ዝርዝር ስለተላከ ይህ ትዕዛዝ ከዚህ በኋላ አይሰረዝም።',
  err_admin_unreachable: 'አሁን ቡድኑን ማግኘት አልቻልንም። ከደቂቃ በኋላ እንደገና ይሞክሩ።',

  min_ago: 'ከ{n} ደቂቃ በፊት', hour_ago: 'ከ{n} ሰዓት በፊት', day_ago: 'ከ{n} ቀን በፊት', just_now: 'አሁን', today: 'ዛሬ', yesterday: 'ትናንት',
};

import { am as amMore, en as enMore } from './i18n-more.js';
Object.assign(en, enMore);
Object.assign(am, amMore);
const DICTS = { en, am };
let lang = 'en';

export const getLang = () => lang;
export function setLang(next) {
  lang = next === 'am' ? 'am' : 'en';
  document.documentElement.lang = lang;
}

export function t(key, params) {
  let s = DICTS[lang][key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Message for an API error code, falling back to the server's text. */
export function errorText(err) {
  const key = `err_${err?.code}`;
  return key in en ? t(key) : err?.message || t('err_server_error');
}

/** "Today 14:05", "Yesterday 09:30", or "Oct 21, 14:05". Always the Gregorian calendar with Latin digits. */
export function formatWhen(unixSec) {
  const d = new Date(unixSec * 1000);
  const loc = lang === 'am' ? 'am' : 'en-GB';
  const opts = { calendar: 'gregory', numberingSystem: 'latn' };
  const time = new Intl.DateTimeFormat(loc, { ...opts, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const now = new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (diffDays === 0) return `${t('today')} ${time}`;
  if (diffDays === 1) return `${t('yesterday')} ${time}`;
  const date = new Intl.DateTimeFormat(loc, { ...opts, month: 'short', day: 'numeric' }).format(d);
  return `${date}, ${time}`;
}

export function formatAgo(unixSec, nowSec) {
  const diff = Math.max(0, nowSec - unixSec);
  if (diff < 90) return t('just_now');
  if (diff < 3600) return t('min_ago', { n: Math.round(diff / 60) });
  if (diff < 86_400) return t('hour_ago', { n: Math.round(diff / 3600) });
  return t('day_ago', { n: Math.round(diff / 86_400) });
}
