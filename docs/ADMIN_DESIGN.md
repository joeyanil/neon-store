# Admin area, payment accounts and proof storage

This is the design for the second round of work. It records the questions I asked myself about the real workflow, and the answer I chose for each, so the friend can overrule any of them.

## 1. Words and directions (the part that is easy to get backwards)

| | Customer **buys** USDT | Customer **sells** USDT |
|---|---|---|
| Customer sends | birr, to **our** account | USDT, to **our** address |
| Customer gives us | their USDT address | their own birr account (name + number) |
| Proof the customer uploads | birr payment receipt | USDT transfer screenshot / transaction hash |
| Admin checks | birr arrived in our Telebirr/bank app | USDT arrived at our address |
| Admin releases | USDT to the customer's address | birr to the customer's account |

"Release" always means the admin sending the customer their money. The admin never uploads a proof; the admin sees the customer's proof, checks it against their own bank/Bybit app, and releases.

## 2. Payment accounts are data, not code

Today the app has three birr methods and three networks fixed in a seed file. The admin must be able to add, edit, disable and remove them, with their own names.

**Birr payment account** (one row each; the admin can add as many as needed):

| Field | Example | Notes |
|---|---|---|
| Type | Bank / Mobile money | Decides how a customer's own number is validated (phone vs bank account). |
| Name | Commercial Bank of Ethiopia | What customers see. Optional Amharic name; falls back to the English one. |
| Account holder | Neon Store Trading | Customers see this to be sure they pay the right person. |
| Account / phone number | 1000123456789 | |
| Customers can pay me here | on/off | Used on **Buy** orders. |
| I can pay customers here | on/off | Used on **Sell** orders (a payout channel). The admin may receive on Telebirr but not pay out on it. |
| Note to the customer | "Write the order number in the reason field" | Optional, shown on the payment screen. |
| Active | on/off | A quick switch; nothing is deleted. |

**USDT network** (same idea):

| Field | Example | Notes |
|---|---|---|
| Kind | TRON, BNB Smart Chain / other EVM, Bybit UID, Other | Chooses the address check (a TRON address starts with T and has 34 characters, an EVM address is `0x` + 40 hex characters, a Bybit UID is digits). "Other" accepts any sensible text. |
| Name | USDT · TRON (TRC20) | What customers see. |
| Our deposit address | T... | Where customers send USDT on **Sell**. |
| Customers can send here | on/off | Sell orders. Requires a deposit address. |
| I can send here | on/off | Buy orders (the customer gives us an address on this network). |

Rows are never hard-deleted once any order used them (orders point at them). The admin can **disable** any row, and **delete** only rows no order has used.

## 3. Editing money details safely

Each order stores a snapshot of the details it showed (`pay_snapshot`). If the admin changes an account number, orders already open keep paying the **old** number, which is right for the audit trail but dangerous if the old account is gone. So the edit screen shows "N open orders still use the old details" and recommends disabling the account first, waiting for those orders to finish, then adding the new one. Changes are written to an audit log.

## 4. Proofs live in Telegram, not in the database

* The customer's receipt photo is sent silently by the Worker to a private Telegram chat (the first owner's chat with the bot, or `PROOF_CHAT_ID`); only Telegram's file id is stored. (An earlier design used a private R2 bucket; R2 needs a payment method, so it was dropped.) The Worker checks the real file type from the first bytes (not just what the phone claims), limits it to 6 MB (the app shrinks photos first), and stores a SHA-256 hash.
* Nobody can open a proof except the customer who uploaded it and an admin. The app fetches it through an authenticated endpoint; there is no public URL.
* **Duplicate-proof warning.** The same screenshot reused on a second order is the most common P2P scam. If a proof's hash or a typed transaction number already appears on another order, the admin sees a red warning with a link to that order.
* The Telegram alert is now **text only** (summary + buttons). Customer receipts contain names and phone numbers; this keeps them out of a group chat that may have many members.
* Retention: proofs of finished orders are forgotten by the app after a configurable number of days (default 90, 0 = keep forever). The order record and history stay.

## 5. Admin area inside the Mini App

Only visible to admins (checked on the server for every request, not just hidden in the UI). It is an extra tab in the bottom bar with a badge for orders waiting for a decision.

1. **Dashboard / queue.** Counts (needs review, to release, open), "rates last updated N hours ago", pause switch, and the list of orders filtered by *Needs review* / *To release* / *All open* / *Done*.
2. **Order review.** Tells the admin exactly what to check and what to do, per side (see section 1), with copy buttons for every number and address, proof thumbnails that open full-screen, the customer's text reference, warnings (duplicate proof, late proof), the customer's history (completed orders so far) and a block/unblock switch. Actions at the bottom (Telegram's own buttons):
   * waiting for review → **Payment received** (asks to confirm) / **Reject** (pick a reason)
   * to release → **Mark as released** (reference required: bank reference or USDT transaction hash, sent to the customer) / **Reject**
3. **Settings** → *Payment accounts*, *USDT networks*, *Rates and limits*, *Alerts and team*, *Proofs*.
4. **Setup wizard** (first run, and re-openable): Rates → Limits and timing → Birr accounts → USDT networks → Alerts → Review and open for business. Progress is derived from the data itself (not a stored "step number"), so it can be left and resumed from any device, and the customer side shows "Not open yet" until the minimum is configured.

## 6. Questions I asked myself, and the answers

**Who counts as an admin?**
`ADMIN_IDS` in `wrangler.toml` are *owners*: they can do everything and cannot be locked out. Owners can add *staff* by Telegram id inside the app. Staff can review orders and press Confirm / Release / Reject but cannot change payment accounts, rates, staff or settings.

**Where do alerts go?**
Default: a private message to every admin (needs only `ADMIN_IDS`; each admin must have started the bot once). Optional: an owner sends `/alerts` in a group where the bot is a member to move alerts there. The alert message ids are stored per order so every copy of the alert is updated when anyone acts, wherever they act (chat button or app).

**What if the alert fails to send?**
The customer's submission still succeeds (their proof is safe in the vault chat and the order shows in the admin queue). The cron job retries unsent alerts every five minutes.

**What if the customer pays after the order expired?**
This is a real case (paid at minute 31). Previously the app refused the receipt and said "contact Support". Now an expired order accepts a receipt for 24 hours and goes to the admin as **Late proof**. The admin decides (rate was locked at creation, so the admin may reject if the market moved).

**What if the customer pays the wrong amount?**
The admin rejects with the reason "Amount does not match" and settles the difference with the customer in chat. There is no "adjust order" function; it would need a rule for who is right and is better done by a human. Listed as a future option.

**Can one admin act twice, or two admins at once?**
All status changes are atomic and checked against the current status; the loser gets "already confirmed" and sees the up-to-date card.

**Can a bad customer be stopped?**
Admins can block a customer from the order screen (and unblock). A blocked customer can still see their orders but cannot create new ones.

**Staying honest about customer data.**
We store the Telegram id, first name, @username, language, their USDT address and birr account for the order they placed, and proofs (90 days by default).

**Backups.**
D1 has built-in point-in-time restore for 30 days (`wrangler d1 time-travel`). Proofs in the vault chat are not backed up elsewhere; they are evidence for 90 days, not records.

**Money on the screen.**
Admins see the same integer-computed amounts the customer was shown (buy totals rounded up, sell totals rounded down), copied from the stored order, never recomputed.

## 7. What is deliberately not built

* Automatic confirmation (Bybit Pay or bank APIs). Everything is shaped so it can be added later: it would be one more actor allowed to make the same status changes.
* Several receiving accounts per method with load balancing (add two rows with different names, for example "Telebirr (Abebe)" and "Telebirr (Shop)").
* PDF receipts (images only); a customer can paste the transaction number instead.
* Refund tracking inside the app.
* Per-customer daily limits / KYC (ask the friend).
