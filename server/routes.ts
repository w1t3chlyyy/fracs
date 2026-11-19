import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config } from './config.ts';
import {
  claimTrial, countSearchesSince, getPlans, getSearch, hasUsedTrial, insertSearch, isSubscribed, listSearches, newId, ping, rateLimit, recentSearches,
  type SearchRecord, type User,
} from './db.ts';
import { authRouter, requireAuth } from './auth.ts';
import { notify } from './bot.ts';
import { findCity, searchCities } from './cities.ts';
import { getRows, headRows, searchMaps, searchTg, summarize } from './providers.ts';
import type { MapsRow, TgRow } from './providers.ts';
import { createPayment, handleYookassaWebhook } from './payments.ts';
import { cronHandler } from './cron.ts';
import { cleanText, norm } from './util.ts';

export const api = Router();

const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

api.use('/auth', authRouter);

api.get('/health', h(async (_req, res) => {
  res.json({ ok: true, db: await ping().catch(() => false) });
}));

api.get('/config', h(async (_req, res) => {
  res.json({
    devLogin: config.devLogin,
    payment: config.paymentProvider,
    plans: await getPlans(),
    demo: { maps: false, tg: false },
    adminUsername: config.adminUsername || undefined,
  });
}));

api.get('/cities', (req, res) => {
  res.json({ items: searchCities(String(req.query.q || ''), 8) });
});

api.post('/payments/yookassa/webhook', h(async (req, res) => {
  if (config.paymentProvider === 'yookassa') {
    try {
      await handleYookassaWebhook(req.body);
    } catch (e) {
      console.error('[yookassa]', e);
      return void res.sendStatus(500);
    }
  }
  res.sendStatus(200);
}));

api.all('/cron/cleanup', h(cronHandler));

const usedToday = (u: User) => countSearchesSince(u.id, 86400_000);

api.get('/me', h(async (req, res) => {
  const u = req.user;
  if (!u) return void res.json({ user: null });
  const [mapsTrialUsed, tgTrialUsed] = await Promise.all([
    hasUsedTrial(u.id, 'maps'),
    hasUsedTrial(u.id, 'tg'),
  ]);
  res.json({
    user: { id: u.id, firstName: u.firstName, username: u.username },
    subscription: { active: isSubscribed(u), until: u.subscriptionUntil },
    trial: { maps: !mapsTrialUsed, tg: !tgTrialUsed },
    quota: { used: await usedToday(u), limit: config.dailySearchLimit },
  });
}));

const MASK = '•••';
const maskPhone = (p: string | null) => (p ? p.slice(0, 7) + '•••-••-' + p.slice(-2) : null);
const maskStart = (s: string, keep = 3) => s.slice(0, keep) + MASK;

function teaser(rec: SearchRecord) {
  const rows = headRows(rec);
  if (rec.kind === 'maps') {
    return (rows as MapsRow[]).map((r) => ({
      id: r.id, name: maskStart(r.name, 6), category: r.category, address: r.address.split(',')[0] + ', ' + MASK,
      phone: maskPhone(r.phone), rating: r.rating, reviews: r.reviews, url: null,
    }));
  }
  return (rows as TgRow[]).map((r) => ({
    id: r.id, username: maskStart(r.username, 2), name: r.name[0] + MASK, chat: maskStart(r.chat, 4),
    text: maskStart(r.text, 20), date: r.date, link: '',
  }));
}

const view = (rec: SearchRecord, u: User) => ({
  id: rec.id, kind: rec.kind, createdAt: rec.createdAt, demo: rec.demo, query: rec.query, stats: rec.stats,
  rowsTotal: rec.rowsTotal,
  teaser: isSubscribed(u) ? [] : teaser(rec),
});

async function gate(req: Request, res: Response): Promise<boolean> {
  if (!(await rateLimit(`search:${req.user!.id}`, 10, 60_000))) {
    res.status(429).json({ error: 'rate_limited', message: 'Слишком часто. Подождите минуту.' });
    return false;
  }
  if ((await usedToday(req.user!)) >= config.dailySearchLimit) {
    res.status(429).json({ error: 'quota', message: `Дневной лимит ${config.dailySearchLimit} запросов исчерпан.` });
    return false;
  }
  return true;
}

/** Повтор за сутки берём из истории, но старые демо-записи не заменяют реальный пробный поиск. */
async function findRecent(u: User, kind: SearchRecord['kind'], match: (r: SearchRecord) => boolean) {
  return (await recentSearches(u.id, kind, 86400_000)).find((r) => match(r) && !r.demo);
}

api.post('/search/maps', requireAuth, h(async (req, res) => {
  const niche = cleanText(req.body?.niche, 80);
  const city = findCity(String(req.body?.cityId || ''));
  if (niche.length < 2) return void res.status(400).json({ error: 'bad_niche', message: 'Укажите нишу — например, «автосервис».' });
  if (!city) return void res.status(400).json({ error: 'bad_city', message: 'Выберите город из списка.' });

  const again = await findRecent(req.user!, 'maps', (s) => s.query.cityId === city.id && norm(s.query.niche || '') === norm(niche));
  if (again) return void res.json(view(again, req.user!));
  if (!(await gate(req, res))) return;

  const subscribed = isSubscribed(req.user!);
  if (!subscribed && await hasUsedTrial(req.user!.id, 'maps')) return void trialUsed(res);
  try {
    const result = await searchMaps(niche, city, true);
    const claimed = await claimTrial(req.user!.id, 'maps');
    if (!subscribed && !claimed) return void trialUsed(res);
    const stats = { ...result.stats };
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'maps', createdAt: new Date().toISOString(), demo: false,
      seed: `${norm(niche)}|${city.id}`, query: { niche, cityId: city.id, cityLabel: `${city.name}, ${city.region}` },
      stats, rows: result.rows, ...summarize('maps', stats, result.rows),
    };
    await insertSearch(rec);
    res.json(view(rec, req.user!));
  } catch (e: any) {
    console.error('[maps]', e);
    res.status(502).json({ error: 'provider', message: `Не удалось получить данные: ${e?.message || 'ошибка источника'}` });
  }
}));

api.post('/search/tg', requireAuth, h(async (req, res) => {
  const phrase = cleanText(req.body?.phrase, 120);
  const days = Math.min(3, Math.max(1, Math.round(Number(req.body?.days) || 3)));
  if (phrase.length < 3) return void res.status(400).json({ error: 'bad_phrase', message: 'Опишите, кому и что нужно — например, «нужен сайт».' });

  const again = await findRecent(req.user!, 'tg', (s) => norm(s.query.phrase || '') === norm(phrase) && s.query.days === days);
  if (again) return void res.json(view(again, req.user!));
  if (!(await gate(req, res))) return;

  const subscribed = isSubscribed(req.user!);
  if (!subscribed && await hasUsedTrial(req.user!.id, 'tg')) return void trialUsed(res);
  try {
    const result = await searchTg(phrase, days, true);
    const claimed = await claimTrial(req.user!.id, 'tg');
    if (!subscribed && !claimed) return void trialUsed(res);
    const stats = { ...result.stats };
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'tg', createdAt: new Date().toISOString(), demo: false,
      seed: `${norm(phrase)}|${days}`, query: { phrase, days }, stats, rows: result.rows, ...summarize('tg', stats, result.rows),
    };
    await insertSearch(rec);
    res.json(view(rec, req.user!));
  } catch (e: any) {
    console.error('[tg]', e);
    res.status(502).json({ error: 'provider', message: `Не удалось получить данные: ${e?.message || 'ошибка источника'}` });
  }
}));

api.get('/searches', requireAuth, h(async (req, res) => {
  const kind = req.query.kind === 'tg' ? 'tg' : 'maps';
  const items = (await listSearches(req.user!.id, kind, 10)).map((s) => view(s, req.user!));
  res.json({ items });
}));

const needSub = (res: Response) =>
  res.status(402).json({ error: 'subscription_required', message: 'Данные доступны по подписке.' });
const trialUsed = (res: Response) =>
  res.status(402).json({ error: 'trial_used', message: 'Пробный поиск использован. Оформите подписку для нового поиска.' });

api.get('/search/:id', requireAuth, h(async (req, res) => {
  const rec = await getSearch(String(req.params.id), req.user!.id);
  if (!rec) return void res.status(404).json({ error: 'not_found' });
  res.json(view(rec, req.user!));
}));

api.get('/search/:id/rows', requireAuth, h(async (req, res) => {
  if (!isSubscribed(req.user!)) {
    const exists = await getSearch(String(req.params.id), req.user!.id);
    return void (exists ? needSub(res) : res.status(404).json({ error: 'not_found' }));
  }
  const rec = await getSearch(String(req.params.id), req.user!.id, true);
  if (!rec) return void res.status(404).json({ error: 'not_found' });
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json({ rows: getRows(rec, offset, limit), total: rec.rowsTotal });
}));

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

api.get('/search/:id/export.csv', requireAuth, h(async (req, res) => {
  if (!isSubscribed(req.user!)) {
    const exists = await getSearch(String(req.params.id), req.user!.id);
    return void (exists ? needSub(res) : res.status(404).json({ error: 'not_found' }));
  }
  const rec = await getSearch(String(req.params.id), req.user!.id, true);
  if (!rec) return void res.status(404).json({ error: 'not_found' });
  const rows = getRows(rec, 0, rec.rowsTotal);
  const cols: [string, (r: any) => unknown][] =
    rec.kind === 'maps'
      ? [['Название', (r) => r.name], ['Категория', (r) => r.category], ['Адрес', (r) => r.address], ['Телефон', (r) => r.phone], ['Рейтинг', (r) => r.rating], ['Отзывов', (r) => r.reviews], ['Ссылка', (r) => r.url]]
      : [['Username', (r) => r.username], ['Имя', (r) => r.name], ['Чат', (r) => r.chat], ['Сообщение', (r) => r.text], ['Дата', (r) => r.date], ['Ссылка', (r) => r.link]];
  const csv = '\uFEFF' + [cols.map((c) => csvCell(c[0])).join(';'), ...rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fracs-${rec.kind}-${rec.id.slice(0, 8)}.csv"`);
  res.send(csv);
}));

/** Заявка на подписку: уведомляем админа в Telegram, клиент затем сам открывает чат с ним. */
api.post('/payments/request', requireAuth, h(async (req, res) => {
  if (!(await rateLimit(`payreq:${req.user!.id}`, 5, 10 * 60_000))) return void res.status(429).json({ error: 'rate_limited', message: 'Слишком часто. Подождите немного.' });
  const plans = await getPlans();
  const plan = plans.find((p) => p.id === String(req.body?.planId || ''));
  if (!plan) return void res.status(400).json({ error: 'bad_plan', message: 'Неизвестный тариф' });
  const u = req.user!;
  if (config.adminTgId > 0) {
    await notify(
      config.adminTgId,
      `🧾 Заявка на подписку\n${u.username ? '@' + u.username : u.firstName} (id ${u.tgId})\nТариф: ${plan.title}, ${plan.priceRub} ₽\n\nВыдать: /grant ${u.tgId} ${plan.days}`,
    );
  }
  res.json({ ok: true });
}));

api.post('/payments/create', requireAuth, h(async (req, res) => {
  if (!(await rateLimit(`pay:${req.user!.id}`, 10, 10 * 60_000))) return void res.status(429).json({ error: 'rate_limited' });
  try {
    res.json(await createPayment(req.user!, String(req.body?.planId || '')));
  } catch (e: any) {
    console.error('[pay]', e);
    res.status(e.status || 502).json({ error: 'payment', message: e.status ? e.message : 'Не удалось создать платёж. Попробуйте позже.' });
  }
}));
