import type { Request, Response } from 'express';
import { config } from './config.ts';
import {
  bindLoginToken, createLoginToken, upsertTgUser, findUser, extendSubscription, setSubscription, listRecentUsers, isSubscribed,
  getPlans, updatePlan, resetPlans, getTraining, addLesson, updateLesson, deleteLesson, getRequiredChannels, type User,
} from './db.ts';
import { randomToken, safeEqual, sleep } from './util.ts';

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

export async function notify(tgId: number | null, text: string, extra: Record<string, unknown> = {}) {
  // Аккаунт без Telegram (вход по email-коду) уведомить некуда — молча пропускаем.
  if (tgId == null || !config.botToken) return;
  try {
    await tg('sendMessage', { chat_id: tgId, text, ...extra });
  } catch (e) {
    console.error('[bot] sendMessage', e);
  }
}

let botIdCache = 0;
async function getBotId(): Promise<number> {
  if (botIdCache || !config.botToken) return botIdCache;
  const me = await tg('getMe');
  if (me.ok) botIdCache = me.result.id;
  return botIdCache;
}

/** Разрешить идентификатор канала (@username или -100… ID) через getChat и проверить,
 *  что бот — админ (иначе getChatMember чужих пользователей не сработает).
 *  Используется админкой для валидации канала перед сохранением. */
export async function resolveChannel(ch: string): Promise<{
  ok: boolean; id?: string; title?: string; username?: string; type?: string; botIsAdmin?: boolean; error?: string;
}> {
  const id = String(ch || '').trim().replace(/^@/, '');
  if (!id) return { ok: false, error: 'empty' };
  try {
    const chat = await tg('getChat', { chat_id: id });
    if (!chat.ok) return { ok: false, id, error: chat.description || 'канал не найден или бот не участник' };
    const r = chat.result;
    const bid = await getBotId();
    let botIsAdmin = false;
    if (bid) {
      const m = await tg('getChatMember', { chat_id: id, user_id: bid }).catch(() => null as any);
      const st = m?.result?.status;
      botIsAdmin = st === 'administrator' || st === 'creator';
    }
    return {
      ok: true,
      id: String(r.id ?? id),
      title: r.title || (r.username ? '@' + r.username : id),
      username: r.username ? '@' + r.username : '',
      type: r.type,
      botIsAdmin,
    };
  } catch (e: any) {
    return { ok: false, id, error: e?.message || 'не удалось разрешить канал' };
  }
}

/* ── обязательные подписки на каналы (гейт перед активацией кабинета) ── */

// Кэш результатов проверки (tgId -> {at, ok}), TTL 60с: getChatMember на каждый запрос — дорого.
const subsCache = new Map<number, { at: number; ok: boolean }>();
const SUBS_TTL = 60_000;

/** true — пользователь подписан на все обязательные каналы (или каналы не заданы / это админ).
 *  Экспортируется: cabinet и программа тоже проверяют подписки на каждом действии.
 *  Список каналов берётся из БД (getRequiredChannels) — редактируется из админки. */
export async function checkChannelSubs(tgId: number | null): Promise<boolean> {
  // Аккаунт без Telegram (вход по email-коду) проверять нечем — не блокируем.
  if (tgId == null) return true;
  const channels = await getRequiredChannels();
  if (!channels.length) return true;
  if (config.adminTgId > 0 && tgId === config.adminTgId) return true;
  const c = subsCache.get(tgId);
  if (c && Date.now() - c.at < SUBS_TTL) return c.ok;
  let ok = true;
  try {
    for (const ch of channels) {
      const r = await tg('getChatMember', { chat_id: ch, user_id: tgId });
      const st = r?.result?.status;
      if (!['creator', 'administrator', 'member', 'restricted'].includes(st)) { ok = false; break; }
    }
  } catch (e) {
    // Сбой Telegram API: не блокируем всех (fail-open), но логируем — поймать отписку важнее, чем сломать вход при сбое TG.
    console.warn('[bot] checkChannelSubs', tgId, e);
    ok = true;
  }
  subsCache.set(tgId, { at: Date.now(), ok });
  return ok;
}

const channelUrl = (ch: string) => (ch.startsWith('-') ? null : `https://t.me/${ch}`);

/** Клавиатура гейта: кнопки на каждый канал + «Я подписался — проверить».
 *  intent 'login' несёт исходный токен входа (вернём его в callback_data), 'ref' — без токена.
 *  Async: список каналов читается из БД. */
async function subsGateKb(intent: 'ref' | 'login', param: string) {
  const channels = await getRequiredChannels();
  const rows: { text: string; url?: string; callback_data?: string }[][] = channels.map((ch) => {
    const url = channelUrl(ch);
    const text = ch.startsWith('-') ? `📢 Канал ${ch}` : `📢 @${ch}`;
    return url ? [{ text, url }] : [{ text, callback_data: 'sub:nop' }];
  });
  const cb = intent === 'login' ? `sub:check:lt:${param}` : 'sub:check:ref';
  rows.push([{ text: '✅ Я подписался — проверить', callback_data: cb }]);
  return { inline_keyboard: rows };
}

const SUBS_GATE_TEXT =
  'Чтобы продолжить, подпишитесь на все каналы ниже — так вы получаете обновления и важные новости сервиса.\n\n' +
  'После подписки нажмите «✅ Я подписался — проверить».';

/** Завершение старт-флоу после прохождения подписок.
 *  login — привязываем исходный токен входа (пользователь пришёл с сайта).
 *  ref   — выдаём индивидуальную ссылку на кабинет /app?token=. */
async function finalizeStart(chatId: number, user: User, intent: 'ref' | 'login', param: string) {
  const base = publicUrl();
  if (intent === 'login') {
    const ok = await bindLoginToken(param, user.id);
    if (!ok) {
      await notify(chatId, 'Ссылка устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.', { reply_markup: docsMarkup(true) });
      return;
    }
    await notify(
      chatId,
      `✅ Готово, ${user.firstName}! Вернитесь в браузер — вход выполнится автоматически.\n\nПравовые документы сервиса доступны по кнопкам ниже:`,
      { reply_markup: docsMarkup(false) },
    );
    return;
  }
  // ref: выдаём индивидуальную ссылку на кабинет
  const token = randomToken(24);
  await createLoginToken(token);
  await bindLoginToken(token, user.id);
  await notify(
    chatId,
    `✅ Спасибо, ${user.firstName}! Вы подписались.\n\nНажмите кнопку ниже, чтобы войти в личный кабинет:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 Открыть личный кабинет', url: `${base}/app?token=${token}` }],
          ...docsMarkup(false).inline_keyboard,
        ],
      },
    },
  );
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
const who = (u: { firstName: string; username: string | null; tgId: number | null; email?: string | null }) =>
  u.tgId == null
    ? `${u.username ? '@' + u.username : u.firstName} (вход по почте${u.email ? ': ' + u.email : ''})`
    : `${u.username ? '@' + u.username : u.firstName} (id ${u.tgId})`;

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

Раздел «Обучение» (виден в программе на тарифах PRO и Ultra):
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

/* ── инлайн админ-меню + быстрые действия (полное редактирование — в Mini App /admin.html) ── */

const admUrl = () => `${publicUrl()}/admin.html`;

function adminHomeKb() {
  return {
    inline_keyboard: [
      [{ text: '🖥 Открыть панель', web_app: { url: admUrl() } }],
      [{ text: '👥 Пользователи', callback_data: 'adm:users' }, { text: '💰 Тарифы', callback_data: 'adm:plans' }],
      [{ text: '🎓 Обучение', callback_data: 'adm:train' }, { text: 'ℹ️ Команды', callback_data: 'adm:help' }],
    ],
  };
}

const adminHomeText = '🖥 Админ-панель Fracs\n\nОткройте полную панель кнопкой ниже или посмотрите быструю сводку по разделам. Команды (/grant, /plans …) тоже работают.';

const backKb = (cb: string) => ({ inline_keyboard: [[{ text: '← Назад', callback_data: cb }]] });

async function editMsg(chatId: number, messageId: number, text: string, markup: unknown) {
  await tg('editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: markup }).catch(() => {});
}

async function answerCb(cbId: string, text = '', alert = false) {
  await tg('answerCallbackQuery', { callback_query_id: cbId, text, show_alert: alert }).catch(() => {});
}

async function sendAdminMenu(chatId: number) {
  await notify(chatId, adminHomeText, { reply_markup: adminHomeKb() });
}

/** Карточка одного пользователя с быстрыми кнопками выдачи/снятия подписки. */
async function renderUserView(chatId: number, messageId: number, tgId: number) {
  const u = await findUser(String(tgId));
  if (!u) {
    await editMsg(chatId, messageId, 'Пользователь не найден — пусть сначала войдёт в кабинет через бота.', backKb('adm:users'));
    return;
  }
  const text =
    `👤 ${who(u)}\n` +
    `Подписка: ${isSubscribed(u) ? 'до ' + fmt(u.subscriptionUntil) : 'нет'}${u.planId ? ` (${u.planId})` : ''}\n` +
    `Регистрация: ${fmt(u.createdAt)}`;
  const kb = {
    inline_keyboard: [
      [{ text: 'Ultra 30 дней', callback_data: `adm:g:${tgId}:ultra:30` }, { text: 'PRO 30 дней', callback_data: `adm:g:${tgId}:pro:30` }],
      [{ text: 'Start 30 дней', callback_data: `adm:g:${tgId}:start:30` }],
      [{ text: '✕ Снять подписку', callback_data: `adm:r:${tgId}` }],
      [{ text: '← К списку', callback_data: 'adm:users' }],
    ],
  };
  await editMsg(chatId, messageId, text, kb);
}

/** true — колбэк админ-меню обработан. */
async function handleAdminCallback(cb: any): Promise<boolean> {
  const data: string = cb?.data || '';
  if (!data.startsWith('adm:')) return false;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const cbId = cb.id;
  if (!chatId || !messageId) return false;

  if (data === 'adm:home') {
    await editMsg(chatId, messageId, adminHomeText, adminHomeKb());
    await answerCb(cbId);
    return true;
  }
  if (data === 'adm:help') {
    await editMsg(chatId, messageId, ADMIN_HELP, backKb('adm:home'));
    await answerCb(cbId);
    return true;
  }
  if (data === 'adm:users') {
    const list = await listRecentUsers(8);
    if (!list.length) {
      await editMsg(chatId, messageId, '👥 Пользователей пока нет.', backKb('adm:home'));
      await answerCb(cbId);
      return true;
    }
    const rows = list.map((u) => [
      { text: `${(u.username || u.firstName).slice(0, 20)}${isSubscribed(u) ? ' ✅' : ' ⬜'}`, callback_data: `adm:u:${u.tgId}` },
    ]);
    rows.push([{ text: '← Назад', callback_data: 'adm:home' }]);
    await editMsg(chatId, messageId, '👥 Последние пользователи\n\nТапните по строке, чтобы выдать или снять подписку:', { inline_keyboard: rows });
    await answerCb(cbId);
    return true;
  }
  if (data === 'adm:plans') {
    const plans = await getPlans();
    const kb = { inline_keyboard: [[{ text: '♻️ Сбросить к стандартным', callback_data: 'adm:plansreset' }], [{ text: '← Назад', callback_data: 'adm:home' }]] };
    await editMsg(chatId, messageId, '💰 Тарифы:\n\n' + formatPlans(plans), kb);
    await answerCb(cbId);
    return true;
  }
  if (data === 'adm:plansreset') {
    const plans = await resetPlans();
    await editMsg(chatId, messageId, '♻️ Тарифы сброшены к стандартным:\n\n' + formatPlans(plans), backKb('adm:home'));
    await answerCb(cbId, 'Сброшено к стандартным');
    return true;
  }
  if (data === 'adm:train') {
    const lessons = await getTraining();
    const text = lessons.length ? '🎓 Уроки:\n\n' + lessons.map((l, i) => `${i + 1}. ${l.title}`).join('\n') : '🎓 Уроков пока нет.';
    const kb = { inline_keyboard: [[{ text: '🖥 Редактировать в панели', web_app: { url: admUrl() } }], [{ text: '← Назад', callback_data: 'adm:home' }]] };
    await editMsg(chatId, messageId, text, kb);
    await answerCb(cbId);
    return true;
  }

  const m = data.match(/^adm:u:(\d+)$/);
  if (m) {
    await renderUserView(chatId, messageId, Number(m[1]));
    await answerCb(cbId);
    return true;
  }

  const g = data.match(/^adm:g:(\d+):(\w+):(\d+)$/);
  if (g) {
    const tgId = Number(g[1]);
    const planId = g[2];
    const days = Number(g[3]);
    const u = await findUser(String(tgId));
    if (!u) return answerCb(cbId, 'Пользователь не найден', true).then(() => true);
    const plans = await getPlans();
    if (!plans.some((p) => p.id === planId)) return answerCb(cbId, `Тариф ${planId} не найден`, true).then(() => true);
    const upd = await extendSubscription(u.id, days, planId);
    await answerCb(cbId, `✅ ${planId.toUpperCase()} ${days} дн. до ${fmt(upd.subscriptionUntil)}`);
    await notify(upd.tgId, `✅ Подписка Fracs активна до ${fmt(upd.subscriptionUntil)}. Кабинет: ${publicUrl()}/app`).catch(() => {});
    await renderUserView(chatId, messageId, tgId);
    return true;
  }

  const r = data.match(/^adm:r:(\d+)$/);
  if (r) {
    const tgId = Number(r[1]);
    const u = await findUser(String(tgId));
    if (!u) return answerCb(cbId, 'Пользователь не найден', true).then(() => true);
    await setSubscription(u.id, null);
    await answerCb(cbId, '🚫 Подписка снята');
    await renderUserView(chatId, messageId, tgId);
    return true;
  }
  return false;
}

/** Команды админа. true — команда обработана. */
async function handleAdmin(chatId: number, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const [raw, ...args] = trimmed.split(/\s+/);
  const cmd = raw.split('@')[0].toLowerCase();
  if (!ADMIN_CMDS.includes(cmd)) return false;

  if (cmd === '/admin') {
    await sendAdminMenu(chatId);
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

/** Обработка кнопок гейта подписок (sub:*). Не-админ жмёт «Я подписался — проверить». */
/** Подтверждение входа с сайта: токен привязывается только по явной кнопке. */
async function handleLoginConfirm(cb: any) {
  const data: string = cb.data || '';
  const chatId = cb.message?.chat?.id;
  const cbId = String(cb.id || '');
  if (!chatId) { await answerCb(cbId); return; }
  if (data === 'lt:no') {
    await editMsg(chatId, cb.message?.message_id, '🛡 Вход отменён. Если вы не инициировали вход — никто не получил доступ к вашему аккаунту.', { reply_markup: { inline_keyboard: [] } });
    await answerCb(cbId, 'Вход отменён');
    return;
  }
  const token = data.startsWith('lt:ok:') ? data.slice(6) : '';
  const user = await upsertTgUser(cb.from);
  if (!(await checkChannelSubs(user.tgId))) {
    await notify(chatId, SUBS_GATE_TEXT, { reply_markup: await subsGateKb('login', token) });
    await answerCb(cbId);
    return;
  }
  await finalizeStart(chatId, user, 'login', token);
  await answerCb(cbId, 'Вход подтверждён');
}

async function handleSubCallback(cb: any) {
  const data: string = cb.data || '';
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const cbId = cb.id;
  if (!chatId) { await answerCb(cbId); return; }
  if (data === 'sub:nop') { await answerCb(cbId, 'Откройте канал и подпишитесь, затем нажмите «проверить»'); return; }
  if (!data.startsWith('sub:check')) { await answerCb(cbId); return; }
  const user = await upsertTgUser(cb.from);
  const ok = await checkChannelSubs(user.tgId);
  if (!ok) { await answerCb(cbId, 'Ещё не подписаны на все каналы', true); return; }
  await answerCb(cbId, '✅ Подписки подтверждены');
  const m = data.match(/^sub:check:lt:(.+)$/);
  const intent: 'ref' | 'login' = m ? 'login' : 'ref';
  const param = m ? m[1] : '';
  if (messageId) await tg('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
  if (intent === 'login') {
    // Токен входа с сайта привязываем только после явного подтверждения (анти-угон).
    await notify(
      chatId,
      `🔑 Вы входите на сайт Fracs по ссылке из браузера.\n\nЕсли это ВЫ — подтвердите вход.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Это я — подтвердить вход', callback_data: `lt:ok:${param}` }],
            [{ text: '❌ Это не я — отменить', callback_data: 'lt:no' }],
          ],
        },
      },
    );
    return;
  }
  await finalizeStart(chatId, user, intent, param);
}

export async function handleUpdate(update: any) {
  const cb = update?.callback_query;
  if (cb) {
    if (config.adminTgId > 0 && cb.from?.id === config.adminTgId) {
      try {
        await handleAdminCallback(cb);
      } catch (e: any) {
        console.error('[bot] admin cb', e);
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `Ошибка: ${e?.message || e}`, show_alert: true }).catch(() => {});
      }
      return;
    }
    if ((cb.data || '').startsWith('sub:')) {
      try {
        await handleSubCallback(cb);
      } catch (e: any) {
        console.error('[bot] sub cb', e);
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `Ошибка: ${e?.message || e}`, show_alert: true }).catch(() => {});
      }
      return;
    }
    if ((cb.data || '').startsWith('lt:')) {
      try {
        await handleLoginConfirm(cb);
      } catch (e: any) {
        console.error('[bot] login cb', e);
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `Ошибка: ${e?.message || e}`, show_alert: true }).catch(() => {});
      }
      return;
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Нет доступа' }).catch(() => {});
    return;
  }

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

  // /start с параметром — основной вход: реферальная ссылка (ref_…) или токен входа с сайта.
  if (cmd === '/start' && param) {
    const intent: 'ref' | 'login' = param.startsWith('ref_') ? 'ref' : 'login';
    const user = await upsertTgUser(msg.from);
    const subscribed = await checkChannelSubs(user.tgId);
    if (intent === 'login') {
      // Анти-угон: токен привязывается ТОЛЬКО после явного подтверждения.
      // Иначе атакующий может подсунуть жертве ссылку /start=<токен> и забрать сессию.
      if (!subscribed) {
        await notify(msg.chat.id, SUBS_GATE_TEXT, { reply_markup: await subsGateKb('login', param) });
        return;
      }
      await notify(
        msg.chat.id,
        `🔑 Вы входите на сайт Fracs по ссылке из браузера.\n\n` +
        `Если это ВЫ и вы нажимали «Войти через Telegram» на сайте — подтвердите вход. ` +
        `Если нет: возможно, кто-то пытается получить доступ к вашему аккаунту — нажмите «Отменить».`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Это я — подтвердить вход', callback_data: `lt:ok:${param}` }],
              [{ text: '❌ Это не я — отменить', callback_data: 'lt:no' }],
            ],
          },
        },
      );
      return;
    }
    if (subscribed) {
      await finalizeStart(msg.chat.id, user, intent, '');
    } else {
      await notify(msg.chat.id, SUBS_GATE_TEXT, { reply_markup: await subsGateKb('ref', '') });
    }
    return;
  }

  // Любое другое действие — только после обязательных подписок. Отписался → блок.
  if (!(await checkChannelSubs(msg.from.id))) {
    await notify(msg.chat.id, SUBS_GATE_TEXT, { reply_markup: await subsGateKb('ref', '') });
    return;
  }

  if (cmd === '/privacy') {
    await notify(msg.chat.id, `🔒 Политика конфиденциальности Fracs:\n${base}/privacy`, { reply_markup: docsMarkup(false) });
    return;
  }
  if (cmd === '/terms') {
    await notify(msg.chat.id, `📄 Пользовательское соглашение Fracs:\n${base}/terms`, { reply_markup: docsMarkup(false) });
    return;
  }
  if (cmd === '/offer') {
    await notify(msg.chat.id, `📑 Публичная оферта Fracs:\n${base}/offer`, { reply_markup: docsMarkup(false) });
    return;
  }
  if (cmd === '/docs') {
    await notify(msg.chat.id, 'Правовые документы сервиса Fracs:', { reply_markup: docsMarkup(true) });
    return;
  }
  if (cmd !== '/start') {
    await notify(msg.chat.id, `Откройте личный кабинет: ${base}/app`, { reply_markup: docsMarkup(true) });
    return;
  }
  // /start без параметра
  await notify(
    msg.chat.id,
    `Привет! Это бот Fracs.\n\nЧтобы войти, нажмите «Войти через Telegram» на странице ${base}/app.\n\nПеред началом работы вы можете ознакомиться с правовыми документами по кнопкам ниже:`,
    { reply_markup: docsMarkup(true) },
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
      const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, 40_000);
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

let webhookEnsured = false;

/** Самовосстановление webhook после деплоя/сброса (webhook пропадает, например,
 *  если где-то поднимался polling-инстанс или после пересоздания функции).
 *  Вызывается fire-and-forget при холодном старте сервера; идемпотентно. */
export async function ensureWebhook() {
  if (webhookEnsured || !config.botToken || config.botMode !== 'webhook') return;
  webhookEnsured = true;
  try {
    if (!config.webhookSecret) throw new Error('Для webhook-режима задайте TELEGRAM_WEBHOOK_SECRET');
    const me = await tg('getMe');
    if (!me.ok) throw new Error(`Telegram getMe: ${me.description}`);
    if (!botUsername) botUsername = me.result.username;
    const r = await tg('setWebhook', {
      url: `${config.appUrl}/api/bot/webhook`,
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
    });
    if (!r.ok) throw new Error(`setWebhook: ${r.description}`);
    console.log(`[bot] webhook проверен/восстановлен: ${config.appUrl}/api/bot/webhook`);
  } catch (e: any) {
    console.error('[bot] ensureWebhook:', e?.message || e);
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

  // /admin виден только в чате администратора.
  if (config.adminTgId > 0) {
    await tg('setMyCommands', {
      commands: [{ command: 'admin', description: 'Админ-панель' }],
      scope: { type: 'chat', chat_id: config.adminTgId },
    }).catch(() => {});
  }

  if (config.botMode === 'webhook') {
    if (!config.webhookSecret) throw new Error('Для webhook-режима задайте TELEGRAM_WEBHOOK_SECRET');
    const r = await tg('setWebhook', { url: `${config.appUrl}/api/bot/webhook`, secret_token: config.webhookSecret, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) throw new Error(`setWebhook: ${r.description}`);
    webhookEnsured = true;
  } else {
    await tg('deleteWebhook');
    poll();
  }
}
