import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config } from './config.ts';
import {
  claimTrial, countSearchesSince, getActiveFeatures, getPlans, getSearch, getTraining, hasUsedTrial, insertSearch, isSubscribed, listSearches, newId, ping, rateLimit, recentSearches,
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

/** Ограничивает число из пользовательского ввода диапазоном [min, max]; fallback d. */
const num = (v: unknown, min: number, max: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
/** Булев флаг только при строгом true — прочее (строка «true»/число) не проходит. */
const flag = (v: unknown) => v === true;

/** Белый список опций, которые пересылаем Chrome-worker'у: остальное из req.body
 *  игнорируем, чтобы клиент не мог протолкнуть произвольные поля/filters/advanced. */
function trialOptions(body: any) {
  const f = body?.filters || {}, a = body?.advanced || {};
  return {
    filters: {
      dedup_franchises: flag(f.dedup_franchises), dedup_across_niches: f.dedup_across_niches !== false,
      require_phone: flag(f.require_phone), require_whatsapp: flag(f.require_whatsapp),
      require_social: flag(f.require_social), require_email: flag(f.require_email),
      require_website: false, require_no_website: true,
      min_rating: num(f.min_rating, 0, 5, 0), min_reviews: num(f.min_reviews, 0, 100000, 0),
    },
    advanced: {
      disable_images: true, skip_404_response: a.skip_404_response !== false,
      delay_between_clicks: num(a.delay_between_clicks, 0, 5000, 0),
      columns_per_entity: num(a.columns_per_entity, 1, 5, 3),
    },
  };
}

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
  res.json({ items: searchCities(String(req.query.q || '').slice(0, 40), 8) });
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
    admin: config.adminTgId > 0 && u.tgId === config.adminTgId,
    subscription: { active: isSubscribed(u), until: u.subscriptionUntil },
    features: await getActiveFeatures(u),
    trial: { maps: !mapsTrialUsed, tg: !tgTrialUsed },
    quota: { used: await usedToday(u), limit: config.dailySearchLimit },
  });
}));

/** Раздел «Обучение»: только для подписчиков с features.training (тариф PRO). */
api.get('/training', requireAuth, h(async (req, res) => {
  const u = req.user!;
  if (!isSubscribed(u)) return void res.status(402).json({ error: 'subscription_required', message: 'Раздел доступен по подписке.' });
  const features = await getActiveFeatures(u);
  if (!features.includes('training')) {
    return void res.status(402).json({ error: 'training_required', message: 'Раздел «Обучение» доступен на тарифе PRO.' });
  }
  res.json({ lessons: await getTraining() });
}));

const MASK = '•••';
const MAPS_DOMAINS = new Set(['ru', 'kz', 'by', 'az', 'kg', 'uz', 'cz', 'eg', 'it', 'sa', 'com.cy', 'ae', 'cl', 'qa', 'om', 'bh', 'kw', 'iq']);
const maskPhone = (p: string | null) => (p ? p.slice(0, 7) + '•••-••-' + p.slice(-2) : null);
const maskStart = (s: string, keep = 3) => s.slice(0, keep) + MASK;
const parseCooldownMs = 6 * 60 * 60_000;

interface TrialTicket {
  userId: string;
  jobId: string;
  seed: string;
  niche: string;
  cityLabel: string;
  createdAt: number;
}

function signTrialTicket(ticket: TrialTicket): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  const signature = crypto.createHmac('sha256', config.sessionSecret).update('trial-ticket:' + payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyTrialTicket(value: unknown, userId: string): TrialTicket | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', config.sessionSecret).update('trial-ticket:' + payload).digest('base64url'));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TrialTicket;
    if (ticket.userId !== userId || !ticket.jobId || !ticket.seed || Date.now() - ticket.createdAt > 24 * 60 * 60_000) return null;
    return ticket;
  } catch {
    return null;
  }
}

function parse2gisUrl(value: unknown): { url: string; cityKey: string; city: string; niche: string } | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const domain = parsed.hostname.startsWith('2gis.') ? parsed.hostname.slice('2gis.'.length) : '';
    if (!MAPS_DOMAINS.has(domain) || parts.length < 3 || parts[1] !== 'search') return null;
    return {
      url: parsed.toString(),
      cityKey: `${parsed.hostname.toLowerCase()}:${parts[0].toLowerCase()}`,
      city: decodeURIComponent(parts[0]),
      niche: decodeURIComponent(parts[2]).trim(),
    };
  } catch {
    return null;
  }
}

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

async function fullTrialView(rec: SearchRecord, user: User) {
  const stored = await getSearch(rec.id, user.id, true);
  return {
    ...view(rec, user),
    trialRows: stored ? getRows(stored, 0, stored.rowsTotal) as MapsRow[] : [],
  };
}

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
  return (await recentSearches(u.id, kind, 86400_000)).find((r) => match(r) && !r.demo && r.rowsTotal > 0);
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
  if (subscribed && !(await rateLimit(`maps-cooldown:${req.user!.id}`, 1, parseCooldownMs))) {
    return void res.status(429).json({ error: 'cooldown', message: 'Следующий парсинг будет доступен через 6 часов после предыдущего запуска.' });
  }
  try {
    const result = await searchMaps(niche, city, true);
    const stats = { ...result.stats };
    const summary = summarize('maps', stats, result.rows);
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'maps', createdAt: new Date().toISOString(), demo: false,
      seed: `${norm(niche)}|${city.id}`, query: { niche, cityId: city.id, cityLabel: `${city.name}, ${city.region}` },
      stats, rows: result.rows, ...summary,
    };
    if (!subscribed && rec.rowsTotal > 0 && !(await claimTrial(req.user!.id, 'maps'))) return void trialUsed(res);
    await insertSearch(rec);
    res.json(view(rec, req.user!));
  } catch (e: any) {
    console.error('[maps]', e);
    res.status(502).json({ error: 'provider', message: `Не удалось получить данные: ${e?.message || 'ошибка источника'}` });
  }
}));

api.post('/search/maps/trial/start', requireAuth, h(async (req, res) => {
  const user = req.user!;
  const isAdmin = config.adminTgId > 0 && user.tgId === config.adminTgId;
  if (isSubscribed(user) && !isAdmin) return void res.status(403).json({ error: 'subscription_active', message: 'Пробный запуск доступен только без активной подписки.' });
  if (await hasUsedTrial(user.id, 'maps')) return void trialUsed(res);
  if (!(await gate(req, res))) return;
  if (!config.mapsWorkerUrl || !config.mapsWorkerToken) {
    return void res.status(503).json({ error: 'worker_unconfigured', message: 'Реальный пробный парсинг пока не настроен. Администратору нужно подключить Chrome-worker.' });
  }

  const suppliedUrls: unknown[] = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const searches = suppliedUrls.map(parse2gisUrl);
  if (!searches.length || searches.some((search) => !search)) {
    return void res.status(400).json({ error: 'bad_urls', message: 'Добавьте корректные ссылки поиска 2ГИС.' });
  }
  const parsed = searches.filter((search): search is NonNullable<typeof search> => search !== null);
  if (parsed.length > 30) return void res.status(400).json({ error: 'too_many_urls', message: 'За один пробный запуск можно проверить не более 30 ссылок.' });
  if (new Set(parsed.map((search) => search.cityKey)).size > 3) {
    return void res.status(400).json({ error: 'city_limit', message: 'За один запуск можно выбрать не более 3 городов.' });
  }

  const uniqueUrls = [...new Set(parsed.map((search) => search.url))];
  const niche = cleanText(parsed[0].niche, 80) || 'Поиск 2ГИС';
  const cityLabel = [...new Set(parsed.map((search) => search.city))].join(', ');
  const seed = crypto.createHash('sha256').update([...uniqueUrls].sort().join('\n')).digest('hex');
  try {
    const workerResponse = await fetch(`${config.mapsWorkerUrl}/api/internal/trial/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.mapsWorkerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...trialOptions(req.body),
        urls: uniqueUrls,
        max_records: Math.min(60, Math.max(1, Number(req.body?.maxRecords) || 20)),
        clean: true,
        directions: uniqueUrls.map((url) => ({ url, label: String(req.body?.labels?.[url] || '') })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const workerResult: any = await workerResponse.json().catch(() => ({}));
    if (!workerResponse.ok) {
      return void res.status(workerResponse.status === 409 ? 409 : 502).json({
        error: 'worker_start_failed',
        message: workerResult.error || 'Chrome-worker не смог запустить задачу.',
      });
    }
    if (typeof workerResult.jobId !== 'string' || !workerResult.jobId) {
      return void res.status(502).json({ error: 'worker_bad_response', message: 'Chrome-worker вернул некорректный ответ.' });
    }
    const ticket = signTrialTicket({ userId: user.id, jobId: workerResult.jobId, seed, niche, cityLabel, createdAt: Date.now() });
    res.json({ ticket, status: 'running' });
  } catch (e: any) {
    console.error('[maps worker start]', e);
    res.status(502).json({ error: 'worker_unreachable', message: 'Не удалось подключиться к Chrome-worker. Попробуйте позже.' });
  }
}));

api.post('/search/maps/trial/status', requireAuth, h(async (req, res) => {
  const ticket = verifyTrialTicket(req.body?.ticket, req.user!.id);
  if (!ticket) return void res.status(400).json({ error: 'bad_ticket', message: 'Задание недействительно или устарело. Запустите пробный поиск заново.' });

  const existing = (await recentSearches(req.user!.id, 'maps', 86400_000))
    .find((record) => record.seed === ticket.seed && !record.demo && record.rowsTotal > 0);
  if (existing) return void res.json({ status: 'done', result: await fullTrialView(existing, req.user!) });
  if (!config.mapsWorkerUrl || !config.mapsWorkerToken) {
    return void res.status(503).json({ error: 'worker_unconfigured', message: 'Chrome-worker не настроен.' });
  }

  try {
    const workerResponse = await fetch(`${config.mapsWorkerUrl}/api/internal/trial/jobs/${encodeURIComponent(ticket.jobId)}`, {
      headers: { Authorization: `Bearer ${config.mapsWorkerToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const workerResult: any = await workerResponse.json().catch(() => ({}));
    if (!workerResponse.ok) {
      return void res.status(workerResponse.status === 404 ? 404 : 502).json({
        error: 'worker_status_failed',
        message: workerResult.error || 'Не удалось получить состояние Chrome-worker.',
      });
    }
    if (workerResult.status === 'running') {
      return void res.json({ status: 'running', count: Number(workerResult.count) || 0, logs: workerResult.logs || [] });
    }
    if (workerResult.status === 'error') {
      return void res.json({ status: 'error', error: workerResult.error || 'Chrome-парсер завершился с ошибкой.', logs: workerResult.logs || [] });
    }
    if (!['done', 'stopped'].includes(workerResult.status) || !Array.isArray(workerResult.records)) {
      return void res.status(502).json({ error: 'worker_bad_response', message: 'Chrome-worker вернул некорректный результат.' });
    }

    const rows: MapsRow[] = workerResult.records.map((record: any, index: number) => {
      const contacts = record?.contacts && typeof record.contacts === 'object' ? record.contacts : {};
      const phoneValue = contacts.phone || record.phone;
      const ratingValue = record.rating == null || record.rating === '' ? null : Number(record.rating);
      const reviewsValue = record.review_count == null || record.review_count === '' ? null : Number(record.review_count);
      return {
        id: String(record.id || `${ticket.jobId}-${index}`),
        name: cleanText(record.name, 200) || 'Без названия',
        category: cleanText(Array.isArray(record.rubrics) ? record.rubrics.join(', ') : '', 160) || ticket.niche,
        address: cleanText([record.address, record.district, record.city].filter(Boolean).join(', '), 300),
        phone: typeof phoneValue === 'string' && phoneValue ? cleanText(phoneValue, 80) : null,
        rating: ratingValue !== null && Number.isFinite(ratingValue) ? ratingValue : null,
        reviews: reviewsValue !== null && Number.isFinite(reviewsValue) ? reviewsValue : null,
        url: typeof record.url === 'string' ? record.url : null,
      };
    });
    if (!rows.length) {
      return void res.json({ status: 'done', empty: true, logs: workerResult.logs || [] });
    }

    const stats = {
      total: rows.length,
      withoutSite: rows.length,
      withPhone: rows.filter((row) => Boolean(row.phone)).length,
    };
    const summary = summarize('maps', stats, rows);
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'maps', createdAt: new Date().toISOString(), demo: false,
      seed: ticket.seed, query: { niche: ticket.niche, cityLabel: ticket.cityLabel },
      stats, rows, ...summary,
    };
    if (!(await claimTrial(req.user!.id, 'maps'))) {
      const used = (await recentSearches(req.user!.id, 'maps', 86400_000))
        .find((record) => record.seed === ticket.seed && !record.demo && record.rowsTotal > 0);
      if (used) return void res.json({ status: 'done', result: await fullTrialView(used, req.user!) });
      return void trialUsed(res);
    }
    await insertSearch(rec);
    res.json({ status: 'done', result: { ...view(rec, req.user!), trialRows: rows } });
  } catch (e: any) {
    console.error('[maps worker status]', e);
    res.status(502).json({ error: 'worker_unreachable', message: 'Не удалось получить результаты Chrome-парсинга.' });
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
    const stats = { ...result.stats };
    const summary = summarize('tg', stats, result.rows);
    const rec: SearchRecord = {
      id: newId(), userId: req.user!.id, kind: 'tg', createdAt: new Date().toISOString(), demo: false,
      seed: `${norm(phrase)}|${days}`, query: { phrase, days }, stats, rows: result.rows, ...summary,
    };
    if (!subscribed && rec.rowsTotal > 0 && !(await claimTrial(req.user!.id, 'tg'))) return void trialUsed(res);
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
