# Neon Store: Telegram Mini App and chat bot

Buy and sell USDT with Ethiopian birr, and order social-media growth (Telegram, Instagram, TikTok, YouTube), all inside one Telegram bot. The same bot works two ways and **both do everything**:

- **Mini App**: opens from the "Open App" button next to the typing box. Market, Rates, Orders, Support, and an **Admin** tab for owners and staff.
- **Chat mode**: type `/start` or `/menu`. Coloured buttons, progress lines, messages that edit in place. Buy, sell, services, rates, orders, support tickets, policies, language, and the whole admin area (`/start` as an admin shows the queue).

Payment is confirmed **manually**: customers upload a proof (kept in private R2 storage), an admin checks it against their bank/Bybit app and presses *Payment received*, then *Mark as released* with a reference. Runs on Cloudflare's free tier (Workers + D1 + R2 + static assets).

Screenshots of every screen are in `docs/screenshots/`. Design notes are in `docs/DECISIONS.md` and `docs/ADMIN_DESIGN.md`.

## Nothing is hardcoded

The owner fills these in **inside the app** (Admin > Shop settings, with a setup guide that shows what is missing):

- Buy and sell rates, min/max order, payment window, USDT stock (and whether customers can see it), pause switch
- Birr payment accounts (name, account holder, number, what each is used for, optional unlock rule)
- USDT networks and deposit addresses
- Services and prices (price per 1,000, min/max quantity, ETA, warranty)
- Policies (Amharic and English), team (staff), where alerts go

The shop stays closed until rates, limits and at least one account and network exist. **No fees are added**: whatever Bybit takes comes out of the shop's margin.

## Setup (about 20 minutes)

You need Node 20+, a free Cloudflare account, and a bot token from @BotFather.

```bash
npm install
npx wrangler login
npx wrangler d1 create neon-p2p            # copy the database_id into wrangler.toml
npx wrangler r2 bucket create neon-proofs  # private storage for customer proofs
```

1. In `wrangler.toml` set `database_id`, `ADMIN_IDS` (numeric Telegram id(s) of the owner(s), from @userinfobot) and `SUPPORT_USERNAME`.
2. Create the tables: `npm run db:remote`
3. Secrets (pick a long random `WEBHOOK_SECRET` using letters, digits, `_` or `-`):
   ```bash
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET
   ```
4. `npm run deploy`, then copy the printed URL into `WEBAPP_URL` in `wrangler.toml` and deploy again.
5. Connect Telegram (webhook, "Open App" menu button, command list):
   ```bash
   BOT_TOKEN=... WEBHOOK_SECRET=... WEBAPP_URL=https://your-worker.workers.dev node scripts/telegram-setup.mjs
   ```
6. In @BotFather: Bot Settings > Configure Mini App (or `/newapp`) with the same URL, so the app has a direct link and shows on the bot's profile.
7. Open the bot as the owner, open **Admin > Shop settings > Setup guide** and fill everything in. Each admin must press Start in the bot once to receive alerts. To send alerts to a group instead, add the bot to the group and send `/alerts` there.
8. **Switching the real bot last**: do all of the above with a test bot first. When happy, repeat steps 3 and 5 with the real bot's token. Old bots can stay running until then.

Check `https://your-worker.workers.dev/health` returns `{"ok":true}`.

## Admin commands (optional shortcuts; everything is also in the app and the chat menu)

`/alerts`, `/setrate BUY SELL`, `/limits MIN MAX`, `/ttl MINUTES`, `/rates`, `/pause`, `/resume`, `/orders`. Admin replies to an alert card (it contains the NG-/TK- number) are sent to the customer.

## Tests

```bash
npm test                  # 13 unit tests: money rounding, initData signature, validation
npm run test:integration  # 78 checks: real Worker + local D1/R2 + fake Telegram (order lifecycles, stock, unlock rules, services, tickets, policies, chat mode, security)
npm run test:ui           # Playwright + mocked Telegram.WebApp: buy flow, admin review and release, settings screens, services, tickets, Amharic, dark; fails on any console error; rewrites docs/screenshots
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

- Have a native Amharic speaker read the `am` text (`public/js/i18n.js`, `src/chat-text.js`, `src/messages.js`) and the seeded policies. They are first drafts.
- Do one real order on a phone (iOS and Android) with a test bot. The tests mock Telegram's WebApp object.
- Enter the real prices for services when the shop owner has them (Admin > Services).

## Safety notes

- Money is stored as integers (USDT micro-units, birr cents). Buy amounts round up and sell amounts round down.
- Every request is authenticated by verifying Telegram's signed `initData`; rates are locked at order creation; order creation is idempotent; every status change is atomic and logged (`order_events`, `audit_log`).
- Customer proofs are private: only the customer and admins can open them, and they are deleted after the retention period. Alerts to admins contain text only.
