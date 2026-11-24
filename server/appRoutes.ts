import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config } from './config.ts';
import { getUser, getActiveFeatures, getTraining, isSubscribed, rateLimit } from './db.ts';
import { requireAuth } from './auth.ts';
import { searchTg } from './providers.ts';
import { cleanText } from './util.ts';
import { checkChannelSubs } from './bot.ts';

/**
 * Программа Fracs Parser: ключ лицензии, проверка подписки и выдача файлов только платным пользователям.
 * Файлы лежат в приватном GitHub Release (собираются workflow build-app.yml) либо по прямым ссылкам из env.
 */
export const appRouter = Router();

const env = process.env;
const REPO = env.APP_RELEASE_REPO || ''; // owner/repo
const TOKEN = env.APP_RELEASE_TOKEN || ''; // fine-grained token с доступом Contents: read

export const PLATFORMS = [
  { id: 'windows', label: 'Windows 10 / 11', match: 'windows', envUrl: 'APP_URL_WINDOWS' },
  { id: 'macos-arm', label: 'macOS (Apple Silicon: M1–M4)', match: 'macos-arm64', envUrl: 'APP_URL_MACOS_ARM' },
  { id: 'macos-intel', label: 'macOS (Intel)', match: 'macos-x64', envUrl: 'APP_URL_MACOS_INTEL' },
  { id: 'linux', label: 'Linux (x64)', match: 'linux', envUrl: 'APP_URL_LINUX' },
] as const;

const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/* ── ключ лицензии: подписанный id пользователя (без хранения в базе) ── */

// Ключ лицензии подписывается отдельным секретом (LICENSE_SECRET), если он задан,
// чтобы утечка sessionSecret не позволяла подделывать лицензии, и наоборот.
const mac = (uid: string) => crypto.createHmac('sha256', process.env.LICENSE_SECRET || config.sessionSecret).update('fracs-app-license:' + uid).digest('base64url').slice(0, 24);

export const licenseKey = (uid: string) => `fracs.${Buffer.from(uid).toString('base64url')}.${mac(uid)}`;

function parseKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const [prefix, enc, sig] = key.trim().split('.');
  if (prefix !== 'fracs' || !enc || !sig) return null;
  const uid = Buffer.from(enc, 'base64url').toString();
  const expected = mac(uid);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? uid : null;
}

/* ── релиз с файлами ── */

interface Asset { id: number; name: string; url: string }
let cache: { at: number; tag: string; assets: Asset[] } | null = null;

async function release(): Promise<{ tag: string; assets: Asset[] } | null> {
  if (!REPO || !TOKEN) return null;
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  cache = { at: Date.now(), tag: String(j.tag_name || ''), assets: (j.assets || []).map((a: any) => ({ id: a.id, name: String(a.name), url: String(a.url) })) };
  return cache;
}

const assetFor = (rel: { assets: Asset[] } | null, match: string) => rel?.assets.find((a) => a.name.toLowerCase().includes(match));

const needSub = (res: Response) => res.status(402).json({ error: 'subscription_required', message: 'Программа доступна по подписке.' });

appRouter.get('/info', requireAuth, h(async (req, res) => {
  const u = req.user!;
  if (!isSubscribed(u)) return void needSub(res);
  const rel = await release().catch(() => null);
  res.json({
    key: licenseKey(u.id),
    until: u.subscriptionUntil,
    version: rel?.tag ?? null,
    platforms: PLATFORMS.map((p) => ({ id: p.id, label: p.label, available: Boolean(env[p.envUrl] || assetFor(rel, p.match)) })),
  });
}));

appRouter.get('/download/:platform', requireAuth, h(async (req, res) => {
  const u = req.user!;
  if (!isSubscribed(u)) return void needSub(res);
  const p = PLATFORMS.find((x) => x.id === req.params.platform);
  if (!p) return void res.status(404).json({ error: 'not_found' });

  const direct = env[p.envUrl];
  if (direct) return void res.redirect(302, direct);

  const asset = assetFor(await release().catch(() => null), p.match);
  if (!asset) return void res.status(404).json({ error: 'not_built', message: 'Сборка для этой системы ещё не опубликована.' });
  // Приватный ассет: GitHub отвечает редиректом на подписанную ссылку, действующую несколько минут.
  const r = await fetch(asset.url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/octet-stream' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const loc = r.headers.get('location');
  if (!loc) return void res.status(502).json({ error: 'download_failed', message: 'Не удалось получить файл. Попробуйте позже.' });
  res.redirect(302, loc);
}));

/** Вызывается самой программой: активна ли подписка у владельца ключа. */
appRouter.post('/verify', h(async (req, res) => {
  // failClosed=true: при сбое Supabase не пропускаем перебор ключей лицензии.
  if (!(await rateLimit(`app-verify:${req.ip}`, 60, 10 * 60_000, true))) return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  const uid = parseKey(req.body?.key);
  if (!uid) return void res.json({ ok: false, reason: 'invalid' });
  const user = await getUser(uid);
  if (!user) return void res.json({ ok: false, reason: 'invalid' });
  if (!isSubscribed(user)) return void res.json({ ok: false, reason: 'expired' });
  if (!(await checkChannelSubs(user.tgId))) return void res.json({ ok: false, reason: 'channels_required' });
  res.json({ ok: true, until: user.subscriptionUntil, name: user.firstName, features: await getActiveFeatures(user) });
}));

/** Раздел «Обучение» для программы: ключ лицензии вместо cookie, только для тарифа с features.training. */
appRouter.post('/training', h(async (req, res) => {
  if (!(await rateLimit(`app-training-ip:${req.ip}`, 60, 10 * 60_000))) {
    return void res.status(429).json({ ok: false, error: 'Слишком часто. Подождите.' });
  }
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, error: 'Неверный ключ лицензии' });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, error: 'Подписка закончилась' });
  if (!(await checkChannelSubs(user.tgId))) return void res.status(403).json({ ok: false, error: 'channels_required', message: 'Подпишитесь на обязательные каналы в боте Fracs.' });
  const features = await getActiveFeatures(user);
  if (!features.includes('training')) {
    return void res.status(402).json({ ok: false, error: 'training_required', message: 'Раздел «Обучение» доступен на тарифе PRO.' });
  }
  res.json({ ok: true, lessons: await getTraining() });
}));

/** Парсер карт может запускаться подписчиком не чаще одного раза за 6 часов. */
appRouter.post('/parse-start', h(async (req, res) => {
  if (!(await rateLimit(`app-parse-ip:${req.ip}`, 60, 10 * 60_000))) {
    return void res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком часто. Подождите.' });
  }
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, error: 'invalid', message: 'Неверный ключ лицензии.' });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, error: 'expired', message: 'Подписка закончилась.' });
  if (!(await checkChannelSubs(user.tgId))) return void res.status(403).json({ ok: false, error: 'channels_required', message: 'Подпишитесь на обязательные каналы в боте Fracs.' });
  // Лимит «раз в 6 часов» не действует для админа (ADMIN_TG_ID).
  if (user.tgId !== config.adminTgId && !(await rateLimit(`maps-cooldown:${user.id}`, 1, 6 * 60 * 60_000))) {
    return void res.status(429).json({
      ok: false,
      error: 'cooldown',
      message: 'Следующий парсинг будет доступен через 6 часов после предыдущего запуска.',
    });
  }
  res.json({ ok: true });
}));

/** Telegram-поиск для программы: ключ лицензии вместо cookie. */
appRouter.post('/tg-search', h(async (req, res) => {
  if (!(await rateLimit(`app-tg-ip:${req.ip}`, 60, 10 * 60_000))) return void res.status(429).json({ ok: false, error: 'Слишком часто. Подождите.' });
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, reason: 'invalid', error: 'Неверный ключ лицензии' });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, reason: 'expired', error: 'Подписка закончилась' });
  if (!(await checkChannelSubs(user.tgId))) return void res.status(403).json({ ok: false, error: 'channels_required', message: 'Подпишитесь на обязательные каналы в боте Fracs.' });
  if (!(await rateLimit(`app-tg-user:${user.id}`, 20, 10 * 60_000))) return void res.status(429).json({ ok: false, error: 'Лимит: 20 поисков за 10 минут' });

  const phrase = cleanText(req.body?.phrase, 120);
  const days = Math.min(3, Math.max(1, Math.round(Number(req.body?.days) || 3)));
  if (phrase.length < 3) return void res.status(400).json({ ok: false, error: 'Опишите, что ищут: например, «нужен сайт»' });
  try {
    const r = await searchTg(phrase, days, true);
    res.json({ ok: true, rows: r.rows ?? [], stats: r.stats });
  } catch (e: any) {
    console.error('[app tg-search]', e);
    res.status(502).json({ ok: false, error: e?.message || 'Ошибка источника' });
  }
}));


// ═════════════════════════════════════════════════════════════════════════════
// Fracs AI: прокси к OpenRouter (apply_fixes.py, обновление 9).
// Ключ OpenRouter хранится ТОЛЬКО на сервере (config.openrouterApiKey); программа
// шлёт чат на /api/app/ai с лицензионным ключом в Authorization. Доступ — фича
// 'fracs_ai' тарифа Ultra. Модели — GET /api/app/ai/models (кэш 10 минут).
// ═════════════════════════════════════════════════════════════════════════════
const OR_MODELS_TTL = 10 * 60_000;
let orModelsCache: { at: number; list: any[] } = { at: 0, list: [] };

function orAuthKey(req: any): string {
  // Ключ лицензии программы: Authorization: Bearer <license_key>
  const h = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (h) return h;
  // Фолбэк: { key: ... } в теле (единый стиль остальных /api/app эндпоинтов).
  const k = req.body?.key;
  return typeof k === 'string' ? k.trim() : '';
}

async function fracsAiGate(req: any): Promise<{ user: any } | { error: [number, any] }> {
  const uid = orAuthKey(req);
  if (!uid || uid.length > 128) return { error: [401, { ok: false, reason: 'invalid' }] };
  const user = await getUser(uid);
  if (!user) return { error: [401, { ok: false, reason: 'invalid' }] };
  if (!isSubscribed(user)) return { error: [402, { ok: false, reason: 'expired' }] };
  if (!(await checkChannelSubs(user.tgId))) return { error: [403, { ok: false, reason: 'channels_required' }] };
  const features = await getActiveFeatures(user);
  if (!features.includes('fracs_ai') && !features.includes('ai')) {
    return { error: [402, { ok: false, error: 'fracs_ai_required', message: 'Fracs AI доступен на тарифе Ultra. Оформите Ultra в кабинете.' }] };
  }
  return { user };
}

appRouter.post('/ai', h(async (req, res) => {
  if (!(await rateLimit(`app-ai:${req.ip}`, 240, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI не настроен на сервере (нет OPENROUTER_API_KEY).' });
  }
  const body = req.body?.body ?? req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !String(body.model || '')) {
    return void res.status(400).json({ ok: false, error: 'bad_request', message: 'Ожидается тело chat/completions.' });
  }
  delete (body as any).key; // лицензионный ключ не уходит в OpenRouter
  try {
    const upstream = await fetch(config.openrouterUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouterApiKey}` },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream', message: 'OpenRouter недоступен: ' + String(e?.message || e) });
  }
}));

appRouter.get('/ai/models', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-models:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (orModelsCache.list.length && Date.now() - orModelsCache.at < OR_MODELS_TTL) {
    return void res.json(orModelsCache.list);
  }
  try {
    const upstream = await fetch(config.openrouterUrl + '/models', {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
    });
    if (!upstream.ok) return void res.status(502).json({ ok: false, error: 'upstream' });
    const data = await upstream.json();
    orModelsCache = { at: Date.now(), list: data };
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream' });
  }
}));
