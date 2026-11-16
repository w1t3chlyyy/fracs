import type { Request, Response } from 'express';
import { config } from './config.ts';
import {
  bindLoginToken, upsertTgUser, findUser, extendSubscription, setSubscription, listRecentUsers, isSubscribed,
} from './db.ts';
import { safeEqual, sleep } from './util.ts';

let botUsername = config.botUsername;

/** Username бота: из TELEGRAM_BOT_USERNAME, иначе один раз спрашиваем у Telegram и кэшируем. */
export async function getBotUsername(): Promise<string> {
  if (botUsername || !config.botToken) return botUsername;
  const me = await tg('getMe');
  if (me.ok) botUsername = me.result.username;
  return botUsername;
}

async function tg(method: string, body: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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

/* ── админ-панель ── */

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
const who = (u: { firstName: string; username: string | null; tgId: number }) =>
  `${u.username ? '@' + u.username : u.firstName} (id ${u.tgId})`;

const ADMIN_HELP = `Админ-панель Fracs
/grant <@username|id> [дней] — выдать или продлить подписку (по умолчанию 30)
/revoke <@username|id> — снять подписку
/user <@username|id> — статус пользователя
/users — последние 10 пользователей
Пользователь должен хотя бы раз войти в кабинет.`;

const ADMIN_CMDS = ['/admin', '/grant', '/revoke', '/user', '/users'];

/** Команды админа. true — команда обработана. */
async function handleAdmin(chatId: number, text: string): Promise<boolean> {
  const [raw, ...args] = text.trim().split(/\s+/);
  const cmd = raw.split('@')[0].toLowerCase();
  if (!ADMIN_CMDS.includes(cmd)) return false;

  if (cmd === '/admin') {
    await notify(chatId, ADMIN_HELP);
    return true;
  }

  if (cmd === '/users') {
    const list = await listRecentUsers(10);
    await notify(
      chatId,
      list.length
        ? list.map((u) => `${who(u)} — ${isSubscribed(u) ? 'до ' + fmt(u.subscriptionUntil) : 'нет подписки'}`).join('\n')
        : 'Пользователей пока нет.',
    );
    return true;
  }

  const user = args[0] ? await findUser(args[0]) : null;
  if (!user) {
    await notify(chatId, args[0] ? 'Пользователь не найден. Он должен сначала войти в кабинет через бота.' : ADMIN_HELP);
    return true;
  }

  if (cmd === '/user') {
    await notify(chatId, `${who(user)}\nПодписка: ${isSubscribed(user) ? 'до ' + fmt(user.subscriptionUntil) : 'нет'}\nРегистрация: ${fmt(user.createdAt)}`);
  } else if (cmd === '/grant') {
    const days = Math.round(Number(args[1] ?? 30));
    if (!(days > 0 && days <= 3650)) {
      await notify(chatId, 'Укажите число дней от 1 до 3650.');
      return true;
    }
    const u = await extendSubscription(user.id, days);
    await notify(chatId, `✅ ${who(u)}: подписка до ${fmt(u.subscriptionUntil)}`);
    await notify(u.tgId, `✅ Подписка Fracs активна до ${fmt(u.subscriptionUntil)}. Кабинет: ${config.appUrl}/app`);
  } else if (cmd === '/revoke') {
    const u = await setSubscription(user.id, null);
    await notify(chatId, `🚫 ${who(u)}: подписка снята`);
  }
  return true;
}

export async function handleUpdate(update: any) {
  const msg = update?.message;
  if (!msg?.text || !msg.from || msg.chat?.type !== 'private') return;

  if (config.adminTgId > 0 && msg.from.id === config.adminTgId) {
    try {
      if (await handleAdmin(msg.chat.id, msg.text)) return;
    } catch (e: any) {
      console.error('[bot] admin', e);
      await notify(msg.chat.id, `Ошибка: ${e?.message || e}`);
      return;
    }
  }

  const [cmd, param] = msg.text.trim().split(/\s+/);
  if (cmd !== '/start') {
    await notify(msg.chat.id, `Откройте личный кабинет: ${config.appUrl}/app`);
    return;
  }
  if (!param) {
    await notify(msg.chat.id, `Привет! Это бот Fracs. Чтобы войти, нажмите «Войти через Telegram» на странице ${config.appUrl}/app`);
    return;
  }
  const user = await upsertTgUser(msg.from);
  const ok = await bindLoginToken(param, user.id);
  if (!ok) {
    await notify(msg.chat.id, 'Ссылка устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.');
    return;
  }
  await notify(msg.chat.id, `✅ Готово, ${user.firstName}! Вернитесь в браузер — вход выполнится автоматически.`);
}

/** Webhook Telegram. На serverless работу нужно закончить ДО ответа, иначе функцию замораживают. */
export async function webhookHandler(req: Request, res: Response) {
  const got = req.get('x-telegram-bot-api-secret-token') || '';
  if (!config.webhookSecret || !safeEqual(got, config.webhookSecret)) {
    res.sendStatus(403);
    return;
  }
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error('[bot] handleUpdate', e);
  }
  res.sendStatus(200); // всегда 200, иначе Telegram будет слать апдейт повторно
}

/* ── ниже — только для постоянного сервера (локально / VPS), на Vercel не вызывается ── */

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] }, 40_000);
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
