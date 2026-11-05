import { Router } from 'express';
import { config, PLANS } from './config.ts';
import { data, isSubscribed, newId, save, type SearchRecord, type User } from './db.ts';
import { authRouter, requireAuth } from './auth.ts';
import { findCity, searchCities } from './cities.ts';
import { getRows, mapsIsDemo, rowCount, searchMaps, searchTg, tgIsDemo } from './providers.ts';
import type { MapsRow, TgRow } from './providers.ts';
import { createPayment, handleYookassaWebhook } from './payments.ts';
import { cleanText, norm, rateLimit } from './util.ts';

export const api = Router();
api.use('/auth', authRouter);

/* ── публичное ── */

api.get('/config', (_req, res) => {
  res.json({
    devLogin: config.devLogin,
    payment: config.paymentProvider,
    plans: PLANS,
    demo: { maps: mapsIsDemo(), tg: tgIsDemo() },
  });
});

api.get('/cities', (req, res) => {
  res.json({ items: searchCities(String(req.query.q || ''), 8) });
});

api.post('/payments/yookassa/webhook', (req, res) => {
  res.sendStatus(200); // отвечаем сразу, проверка статуса — отдельным запросом
  if (config.paymentProvider === 'yookassa') handleYookassaWebhook(req.body).catch((e) => console.error('[yookassa]', e));
});

/* ── пользователь ── */

const usedToday = (u: User) => data.searches.filter((s) => s.userId === u.id && Date.now() - Date.parse(s.createdAt) < 86400_000).length;

api.get('/me', (req, res) => {
  const u = req.user;
  if (!u) return void res.json({ user: null });
  res.json({
    user: { id: u.id, firstName: u.firstName, username: u.username },
    subscription: { active: isSubscribed(u), until: u.subscriptionUntil },
    quota: { used: usedToday(u), limit: config.dailySearchLimit },
  });
});

/* ── поиск ── */

const MASK = '•••';
const maskPhone = (p: string | null) => (p ? p.slice(0, 7) + '•••-••-' + p.slice(-2) : null);
const maskStart = (s: string, keep = 3) => s.slice(0, keep) + MASK;

/** Что видит пользователь без подписки: цифры и три замаскированных строки. */
function teaser(rec: SearchRecord) {
  const rows = getRows(rec, 0, 3);
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
  rowsTotal: rowCount(rec),
  teaser: isSubscribed(u) ? [] : teaser(rec),
});

function gate(req: any, res: any): boolean {
  if (!rateLimit(`search:${req.user.id}`, 10, 60_000)) {
    res.status(429).json({ error: 'rate_limited', message: 'Слишком часто. Подождите минуту.' });
    return false;
  }
  if (usedToday(req.user) >= config.dailySearchLimit) {
    res.status(429).json({ error: 'quota', message: `Дневной лимит ${config.dailySearchLimit} запросов исчерпан.` });
    return false;
  }
  return true;
}

function store(rec: SearchRecord) {
  data.searches.push(rec);
  if (data.searches.length > 5000) data.searches.splice(0, data.searches.length - 5000);
  save();
}

const recent = (u: User, kind: SearchRecord['kind'], match: (r: SearchRecord) => boolean) =>
  data.searches.find((s) => s.userId === u.id && s.kind === kind && Date.now() - Date.parse(s.createdAt) < 86400_000 && match(s));

api.post('/search/maps', requireAuth, async (req, res) => {
  const niche = cleanText(req.body?.niche, 80);
  const city = findCity(String(req.body?.cityId || ''));
  if (niche.length < 2) return void res.status(400).json({ error: 'bad_niche', message: 'Укажите нишу — например, «автосервис».' });
  if (!city) return void res.status(400).json({ error: 'bad_city', message: 'Выберите город из списка.' });

  // Повторный запрос за сутки отдаём из истории: не тратит лимит и не даёт «перебросить» цифры.
  const again = recent(req.user!, 'maps', (s) => s.query.cityId === city.id && norm(s.query.niche || '') === norm(niche));
  if (again) return void res.json(view(again, req.user!));
  if (!gate(req, res)) return;

  try {
    const result = await searchMaps(niche, city);
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'maps', createdAt: new Date().toISOString(), demo: mapsIsDemo(),
      seed: `${norm(niche)}|${city.id}`, query: { niche, cityId: city.id, cityLabel: `${city.name}, ${city.region}` },
      stats: { ...result.stats }, rows: result.rows,
    };
    store(rec);
    res.json(view(rec, req.user!));
  } catch (e) {
    console.error('[maps]', e);
    res.status(502).json({ error: 'provider', message: 'Не удалось получить данные. Попробуйте позже.' });
  }
});

api.post('/search/tg', requireAuth, async (req, res) => {
  const phrase = cleanText(req.body?.phrase, 120);
  const days = Math.min(3, Math.max(1, Math.round(Number(req.body?.days) || 3)));
  if (phrase.length < 3) return void res.status(400).json({ error: 'bad_phrase', message: 'Опишите, кому и что нужно — например, «нужен сайт».' });

  const again = recent(req.user!, 'tg', (s) => norm(s.query.phrase || '') === norm(phrase) && s.query.days === days);
  if (again) return void res.json(view(again, req.user!));
  if (!gate(req, res)) return;

  try {
    const result = await searchTg(phrase, days);
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'tg', createdAt: new Date().toISOString(), demo: tgIsDemo(),
      seed: `${norm(phrase)}|${days}`, query: { phrase, days }, stats: { ...result.stats }, rows: result.rows,
    };
    store(rec);
    res.json(view(rec, req.user!));
  } catch (e) {
    console.error('[tg]', e);
    res.status(502).json({ error: 'provider', message: 'Не удалось получить данные. Попробуйте позже.' });
  }
});

api.get('/searches', requireAuth, (req, res) => {
  const kind = req.query.kind === 'tg' ? 'tg' : 'maps';
  const items = data.searches
    .filter((s) => s.userId === req.user!.id && s.kind === kind)
    .slice(-10)
    .reverse()
    .map((s) => view(s, req.user!));
  res.json({ items });
});

const own = (req: any) => data.searches.find((s) => s.id === req.params.id && s.userId === req.user.id);
const needSub = (res: any) =>
  res.status(402).json({ error: 'subscription_required', message: 'Данные доступны по подписке.' });

api.get('/search/:id', requireAuth, (req, res) => {
  const rec = own(req);
  if (!rec) return void res.status(404).json({ error: 'not_found' });
  res.json(view(rec, req.user!));
});

api.get('/search/:id/rows', requireAuth, (req, res) => {
  const rec = own(req);
  if (!rec) return void res.status(404).json({ error: 'not_found' });
  if (!isSubscribed(req.user!)) return void needSub(res);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json({ rows: getRows(rec, offset, limit), total: rowCount(rec) });
});

// Защита от CSV-инъекций: ячейки, начинающиеся с = + - @, превращаем в текст.
const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

api.get('/search/:id/export.csv', requireAuth, (req, res) => {
  const rec = own(req);
  if (!rec) return void res.status(404).json({ error: 'not_found' });
  if (!isSubscribed(req.user!)) return void needSub(res);
  const rows = getRows(rec, 0, rowCount(rec));
  const cols: [string, (r: any) => unknown][] =
    rec.kind === 'maps'
      ? [['Название', (r) => r.name], ['Категория', (r) => r.category], ['Адрес', (r) => r.address], ['Телефон', (r) => r.phone], ['Рейтинг', (r) => r.rating], ['Отзывов', (r) => r.reviews], ['Ссылка 2ГИС', (r) => r.url]]
      : [['Username', (r) => r.username], ['Имя', (r) => r.name], ['Чат', (r) => r.chat], ['Сообщение', (r) => r.text], ['Дата', (r) => r.date], ['Ссылка', (r) => r.link]];
  const csv = '\uFEFF' + [cols.map((c) => csvCell(c[0])).join(';'), ...rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fracs-${rec.kind}-${rec.id.slice(0, 8)}.csv"`);
  res.send(csv);
});

/* ── оплата ── */

api.post('/payments/create', requireAuth, async (req, res) => {
  if (!rateLimit(`pay:${req.user!.id}`, 10, 10 * 60_000)) return void res.status(429).json({ error: 'rate_limited' });
  try {
    res.json(await createPayment(req.user!, String(req.body?.planId || '')));
  } catch (e: any) {
    console.error('[pay]', e);
    res.status(e.status || 502).json({ error: 'payment', message: e.status ? e.message : 'Не удалось создать платёж. Попробуйте позже.' });
  }
});
