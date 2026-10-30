# Go-live checklist (about 15 minutes, all from a phone or computer browser)

The owner id is already set in `wrangler.toml` (`ADMIN_IDS`). To hand the shop to someone else later, change that number to their Telegram id (get it from @userinfobot), or add them as staff in the app.

## 1. Make the bot (BotFather)

1. In Telegram open @BotFather and send `/newbot`.
2. Give it a name (shown to customers) and a username ending in `bot`.
3. BotFather replies with a **token** that looks like `1234567890:AAH...`. Keep it private. You only ever paste it into Cloudflare (step 3). Do not post it in chats.
   - Lost it? `/token` shows it again. `/revoke` makes a new one (the old one stops working).
   - You do **not** need `/newapp` or `/newgame`.

## 2. Put the code on Cloudflare

1. Sign in at dash.cloudflare.com (free account is enough).
2. **Workers & Pages > Create > Import a repository** (connect GitHub, pick this repo).
3. Project name: `neon-p2p-miniapp`. Build command: leave empty. **Deploy command: `npm run ship`**. Save and deploy.
4. If the first deploy complains about the database, open **Storage & Databases > D1**, create a database named `neon-p2p`, then retry the deploy. No card or R2 is needed: customer receipts are kept inside Telegram.

## 3. Add the two secrets

Worker > **Settings > Variables and Secrets > Add** (type: **Secret**):

| Name | Value |
|---|---|
| `BOT_TOKEN` | the token from BotFather |
| `WEBHOOK_SECRET` | any long random text using only letters, digits, `_` and `-` (at least 16 characters). Save it somewhere; you need it once in step 4. |

Then press **Deploy** (or push any change) so the Worker picks them up.

## 4. Connect Telegram

Open `https://<your-worker>.workers.dev/connect` (the address is shown on the Worker's page), type the `WEBHOOK_SECRET`, press **Connect Telegram**. All lines should show a green tick.

## 5. Start the bot as the owner (needed for receipts)

Open your bot in Telegram and press **Start** with the owner account. Customer receipts are sent silently to the owner's chat with the bot and read back from there, so this must be done once.

## 6. Fill in the shop

Open your bot, send `/start`, press **Open App**. The **Admin** tab appears for owners. Go to **Admin > Shop settings > Setup guide** and enter rates, order sizes, stock, payment accounts, USDT networks, services and policies.

Optional in BotFather: `/mybots` > your bot > Bot Settings > Configure Mini App > use the same address, so the app also has a direct link.

## Handing it to the shop owner

1. He creates his own bot with `/newbot` and (ideally) his own Cloudflare account.
2. Change `ADMIN_IDS` in `wrangler.toml` to his id; redeploy; set his `BOT_TOKEN` and `WEBHOOK_SECRET`; open `/connect` again.
3. Send him the GitHub repo (or transfer it). Revoke every token you used while testing.
