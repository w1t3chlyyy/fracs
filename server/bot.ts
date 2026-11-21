import type { Request, Response } from 'express';
import { config } from './config.ts';
import {
  bindLoginToken, upsertTgUser, findUser, extendSubscription, setSubscription, listRecentUsers, isSubscribed,
  getPlans, updatePlan, resetPlans, getTraining, addLesson, updateLesson, deleteLesson,
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

export async function notify(tgId: number, text: string, extra: Record<string, unknown> = {}) {
  if (!config.botToken) return;
  try {
    await tg('sendMessage', { chat_id: tgId, text, ...extra });
  } catch (e) {
    console.error('[bot] sendMessage', e);
  }
}

const publicUrl = () =>
  /^https:\/\/(?!localhost\b|127\.0\.0\.1\b)/i.test(config.appUrl) ? config.appUrl : 'https://fracs.cc.cd';

function docsMarkup(includeCabinet = true) {
  const base = publicUrl();
  const rows = [
    ...(includeCabinet ? [[{ text: '🌐 Личный кабинет', url: `${base}/app` }]] : []),
    [{ text: '🔒 Политика конфиденциальности', url: `${base}/privacy` }],
    [{ text: '📄 Пользовательское соглашение', url: `${base}/terms` }],
    [{ text: '📑 Публичная оферта', url: `${base}/offer` }],
  ];
  return { inline_keyboard: rows };
}

/* ── админ-панель ── */

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
const who = (u: { firstName: string; username: string | null; tgId: number }) =>
  `${u.username ? '@' + u.username : u.firstName} (id ${u.tgId})`;

const ADMIN_HELP = `Админ-панель Fracs

Пользователи:
/grant <@username|id> [дней] [тариф] — выдать или продлить подписку (по умолчанию 30 дней, тариф month)
/revoke <@username|id> — снять подписку
/user <@username|id> — статус пользователя
/users — последние 10 пользователей

Тарифы и цены:
/plans — список текущих тарифов
/setprice <id|1|2|3> <цена> — изменить цену (₽)
/setdesc <id|1|2|3> <описание|-> — изменить описание (- чтобы убрать)
/settitle <id|1|2|3> <название> — изменить название
/setbadge <id|1|2|3> <текст|-> — изменить бейдж (- чтобы убрать)
/setdays <id|1|2|3> <дней> — изменить длительность
/resetplans — сбросить тарифы к стандартным

Раздел «Обучение» (виден в программе на тарифе PRO):
/training — список уроков
/addlesson Заголовок
<пустая строка>
Текст урока (можно многострочно) — добавить урок
/setlesson <id> Заголовок
<пустая строка>
Новый текст — изменить урок (id из /training, можно первые 8 символов)
/dellesson <id> — удалить урок

Примеры:
/setprice pro 2700
/grant 123456789 30 pro
/addlesson Как найти клиентов

Откройте нишу, введите город…`;

const ADMIN_CMDS = [
  '/admin', '/grant', '/revoke', '/user', '/users',
  '/plans', '/setprice', '/setdesc', '/settitle', '/setbadge', '/setdays', '/resetplans',
  '/training', '/addlesson', '/setlesson', '/dellesson',
];

function formatPlans(plans: Awaited<ReturnType<typeof getPlans>>) {
  return plans
    .map(
      (p, i) =>
        `${i + 1}. [${p.id}] ${p.title} — ${p.priceRub.toLocaleString('ru-RU')} ₽ (${p.days} дн.)` +
        (p.badge ? `\n   Бейдж: ${p.badge}` : '') +
        `\n   Описание: ${p.description || '—'}`,
    )
    .join('\n\n');
}

/** Команды админа. true — команда обработана. */
async function handleAdmin(chatId: number, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const [raw, ...args] = trimmed.split(/\s+/);
  const cmd = raw.split('@')[0].toLowerCase();
  if (!ADMIN_CMDS.includes(cmd)) return false;

  if (cmd === '/admin') {
    await notify(chatId, ADMIN_HELP);
    return true;
  }

  if (cmd === '/plans') {
    const plans = await getPlans();
    await notify(
      chatId,
      `Тарифы:\n\n${formatPlans(plans)}\n\nИзменить цену: /setprice <id|номер> <сумма>\nИзменить описание: /setdesc <id|номер> <текст>`,
    );
    return true;
  }

  if (cmd === '/resetplans') {
    const plans = await resetPlans();
    await notify(chatId, `♻️ Тарифы сброшены к стандартным:\n\n${formatPlans(plans)}`);
    return true;
  }

  if (cmd === '/setprice') {
    const targetId = args[0];
    const price = Math.round(Number(args[1]));
    if (!targetId || !Number.isFinite(price) || price < 1 || price > 10_000_000) {
      await notify(chatId, 'Использование: /setprice <id|1|2> <цена в ₽>\nПример: /setprice month 1800');
      return true;
    }
    const updated = await updatePlan(targetId, { priceRub: price });
    if (!updated) {
      await notify(chatId, 'Тариф не найден. Посмотрите список командой /plans');
      return true;
    }
    await notify(chatId, `✅ Цена обновлена: [${updated.id}] ${updated.title} — ${updated.priceRub.toLocaleString('ru-RU')} ₽`);
    return true;
  }

  if (cmd === '/setdays') {
    const targetId = args[0];
    const days = Math.round(Number(args[1]));
    if (!targetId || !Number.isFinite(days) || days < 1 || days > 3650) {
      await notify(chatId, 'Использование: /setdays <id|1|2> <дней от 1 до 3650>');
      return true;
    }
    const updated = await updatePlan(targetId, { days });
    if (!updated) {
      await notify(chatId, 'Тариф не найден. Посмотрите список командой /plans');
      return true;
    }
    await notify(chatId, `✅ Длительность обновлена: [${updated.id}] ${updated.title} — ${updated.days} дн.`);
    return true;
  }

  if (cmd === '/setdesc' || cmd === '/settitle' || cmd === '/setbadge') {
    const m = trimmed.match(/^\/\S+\s+(\S+)\s+([\s\S]+)$/);
    const targetId = m?.[1];
    const value = m?.[2]?.trim();
    if (!targetId || !value) {
      await notify(chatId, `Использование: ${cmd} <id|1|2> <текст>${cmd === '/settitle' ? '' : ' (или - чтобы очистить)'}`);
      return true;
    }
    const cleanVal = value === '-' ? '' : value;
    const patch =
      cmd === '/setdesc'
        ? { description: cleanVal }
        : cmd === '/setbadge'
          ? { badge: cleanVal }
          : { title: value };
    const updated = await updatePlan(targetId, patch);
    if (!updated) {
      await notify(chatId, 'Тариф не найден. Посмотрите список командой /plans');
      return true;
    }
    await notify(
      chatId,
      `✅ Тариф [${updated.id}] обновлён:\n${updated.title} — ${updated.priceRub.toLocaleString('ru-RU')} ₽ (${updated.days} дн.)` +
        (updated.badge ? `\nБейдж: ${updated.badge}` : '') +
        `\nОписание: ${updated.description || '—'}`,
    );
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

  if (cmd === '/training') {
    const lessons = await getTraining();
    await notify(
      chatId,
      lessons.length
        ? 'Уроки:\n\n' + lessons.map((l, i) => `${i + 1}. [${l.id.slice(0, 8)}] ${l.title}`).join('\n')
        : 'Уроков пока нет. Добавьте:\n/addlesson Заголовок\n\nТекст урока',
    );
    return true;
  }

  if (cmd === '/addlesson' || cmd === '/setlesson') {
    const rest = trimmed.slice(raw.length).trim();
    let id = '';
    let content = rest;
    if (cmd === '/setlesson') {
      const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m) {
        await notify(chatId, 'Использование:\n/setlesson <id> <Заголовок>\n\nТекст урока');
        return true;
      }
      id = m[1];
      content = m[2];
    }
    const parts = content.split(/\n\s*\n/);
    const title = (parts[0] || '').trim();
    const body = parts.slice(1).join('\n\n').trim();
    if (!title) {
      await notify(chatId, `Укажите заголовок. Формат:\n${cmd} Заголовок\n\nТекст урока (можно многострочно)`);
      return true;
    }
    if (cmd === '/addlesson') {
      const l = await addLesson(title, body);
      await notify(chatId, `✅ Урок добавлен: [${l.id.slice(0, 8)}] ${l.title}\nИзменить: /setlesson ${l.id.slice(0, 8)} …\nУдалить: /dellesson ${l.id.slice(0, 8)}`);
    } else {
      const l = await updateLesson(id, { title, ...(body !== '' ? { body } : {}) });
      if (!l) {
        await notify(chatId, `Урок не найден: ${id}. Список: /training`);
        return true;
      }
      await notify(chatId, `✅ Урок обновлён: [${l.id.slice(0, 8)}] ${l.title}`);
    }
    return true;
  }

  if (cmd === '/dellesson') {
    const id = args[0];
    if (!id) {
      await notify(chatId, 'Использование: /dellesson <id>');
      return true;
    }
    const ok = await deleteLesson(id);
    await notify(chatId, ok ? `✅ Урок удалён: ${id}` : `Урок не найден: ${id}. Список: /training`);
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
    const planId = args[2];
    if (planId) {
      const plans = await getPlans();
      if (!plans.some((p) => p.id === planId)) {
        await notify(chatId, `Неизвестный тариф: ${planId}. Доступные: ${plans.map((p) => p.id).join(', ')}`);
        return true;
      }
    }
    const u = await extendSubscription(user.id, days, planId);
    await notify(chatId, `✅ ${who(u)}: подписка до ${fmt(u.subscriptionUntil)}` + (u.planId ? ` (тариф ${u.planId})` : ''));
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

  const [rawCmd, param] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const base = publicUrl();

  if (cmd === '/privacy') {
    await notify(msg.chat.id, `🔒 Политика конфиденциальности Fracs:\n${base}/privacy`, {
      reply_markup: docsMarkup(false),
    });
    return;
  }
  if (cmd === '/terms') {
    await notify(msg.chat.id, `📄 Пользовательское соглашение Fracs:\n${base}/terms`, {
      reply_markup: docsMarkup(false),
    });
    return;
  }
  if (cmd === '/offer') {
    await notify(msg.chat.id, `📑 Публичная оферта Fracs:\n${base}/offer`, {
      reply_markup: docsMarkup(false),
    });
    return;
  }
  if (cmd === '/docs') {
    await notify(msg.chat.id, 'Правовые документы сервиса Fracs:', {
      reply_markup: docsMarkup(true),
    });
    return;
  }

  if (cmd !== '/start') {
    await notify(msg.chat.id, `Откройте личный кабинет: ${base}/app`, {
      reply_markup: docsMarkup(true),
    });
    return;
  }
  if (!param) {
    await notify(
      msg.chat.id,
      `Привет! Это бот Fracs.\n\nЧтобы войти, нажмите «Войти через Telegram» на странице ${base}/app.\n\nПеред началом работы вы можете ознакомиться с правовыми документами по кнопкам ниже:`,
      { reply_markup: docsMarkup(true) },
    );
    return;
  }
  const user = await upsertTgUser(msg.from);
  const ok = await bindLoginToken(param, user.id);
  if (!ok) {
    await notify(
      msg.chat.id,
      'Ссылка устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.',
      { reply_markup: docsMarkup(true) },
    );
    return;
  }
  await notify(
    msg.chat.id,
    `✅ Готово, ${user.firstName}! Вернитесь в браузер — вход выполнится автоматически.\n\nПравовые документы сервиса доступны по кнопкам ниже:`,
    { reply_markup: docsMarkup(false) },
  );
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

  await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Запуск бота и вход в кабинет' },
      { command: 'privacy', description: 'Политика конфиденциальности' },
      { command: 'terms', description: 'Пользовательское соглашение' },
      { command: 'offer', description: 'Публичная оферта' },
    ],
  }).catch(() => {});

  if (config.botMode === 'webhook') {
    if (!config.webhookSecret) throw new Error('Для webhook-режима задайте TELEGRAM_WEBHOOK_SECRET');
    const r = await tg('setWebhook', { url: `${config.appUrl}/api/bot/webhook`, secret_token: config.webhookSecret, allowed_updates: ['message'] });
    if (!r.ok) throw new Error(`setWebhook: ${r.description}`);
  } else {
    await tg('deleteWebhook');
    poll();
  }
}
