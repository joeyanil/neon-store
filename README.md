# Neon Store: Telegram Mini App and chat bot

Buy and sell USDT with Ethiopian birr, and order social-media growth (Telegram, Instagram, TikTok, YouTube), all inside one Telegram bot. The same bot works two ways and **both do everything**:

- **Mini App**: opens from the "Open App" button next to the typing box. Market, Rates, Orders, Support, and an **Admin** tab for owners and staff.
- **Chat mode**: type `/start` or `/menu`. Coloured buttons, progress lines, messages that edit in place. Buy, sell, services, rates, orders, support tickets, policies, and the whole admin area (`/start` as an admin shows the queue).

Payment is confirmed **manually**: customers upload a proof (kept inside Telegram, in a private chat only the owner sees), an admin checks it against their bank/Bybit app and presses *Payment received*, then *Mark as released* with a reference. Runs on Cloudflare's free tier (Workers + D1 + static assets). No card or payment method is needed.

Screenshots of every screen are in `docs/screenshots/`. Design notes are in `docs/DECISIONS.md` and `docs/ADMIN_DESIGN.md`.

## Nothing is hardcoded

The owner fills these in **inside the app** (Admin > Shop settings, with a setup guide that shows what is missing):

- Buy and sell rates, min/max order, payment window, USDT stock (and whether customers can see it), pause switch
- Birr payment accounts (name, account holder, number, what each is used for, optional unlock rule)
- USDT networks and deposit addresses
- Services and prices (price per 1,000, min/max quantity, ETA, warranty)
- Policies, team (staff), where alerts go

The shop stays closed until rates, limits and at least one account and network exist. **No fees are added**: whatever Bybit takes comes out of the shop's margin.

## Setup

Follow **[SETUP_CHECKLIST.md](SETUP_CHECKLIST.md)**: make the bot in BotFather, connect this repo to Cloudflare (the deploy command is `npm run ship`, which also applies the database migrations), add the secret `BOT_TOKEN`, then open `https://<your-worker>.workers.dev/connect` once. That page registers the webhook, the "Open App" button and the command list, so nothing has to run on a computer.

Manual route (computer): `npx wrangler d1 create neon-p2p`, `npm run ship`, `npx wrangler secret put BOT_TOKEN`, then `/connect` (or `node scripts/telegram-setup.mjs`).

Check `https://your-worker.workers.dev/health` returns `{"ok":true}`. The owner's Telegram id goes in `ADMIN_IDS` in `wrangler.toml`; each admin must press Start in the bot once to receive alerts.

## Test data

While the shop is being tested, `npm run ship` also loads `scripts/demo-data.sql` once: sample rates and limits, 500 USDT of stock, two payment accounts, three USDT networks and a price list with every Telegram, Instagram, TikTok and YouTube service. **All of it is placeholder**: the prices are invented, the account numbers and addresses are fake (accounts are named TEST ACCOUNT), and nothing you entered yourself is overwritten or duplicated. Deleted rows are never re-added.

Before going live: remove the `&& wrangler d1 execute ... demo-data.sql` part from `ship` in `package.json`, run `npx wrangler d1 execute neon-p2p --remote --file=scripts/clear-demo.sql`, then enter the real accounts, addresses and prices in the app.

## Admin commands (optional shortcuts; everything is also in the app and the chat menu)

`/alerts`, `/setrate BUY SELL`, `/limits MIN MAX`, `/ttl MINUTES`, `/rates`, `/pause`, `/resume`, `/orders`. Admin replies to an alert card (it contains the NG-/TK- number) are sent to the customer.

## Tests

```bash
npm test                  # 13 unit tests: money rounding, initData signature, validation
npm run test:integration  # 79 checks: real Worker + local D1 + fake Telegram (order lifecycles, stock, unlock rules, services, tickets, policies, chat mode, security)
npm run test:demo         # the test-shop data: fills only what is empty, keeps the owner's own entries
npm run test:ui           # Playwright + mocked Telegram.WebApp: buy flow, admin review and release, settings screens, services, tickets, English-only, dark; fails on any console error; rewrites docs/screenshots
```

The UI test needs Chromium (`npx playwright install chromium`). Local development: `npm run db:local && npm run dev`. Stop any other `wrangler dev` first (port 8787).

## Layout

```
src/        Worker: auth (initData HMAC), orders + state machine, stock, services, tickets, chat bot, admin API
public/     The Mini App (plain ES modules, no build step), CSS, self-hosted fonts
migrations/ D1 schema and seed (policies are seeded as drafts for the owner to review)
scripts/    Telegram setup
test/       unit, integration, UI
```

## Before going live

- Read the seeded policies (Admin > Shop settings > Rules and policies) and edit them to match the shop. They are first drafts.
- Do one real order on a phone (iOS and Android) with a test bot. The tests mock Telegram's WebApp object.
- Enter the real prices for services when the shop owner has them (Admin > Services).

## Safety notes

- Money is stored as integers (USDT micro-units, birr cents). Buy amounts round up and sell amounts round down.
- Every request is authenticated by verifying Telegram's signed `initData`; rates are locked at order creation; order creation is idempotent; every status change is atomic and logged (`order_events`, `audit_log`).
- Customer proofs are private: only the customer and admins can open them through the app. They are sent to a private Telegram chat (default: the first owner's chat with the bot; set `PROOF_CHAT_ID` to use a private channel instead). Telegram only lets a bot delete messages under 48 hours old, so after the retention period the app forgets the proof but the file stays in that private chat until someone clears it. Alerts to admins contain text only.
