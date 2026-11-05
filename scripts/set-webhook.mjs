// Регистрирует webhook бота: `npm run webhook:set` (читает .env или переменные окружения).
import 'dotenv/config';

const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, APP_URL } = process.env;
if (!token || !secret || !APP_URL) {
  console.error('Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и APP_URL');
  process.exit(1);
}
const url = `${APP_URL.replace(/\/$/, '')}/api/bot/webhook`;
const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }),
});
console.log(url, await r.json());
const info = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
console.log(info);
