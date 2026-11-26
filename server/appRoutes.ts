import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config, loadTokenPacks } from './config.ts';
import { getUser, getActiveFeatures, getTraining, isSubscribed, rateLimit, aiUsageToday, aiUsageAdd, aiTokensGet, aiTokensSpend, demoCreate, demoGet, demoCounts } from './db.ts';
import { requireAuth } from './auth.ts';
import { searchTg } from './providers.ts';
import { cleanText } from './util.ts';
import { checkChannelSubs } from './bot.ts';
import { DESIGN_VERSION, DESIGN_LIBRARIES, FRACS_DESIGN_SYSTEM } from './aiDesign.ts';

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
  // Программа шлёт ключ лицензии «fracs.<id>.<подпись>», а не голый UUID: проверяем подпись.
  const raw = orAuthKey(req);
  const uid = raw.length <= 256 ? parseKey(raw) : null;
  if (!uid) return { error: [401, { ok: false, reason: 'invalid' }] };
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

// ── Лимиты Fracs AI (ключ OpenRouter — ваш, поэтому всё считаем на сервере) ──────────────
// Клиентским лимитам верить нельзя: программа работает на чужом ПК. Свой API-ключ
// пользователя сюда вообще не попадает — он ходит напрямую к провайдеру и без лимитов.
// Все пороги меняются переменными окружения (значения по умолчанию — ниже).
const envNum = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const AI_LIMITS = {
  perMinute: envNum('AI_USER_PER_MIN', 4),          // всплеск: не больше N запросов в минуту
  perHour: envNum('AI_USER_PER_HOUR', 12),          // …в час
  perDay: envNum('AI_USER_PER_DAY', 30),            // …в сутки (генерация + правки + фразы)
  dailyTokens: envNum('AI_DAILY_TOKENS', 150_000),  // включённая дневная квота токенов (~7 генераций сайта)
  userDailyUsd: envNum('AI_USER_DAILY_USD', 1.5),   // потолок расходов на одного пользователя в сутки
  globalDailyUsd: envNum('AI_GLOBAL_DAILY_USD', 40), // аварийный предохранитель: общий бюджет в сутки
  maxTokens: envNum('AI_MAX_TOKENS', 12000),        // потолок ответа модели
  maxInputChars: envNum('AI_MAX_INPUT_CHARS', 40000),
  maxImages: 3,
};
// Маркер дизайн-системы: если программа прислала system с этим маркером — свой не дублируем.
const DESIGN_MARKER = 'DESIGN_SYSTEM_VERSION:';
// Только недорогие модели: иначе можно указать в запросе дорогую модель и сжечь баланс.
const AI_MODELS = new Set((process.env.AI_ALLOWED_MODELS ||
  'openai/gpt-4o-mini,anthropic/claude-3.5-haiku,google/gemini-2.0-flash-001,meta-llama/llama-3.3-70b-instruct,deepseek/deepseek-chat,qwen/qwen-2.5-72b-instruct')
  .split(',').map((s) => s.trim()).filter(Boolean));
// $ за 1M токенов (вход, выход) — ПРИБЛИЗИТЕЛЬНО, нужно только для оценки «до запроса»
// и если OpenRouter не вернул фактическую стоимость. Сверяйте с openrouter.ai/models.
const AI_PRICE: Record<string, [number, number]> = {
  'openai/gpt-4o-mini': [0.15, 0.6], 'anthropic/claude-3.5-haiku': [0.8, 4],
  'google/gemini-2.0-flash-001': [0.1, 0.4], 'meta-llama/llama-3.3-70b-instruct': [0.12, 0.3],
  'deepseek/deepseek-chat': [0.3, 0.9], 'qwen/qwen-2.5-72b-instruct': [0.12, 0.39],
};
const priceOf = (model: string): [number, number] => AI_PRICE[model] || [1, 4];
const aiErr = (status: number, error: string, message: string, extra: object = {}): [number, any] => [status, { ok: false, error, message, ...extra }];

/** Чистим тело запроса: только модель из белого списка, без stream/tools/plugins, потолок токенов. */
function sanitizeAiBody(raw: any): { body: any; inChars: number } | { err: [number, any] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { err: aiErr(400, 'bad_request', 'Ожидается тело chat/completions.') };
  const model = String(raw.model || '');
  if (!AI_MODELS.has(model)) return { err: aiErr(400, 'model_not_allowed', 'Эта модель недоступна во встроенном Fracs AI. Выберите модель из списка или подключите свой API-ключ.') };
  const msgs = raw.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > 6) return { err: aiErr(400, 'bad_request', 'Некорректный список сообщений.') };
  let chars = 0, images = 0;
  const messages: any[] = [];
  for (const m of msgs) {
    const role = String(m?.role || '');
    if (!['system', 'user', 'assistant'].includes(role)) return { err: aiErr(400, 'bad_request', 'Некорректная роль сообщения.') };
    if (typeof m.content === 'string') {
      chars += m.content.length;
      messages.push({ role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const parts: any[] = [];
      for (const p of m.content) {
        if (p?.type === 'text' && typeof p.text === 'string') { chars += p.text.length; parts.push({ type: 'text', text: p.text }); }
        else if (p?.type === 'image_url' && typeof p.image_url?.url === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(p.image_url.url)) {
          if (++images > AI_LIMITS.maxImages) return { err: aiErr(400, 'too_many_images', `Не больше ${AI_LIMITS.maxImages} картинок в запросе.`) };
          parts.push({ type: 'image_url', image_url: { url: p.image_url.url } });
        } else return { err: aiErr(400, 'bad_request', 'Неподдерживаемый тип содержимого.') };
      }
      messages.push({ role, content: parts });
    } else return { err: aiErr(400, 'bad_request', 'Пустое сообщение.') };
  }
  if (chars > AI_LIMITS.maxInputChars) return { err: aiErr(413, 'input_too_long', `Запрос слишком длинный (лимит ${AI_LIMITS.maxInputChars} символов). Сократите промт или вложения.`) };
  const reqTok = Number(raw.max_tokens);
  const maxTokens = Math.min(AI_LIMITS.maxTokens, Number.isFinite(reqTok) && reqTok > 0 ? Math.floor(reqTok) : AI_LIMITS.maxTokens);
  const temp = Number(raw.temperature);
  return {
    inChars: chars,
    body: { model, messages, max_tokens: maxTokens, temperature: Number.isFinite(temp) ? Math.min(1.2, Math.max(0, temp)) : 0.7, stream: false, usage: { include: true } },
  };
}

appRouter.post('/ai', h(async (req, res) => {
  if (!(await rateLimit(`app-ai:${req.ip}`, 240, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
  }
  const uid = String(gate.user.id);
  const clean = sanitizeAiBody(req.body?.body ?? req.body);
  if ('err' in clean) return void res.status(clean.err[0]).json(clean.err[1]);
  const { body, inChars } = clean;

  // 0) Дизайн-система против «нейрослопа»: подмешиваем её в system сервером, чтобы
  //    любой запрос Fracs AI шёл с актуальным промтом даже на старой версии программы.
  //    Если программа сама прислала system с маркером DESIGN_SYSTEM_VERSION: — не дублируем.
  let designChars = 0;
  const hasDesign = body.messages.some((m: any) => m.role === 'system' && typeof m.content === 'string' && m.content.includes(DESIGN_MARKER));
  if (!hasDesign) {
    const sys = `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}\n` + FRACS_DESIGN_SYSTEM;
    body.messages.unshift({ role: 'system', content: sys });
    designChars = sys.length;
  }
  const totalInChars = inChars + designChars;

  // 1) частота: минута / час / сутки (failClosed — при сбое счётчика не пускаем)
  if (!(await rateLimit(`ai-u-min:${uid}`, AI_LIMITS.perMinute, 60_000, true))) {
    return void res.status(429).json({ ok: false, error: 'quota_minute', message: 'Слишком часто. Подождите минуту и повторите.' });
  }
  if (!(await rateLimit(`ai-u-hr:${uid}`, AI_LIMITS.perHour, 3_600_000, true))) {
    return void res.status(429).json({ ok: false, error: 'quota_hour', message: `Лимит Fracs AI: ${AI_LIMITS.perHour} запросов в час. Продолжите позже или подключите свой API-ключ — без лимитов.` });
  }
  if (!(await rateLimit(`ai-u-day:${uid}`, AI_LIMITS.perDay, 86_400_000, true))) {
    return void res.status(429).json({ ok: false, error: 'quota_day', message: `Лимит Fracs AI на сутки исчерпан (${AI_LIMITS.perDay} запросов). Он обновится завтра. С собственным API-ключом лимитов нет.` });
  }

  // 2) лимит по токенам: включённая дневная квота + купленные пакеты (пакеты не истекают).
  //    Худший случай этого запроса считаем заранее: вход (≈3.5 символа на токен) + потолок ответа.
  const worstTokens = Math.round(totalInChars / 3.5) + body.max_tokens;
  let usage;
  let balance = 0;
  try {
    usage = await aiUsageToday(uid);
    balance = await aiTokensGet(uid);
  } catch (e) {
    console.error('[ai] usage/tokens read failed — запрос отклонён (предохранитель):', e);
    return void res.status(503).json({ ok: false, error: 'budget_unavailable', message: 'Fracs AI временно недоступен. Попробуйте позже или используйте свой API-ключ.' });
  }
  const tokensAllowed = AI_LIMITS.dailyTokens + balance;
  if (usage.userTokens + worstTokens > tokensAllowed) {
    const left = Math.max(0, tokensAllowed - usage.userTokens);
    return void res.status(429).json({
      ok: false,
      error: 'quota_tokens',
      message: `Дневной лимит токенов Fracs AI исчерпан (включено ${AI_LIMITS.dailyTokens.toLocaleString('ru-RU')}/сутки). Купите дополнительные токены в кабинете — они не истекают: ${config.appUrl}/app`,
      tokensLeft: left,
      buyUrl: `${config.appUrl}/app`,
    });
  }

  // 3) бюджет в долларах: по пользователю и общий (предохранители от дорогих моделей).
  const [pin, pout] = priceOf(body.model);
  const worstUsd = (totalInChars / 3.5) * pin / 1e6 + body.max_tokens * pout / 1e6;
  if (usage.totalCostUsd + worstUsd > AI_LIMITS.globalDailyUsd) {
    return void res.status(503).json({ ok: false, error: 'daily_budget', message: 'Общий лимит Fracs AI на сегодня исчерпан — он обновится завтра. Со своим API-ключом можно работать без ограничений.' });
  }
  if (usage.userCostUsd + worstUsd > AI_LIMITS.userDailyUsd) {
    return void res.status(429).json({ ok: false, error: 'quota_budget', message: 'Дневной лимит Fracs AI по объёму генерации исчерпан. Он обновится завтра. Со своим API-ключом лимитов нет.' });
  }

  try {
    const upstream = await fetch(config.openrouterUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouterApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(170_000),
    });
    const text = await upstream.text();
    if (upstream.ok) {
      // фактический расход: cost от OpenRouter, иначе по токенам и таблице цен
      try {
        const u = JSON.parse(text)?.usage || {};
        const tokens = Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0);
        const cost = Number(u.cost) > 0 ? Number(u.cost)
          : ((Number(u.prompt_tokens) || totalInChars / 3.5) * pin + (Number(u.completion_tokens) || body.max_tokens) * pout) / 1e6;
        await aiUsageAdd(uid, tokens, cost);
        // Списание с купленного баланса: только то, что сверх включённой дневной квоты.
        const over = Math.max(0, usage.userTokens + tokens - AI_LIMITS.dailyTokens);
        if (over > 0) await aiTokensSpend(uid, over).catch((e) => console.error('[ai] tokens spend failed:', e));
      } catch (e) { console.error('[ai] usage write failed:', e); }
    }
    res.status(upstream.status).type('application/json').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
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
  // отдаём только разрешённые модели — программа не покажет (и не попросит) дорогие
  const onlyAllowed = (d: any) => ({ ...d, data: (Array.isArray(d?.data) ? d.data : []).filter((m: any) => AI_MODELS.has(String(m?.id))) });
  if (orModelsCache.list.length && Date.now() - orModelsCache.at < OR_MODELS_TTL) {
    return void res.json(onlyAllowed(orModelsCache.list));
  }
  try {
    const upstream = await fetch(config.openrouterUrl + '/models', {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return void res.status(502).json({ ok: false, error: 'upstream' });
    const data = await upstream.json();
    orModelsCache = { at: Date.now(), list: data };
    res.json(onlyAllowed(data));
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream' });
  }
}));

/** Остаток токенов Fracs AI: включённая дневная квота + купленный баланс + пакеты к покупке.
 *  Программа и кабинет показывают это в интерфейсе AI-агента. */
appRouter.get('/ai/usage', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-usage:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  try {
    const [usage, balance] = await Promise.all([aiUsageToday(String(gate.user.id)), aiTokensGet(String(gate.user.id))]);
    const allowed = AI_LIMITS.dailyTokens + balance;
    res.json({
      ok: true,
      dailyIncluded: AI_LIMITS.dailyTokens,
      usedToday: usage.userTokens,
      requestsToday: usage.userRequests,
      balance,
      tokensLeft: Math.max(0, allowed - usage.userTokens),
      packs: loadTokenPacks(),
    });
  } catch (e) {
    console.error('[ai] usage endpoint failed:', e);
    res.status(503).json({ ok: false, error: 'usage_unavailable' });
  }
}));

/** Дизайн-пакет: system-промт против «нейрослопа» + каталог MIT-библиотек.
 *  Программа может забрать его заранее (GET, Authorization: Bearer <license_key>)
 *  и положить в system-сообщение — тогда сервер не будет дублировать промт
 *  (маркер DESIGN_SYSTEM_VERSION: в первой строке). Обновляется без пересборки приложения. */
appRouter.get('/ai/design', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-design:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  res.json({
    ok: true,
    version: DESIGN_VERSION,
    system: `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}\n` + FRACS_DESIGN_SYSTEM,
    libraries: DESIGN_LIBRARIES,
  });
}));


// ═════════════════════════════════════════════════════════════════════════════
// Демо-страницы для QR на открытке: программа публикует сюда review.html (видеообзор
// сайта) и получает короткую ссылку https://<ваш сайт>/v/<id>. Своего хостинга не нужно:
// хранится в вашем Supabase, отдаётся этим же сервером на Vercel.
// ═════════════════════════════════════════════════════════════════════════════
const DEMO_MAX_BYTES = 1_200_000;
const DEMO_PER_DAY = envNum('DEMO_PER_DAY', 20);
const DEMO_MAX_ACTIVE = envNum('DEMO_MAX_ACTIVE', 300);
const DEMO_MARK = 'data-fracs-review="1"';

appRouter.post('/demo', h(async (req, res) => {
  if (!(await rateLimit(`app-demo:${req.ip}`, 60, 3_600_000, true))) {
    return void res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком часто. Повторите позже.' });
  }
  const uid = parseKey(orAuthKey(req));
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, reason: 'invalid' });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, reason: 'expired' });
  const feats = await getActiveFeatures(user);
  if (!feats.some((f) => ['ai', 'ai_provider', 'fracs_ai'].includes(f))) {
    return void res.status(402).json({ ok: false, error: 'plan', message: 'Публикация демо доступна с AI-агентом (PRO / Ultra).' });
  }
  const html = req.body?.html;
  if (typeof html !== 'string' || !html.includes(DEMO_MARK)) return void res.status(400).json({ ok: false, error: 'bad_request', message: 'Ожидается страница видеообзора.' });
  if (Buffer.byteLength(html) > DEMO_MAX_BYTES) {
    return void res.status(413).json({ ok: false, error: 'too_big', message: 'Страница слишком большая (лимит 1,2 МБ) — уберите из сайта тяжёлые встроенные картинки.' });
  }
  const c = await demoCounts(user.id);
  if (c.day >= DEMO_PER_DAY) return void res.status(429).json({ ok: false, error: 'quota_day', message: `Лимит публикаций демо: ${DEMO_PER_DAY} в сутки.` });
  if (c.total >= DEMO_MAX_ACTIVE) return void res.status(429).json({ ok: false, error: 'quota_total', message: 'Слишком много активных демо — старые удаляются через 45 дней.' });
  const id = await demoCreate(user.id, html);
  res.json({ ok: true, id, url: `${config.appUrl}/v/${id}` });
}));

/** GET /v/:id — публичная страница видеообзора (открывается по QR с телефона заказчика). */
export const demoPage: RequestHandler = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[A-Za-z0-9_-]{8,24}$/.test(id)) return void res.status(404).type('text/plain').send('Не найдено');
    if (!(await rateLimit(`demo-view:${req.ip}`, 120, 60_000, false))) return void res.status(429).type('text/plain').send('Слишком часто');
    const html = await demoGet(id);
    if (!html) return void res.status(404).type('text/plain; charset=utf-8').send('Демо не найдено или срок хранения истёк.');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      // sandbox: страница живёт в «чужом» origin — без доступа к cookie/API этого сайта.
      'Content-Security-Policy': 'sandbox allow-scripts allow-popups',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=300',
    }).send(html);
  } catch (e) {
    console.error('[demo]', e);
    res.status(500).type('text/plain').send('Ошибка сервера');
  }
};
