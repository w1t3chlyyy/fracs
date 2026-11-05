import type { Request, Response } from 'express';
import { config } from './config.ts';
import { data, save, upsertTgUser } from './db.ts';
import { sleep } from './util.ts';

let botUsername = '';
export const getBotUsername = () => botUsername;

async function tg(method: string, body: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function notify(tgId: number, text: string) {
  if (!config.botToken) return;
  try {
    await tg('sendMessage', { chat_id: tgId, text });
  } catch (e) {
    console.error('[bot] sendMessage', e);
  }
}

export async function handleUpdate(update: any) {
  const msg = update?.message;
  if (!msg?.text || !msg.from || msg.chat?.type !== 'private') return;
  const [cmd, param] = msg.text.trim().split(/\s+/);
  if (cmd !== '/start') {
    await notify(msg.chat.id, `Откройте личный кабинет: ${config.appUrl}/app`);
    return;
  }
  if (!param) {
    await notify(msg.chat.id, `Привет! Это бот Fracs. Чтобы войти, нажмите «Войти через Telegram» на странице ${config.appUrl}/app`);
    return;
  }
  const t = data.loginTokens.find((x) => x.token === param);
  if (!t || Date.now() - t.createdAt > 10 * 60_000 || t.userId) {
    await notify(msg.chat.id, 'Ссылка устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.');
    return;
  }
  const user = upsertTgUser(msg.from);
  t.userId = user.id;
  save();
  await notify(msg.chat.id, `✅ Готово, ${user.firstName}! Вернитесь в браузер — вход выполнится автоматически.`);
}

export function webhookHandler(req: Request, res: Response) {
  if (!config.webhookSecret || req.get('x-telegram-bot-api-secret-token') !== config.webhookSecret) {
    res.sendStatus(403);
    return;
  }
  handleUpdate(req.body).catch(console.error);
  res.sendStatus(200);
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (!r.ok) {
        await sleep(5000);
        continue;
      }
      for (const u of r.result) {
        offset = u.update_id + 1;
        handleUpdate(u).catch(console.error);
      }
    } catch {
      await sleep(5000);
    }
  }
}

export async function startBot() {
  if (!config.botToken) {
    console.log('[bot] TELEGRAM_BOT_TOKEN не задан — вход через бота отключён' + (config.devLogin ? ' (доступен dev-вход)' : ''));
    return;
  }
  const me = await tg('getMe');
  if (!me.ok) throw new Error(`Telegram getMe: ${me.description}`);
  botUsername = me.result.username;
  console.log(`[bot] @${botUsername}, режим: ${config.botMode}`);

  if (config.botMode === 'webhook') {
    if (!config.webhookSecret) throw new Error('Для webhook-режима задайте TELEGRAM_WEBHOOK_SECRET');
    const r = await tg('setWebhook', { url: `${config.appUrl}/api/bot/webhook`, secret_token: config.webhookSecret, allowed_updates: ['message'] });
    if (!r.ok) throw new Error(`setWebhook: ${r.description}`);
  } else {
    await tg('deleteWebhook');
    poll();
  }
}
