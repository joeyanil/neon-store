// The secret Telegram sends back with every webhook call. It is derived from the bot token, so there is nothing extra
// to configure and nothing a redeploy can wipe: the same bot token always gives the same secret.
// (64 hex characters, which is within what Telegram allows: A-Z a-z 0-9 _ -)
export async function webhookSecret(env) {
  if (!env.BOT_TOKEN) return '';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`neon-webhook-secret:${env.BOT_TOKEN}`)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
