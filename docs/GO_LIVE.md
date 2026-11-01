# Before going live

## Tested (all pass: `npm test`, `test:integration`, `test:demo`, `test:ui`, `test:startup`, `test:matrix`, `test:robust`)
- Buy and sell, every payment method and every network type, each ending in completed, rejected (all four reasons), cancelled, expired or late proof.
- All 15 services with links from the right platform, minimum and maximum quantity, wrong-platform links refused.
- Stock: exact-limit orders work, one micro-USDT more is refused, 20 customers racing for stock for 10 buyers give exactly 10 winners.
- Double taps, parallel proofs, two admins pressing the same button together: one order, one confirmation, one message to the customer.
- About 660 hostile or malformed requests: no server errors. Other customers cannot read or touch someone else's order or receipt.
- Chat bot: every command, every flow, random typing, stickers and unknown buttons never leave it silent.
- Mini App: opens even when Telegram storage never answers; shows an error and retry instead of a blank screen; no sideways scroll at 320 px; hostile names are shown as text.
- Speed: typical requests 10-30 ms locally; first load is 20 script files, about 250 KB before compression.

## The owner must decide (the app cannot guess these)
1. Real prices for every service, real minimum and maximum quantities, and which services to keep.
2. Real payment accounts (Telebirr, CBE, ...) and real USDT deposit addresses. TRC20 currently has no deposit address, so customers cannot sell over TRC20 until one is entered.
3. Real buy and sell rates, order size limits, how long a customer has to pay, how many orders a customer may have open, stock amount.
4. Policies: the refund text promises a full refund when a confirmed order cannot be completed. Refunds are done by hand outside the app (reject with a reason, then pay back). Confirm that is the intended process.
5. Who the staff are (they can confirm and release orders but not change the shop).
6. Whether services are delivered by hand or through a provider. The app only records what the owner delivered; it does not send anything to a provider.
7. Daily limits or identity checks per customer: none exist today.
8. The legal side of selling USDT and taking bank transfers where the shop operates is the owner's responsibility; get local advice.

## Switching from the test shop to the friend's live shop
1. Remove the test data: delete the `wrangler d1 execute ... demo-data.sql` part from `ship` in package.json, run `scripts/clear-demo.sql` once, then enter the real data in the app.
2. Friend creates his own bot in BotFather and a Cloudflare account; set `ADMIN_IDS` in wrangler.toml to his Telegram id and `SUPPORT_USERNAME`; add his bot token as the secret `BOT_TOKEN`; open `/connect` once.
3. He presses Start in the bot once with his account so receipts can be stored in his chat.
4. Delete the GitHub token used for testing; `/revoke` the test bot token in BotFather.

## Free-plan limits to know
- Cloudflare Workers Free: 100,000 requests a day, 50 database/network calls per run (the 5-minute job therefore handles a few orders per run and catches up), D1 free storage 5 GB.
- Receipts live in Telegram. Telegram lets a bot delete its own messages only for 48 hours, so receipt files stay in the owner's chat; the order keeps working either way.
- Backups: D1 keeps point-in-time history for a limited time on the free plan. Export the database now and then (`wrangler d1 export neon-p2p --remote --output backup.sql`).
