# Decisions, answers and open items

## Decided with the owner

| Question | Decision |
|---|---|
| Bot or Mini App? | **Both, in the same bot, both complete.** The Mini App opens from the "Open App" menu button; chat mode has buttons, progress lines and edit-in-place messages. Anything one can do, the other can. |
| What does the shop sell? | USDT buy/sell, and the "Neon Ghost" social-media services (Telegram, Instagram, TikTok, YouTube). The old Vendor X subscription products are **not** part of the shop. |
| Hosting | Cloudflare Workers + D1 + R2 (free tier). R2 holds customer proofs privately. |
| Payment confirmation | **Manual.** Customer uploads a proof, an admin checks it and releases. |
| Fees | **None.** Whatever Bybit deducts comes out of the shop's margin, so the app never adds a fee. |
| Minimum order | 5 USDT by default, editable. |
| Maximum order | No built-in maximum. The owner enters it; the shop stays closed until it is set. |
| USDT stock | The owner types the USDT amount held. It drops when buy orders complete, can be edited, and can be shown or hidden from customers. When hidden, error messages never reveal the number. Sells add to stock only if the owner turns that on. |
| Policies | Copied from the old bots, minus the deposit-refund rule. They are seeded as drafts and edited in the app. |
| "CBE unlocks after N orders" | Now a per-payment-method **unlock rule** (completed orders, USDT traded, more completed than cancelled). Locked methods show the customer what is missing. |
| Data | Fresh start, nothing migrated. |
| Switching the real bot | Last step, done by the owner after testing with a test bot. |
| Prices for services | The owner will provide them; they are entered in Admin > Services. |

## Everything else I chose (overrule any of it)

| Question | Choice | Why |
|---|---|---|
| Rates | Set by the owner; locked into each order. | No exchange feed; customers never see a rate change mid-order. |
| Order lifetime | 30 minutes to pay (editable); a cron job expires unpaid orders every 5 minutes. A proof sent within 24 hours after expiry still reaches an admin, marked late. | Real customers pay late. |
| Open orders | 3 per customer (editable). | Limits abuse. |
| Languages | English and Amharic. | Amharic text is a first draft and **needs a native speaker's review**. |
| Money | Integers only (USDT micro-units, birr cents). Buys round up, sells round down; a service total is `ceil(quantity x price / 1000)`. | Floating point never touches money. |
| Roles | `ADMIN_IDS` are owners; owners add staff in the app. Staff work the queue and tickets but cannot change settings. | Safe delegation. |

## Order statuses

`awaiting_payment` > `evidence_submitted` > `processing` > `completed`, with `rejected`, `cancelled` and `expired` as other endings. Each move is limited by who may do it, is atomic, and is recorded in `order_events`. Services use the same statuses ("Mark delivered" instead of "Mark as released").

## Automatic confirmation (not built)

Bybit Pay's merchant API is the only route to real automatic confirmation and needs merchant approval. Polling Bybit deposit records with a read-only key is possible later, with fuzzy matching. The transition table in `src/orders.js` is the one place that says who may move an order, so an automatic confirmer would be one more actor calling the same `transition()` function.

## Known limits

- Proofs: JPG/PNG/WebP up to 6 MB, stored in private R2, deleted after the retention period (default 90 days).
- The Mini App needs a recent Telegram; older clients use an in-page action bar.
- Tests mock Telegram's WebApp object. Do one real order on iOS and Android before launch.
- Seeded policies and all Amharic text need the owner's and a native speaker's review.
