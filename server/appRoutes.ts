import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config, loadTokenPacks } from './config.ts';
import { getUser, isAdminTg, getActiveFeatures, getTraining, isSubscribed, rateLimit, consumeBudgetWindow, getBudgetWindow, refundBudgetWindow, aiUsageToday, aiUsageAdd, aiTokensGet, aiTokensSpend, demoCreate, demoGet, demoCounts } from './db.ts';
import { requireAuth } from './auth.ts';
import { searchTg } from './providers.ts';
import { cleanText } from './util.ts';
import { checkChannelSubs } from './bot.ts';
import { notify } from './bot.ts';
import { createPayment, type PaymentMethod } from './payments.ts';
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

interface Asset { id: number; name: string; url: string; browserUrl: string }
let cache: { at: number; tag: string; assets: Asset[] } | null = null;

async function release(): Promise<{ tag: string; assets: Asset[] } | null> {
  // Токен нужен только для приватного репо; публичный (например w1t3chlyyy/frccd) читается анонимно.
  if (!REPO) return null;
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j: any = await r.json();
  cache = { at: Date.now(), tag: String(j.tag_name || ''), assets: (j.assets || []).map((a: any) => ({ id: a.id, name: String(a.name), url: String(a.url), browserUrl: String(a.browser_download_url || '') })) };
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
  // Публичный репо (без токена): редирект на постоянную browser_download_url — отдаётся с CDN GitHub и не истекает.
  if (!TOKEN && asset.browserUrl) return void res.redirect(302, asset.browserUrl);
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
  perMinute: envNum('AI_USER_PER_MIN', 40),             // всплеск: не больше N запросов в минуту
  perHour: envNum('AI_USER_PER_HOUR', 300),             // …в час (щедро для чата и генератора фраз)
  dailyComplexity: envNum('AI_DAILY_COMPLEXITY', 250),  // бюджет сложности сайтов/чата на окно
  dailyPhrases: envNum('AI_DAILY_PHRASES', 500),        // отдельный щедрый лимит для генерации фраз Telegram
  perDayWindowMs: envNum('AI_USER_DAY_WINDOW_MS', 10 * 3_600_000), // окно сброса — 10 часов
  dailyTokens: envNum('AI_DAILY_TOKENS', 2_500_000),    // увеличенная включённая дневная квота токенов
  userDailyUsd: envNum('AI_USER_DAILY_USD', 20),        // потолок расходов на бесплатной дневной квоте
  globalDailyUsd: envNum('AI_GLOBAL_DAILY_USD', 250),   // аварийный предохранитель: общий бюджет в сутки
  maxTokens: envNum('AI_MAX_TOKENS', 12000),            // потолок ответа модели
  maxInputChars: envNum('AI_MAX_INPUT_CHARS', 100000),  // правка макета шлёт страницу целиком + дизайн-промт + бриф
  maxImages: 3,
};
// Маркер дизайн-системы: если программа прислала system с этим маркером — свой не дублируем.
const DESIGN_MARKER = 'DESIGN_SYSTEM_VERSION:';
// Публичные псевдонимы Fracs AI → внутренние модели (чтобы клиент не знал и не показывал базовые модели).
const isOllamaActive = (): boolean => (
  config.fracsAiBackend === 'ollama'
    ? Boolean(config.ollamaApiKey)
    : config.fracsAiBackend === 'openrouter'
      ? false
      : Boolean(config.ollamaApiKey)
);
const hasAnyAiKey = (): boolean => Boolean(config.ollamaApiKey || config.openrouterApiKey || config.cohereApiKey);

const COHERE_MODEL = 'command-a-03-2025';
const FRACS_BUILD_MODEL = (process.env.FRACS_AI_BUILD_MODEL || (isOllamaActive() ? 'kimi-k2.7-code' : 'anthropic/claude-sonnet-4')).trim();
const FRACS_FAST_MODEL = (process.env.FRACS_AI_FAST_MODEL || (isOllamaActive() ? 'deepseek-v4.1-flash:1017' : 'deepseek/deepseek-chat')).trim();
const FRACS_EDIT_MODEL = (config.cohereApiKey || (config.openrouterApiKey && !isOllamaActive()))
  ? COHERE_MODEL
  : FRACS_FAST_MODEL;
const FRACS_MODEL_ALIASES: Record<string, string> = {
  'fracs-ai': FRACS_BUILD_MODEL,
  'fracs-ai-build': FRACS_BUILD_MODEL,
  'fracs-ai-pro': FRACS_BUILD_MODEL,
  auto: FRACS_BUILD_MODEL,
  'fracs-ai-fast': FRACS_FAST_MODEL,
  'fracs-ai-chat': FRACS_FAST_MODEL,
  'fracs-ai-edit': FRACS_EDIT_MODEL,
  'fracs-ai-copy': FRACS_EDIT_MODEL,
};
// Белый список моделей Fracs AI (оставлен и для обратной совместимости со старыми версиями программы).
// Расширять через env AI_ALLOWED_MODELS.
const AI_MODELS = new Set((process.env.AI_ALLOWED_MODELS ||
  'anthropic/claude-sonnet-4,anthropic/claude-3.5-sonnet,google/gemini-2.5-flash,kimi-k2.7-code,deepseek-v4-pro:0813,deepseek-v4.1-flash:1017,deepseek-v4.1-flash,glm-5.3,glm-5.3-flash,gemma4:31b,kimi-k3.1-pro,mistral-large-4,minimax-m3.1-flash,anthropic/claude-sonnet-5.5,openai/gpt-5.6-terra-pro,deepseek/deepseek-v4-pro-0813,deepseek/deepseek-v4.1-flash-1017,openai/gpt-4o-mini,anthropic/claude-3.5-haiku,google/gemini-2.0-flash-001,meta-llama/llama-3.3-70b-instruct,deepseek/deepseek-chat,qwen/qwen-2.5-72b-instruct,command-a-03-2025')
  .split(',').map((s) => s.trim()).filter(Boolean));
// $ за 1M токенов (вход, выход) — ПРИБЛИЗИТЕЛЬНО, нужно только для оценки «до запроса»
// и если провайдер не вернул фактическую стоимость.
const AI_PRICE: Record<string, [number, number]> = {
  // Ollama Cloud (для внутреннего учёта квот)
  'kimi-k2.7-code': [0.3, 1.2], 'deepseek-v4-pro:0813': [0.15, 0.8],
  'deepseek-v4.1-flash:1017': [0.1, 0.4], 'deepseek-v4.1-flash': [0.1, 0.4],
  'glm-5.3': [0.2, 0.8], 'glm-5.3-flash': [0.1, 0.4],
  'gemma4:31b': [0.1, 0.3], 'kimi-k3.1-pro': [0.3, 1.2],
  'mistral-large-4': [0.3, 1.2], 'minimax-m3.1-flash': [0.1, 0.4],
  // премиум-кодинг (генерация сайтов, OpenRouter)
  'anthropic/claude-sonnet-4': [3, 15], 'anthropic/claude-3.5-sonnet': [3, 15],
  'google/gemini-2.5-flash': [0.15, 0.6],
  'anthropic/claude-sonnet-5.5': [2, 10], 'openai/gpt-5.6-terra-pro': [2, 12],
  'deepseek/deepseek-v4-pro-0813': [0.1, 5], 'deepseek/deepseek-v4.1-flash-1017': [0.15, 0.6],
  // бюджетные (чат/фразы)
  'openai/gpt-4o-mini': [0.15, 0.6], 'anthropic/claude-3.5-haiku': [0.8, 4],
  'google/gemini-2.0-flash-001': [0.1, 0.4], 'meta-llama/llama-3.3-70b-instruct': [0.12, 0.3],
  'deepseek/deepseek-chat': [0.3, 0.9], 'qwen/qwen-2.5-72b-instruct': [0.12, 0.39],
  // Cohere Command A: $2.5 / $10 за 1M токенов, контекст 256K, но не больше 8000 токенов ответа
  'command-a-03-2025': [2.5, 10],
};

// ── Cohere работает ВМЕСТЕ с OpenRouter / Ollama ─────────────────────────────
// Command A пишет тексты/арт-дирекшн и вычитывает готовый сайт (задачи copy / critique),
// вёрстку собирает основная модель. Прямой ключ Cohere — приоритет.
const COHERE_VIA_OR = 'cohere/command-a';
const COHERE_MAX_OUT = 8000;
const MODELS_NO_TEMP = new Set([
  'anthropic/claude-sonnet-5.5',
  'openai/gpt-5.6-terra-pro',
]);
const MODELS_LOW_REASONING = new Set([
  'anthropic/claude-sonnet-4',
  'anthropic/claude-sonnet-5.5',
  'openai/gpt-5.6-terra-pro',
]);
type Upstream = { url: string; key: string; body: any; via: 'cohere' | 'openrouter' | 'ollama'; model: string };

function prepareUpstreamBody(baseBody: any, targetModel: string, stripExtra = false): any {
  const out: any = { ...baseBody, model: targetModel };
  if (MODELS_NO_TEMP.has(targetModel) || stripExtra) {
    delete out.temperature;
  }
  if (!stripExtra && MODELS_LOW_REASONING.has(targetModel) && !out.reasoning) {
    out.reasoning = { effort: 'low' };
  } else if (stripExtra) {
    delete out.reasoning;
    delete out.usage;
  }
  return out;
}

function buildFallbackModels(primaryModel: string, imageCount: number): string[] {
  const list: string[] = [primaryModel];
  if (isOllamaActive()) {
    if (primaryModel === COHERE_MODEL) {
      list.push(FRACS_FAST_MODEL, 'glm-5.3-flash');
    } else if (primaryModel === FRACS_BUILD_MODEL) {
      list.push(...(imageCount > 0
        ? ['deepseek-v4.1-flash:1017', 'glm-5.3-flash', 'mistral-large-4']
        : ['deepseek-v4-pro:0813', 'deepseek-v4.1-flash:1017', 'glm-5.3']));
    } else if (primaryModel === FRACS_FAST_MODEL) {
      list.push('glm-5.3-flash', 'gemma4:31b', 'minimax-m3.1-flash');
    }
  }
  if (config.openrouterApiKey) {
    if (primaryModel === COHERE_MODEL) {
      list.push('deepseek/deepseek-chat', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini');
    } else if (primaryModel === FRACS_FAST_MODEL || primaryModel === 'deepseek/deepseek-chat') {
      list.push('deepseek/deepseek-chat', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku');
    } else {
      list.push(...(imageCount > 0
        ? ['anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini']
        : ['anthropic/claude-sonnet-4', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini']));
    }
  }
  return Array.from(new Set(list));
}

function hasNonEmptyCompletion(parsed: any): boolean {
  const ch = parsed?.choices?.[0];
  if (!ch) return false;
  const c = ch?.message?.content;
  if (typeof c === 'string') return c.trim().length > 0;
  if (Array.isArray(c)) {
    return c.some((b: any) => b?.type === 'text' && typeof b?.text === 'string' && b.text.trim().length > 0);
  }
  return typeof ch?.text === 'string' && ch.text.trim().length > 0;
}

function resolveUpstream(body: any, forceOpenRouter = false, overrideModel?: string, stripExtra = false): Upstream | null {
  const target = overrideModel || body.model;
  if (target === COHERE_MODEL) {
    if (config.cohereApiKey && !forceOpenRouter) {
      const direct = prepareUpstreamBody(body, COHERE_MODEL, stripExtra);
      delete direct.usage; // usage:{include} — расширение OpenRouter, Cohere его не знает
      direct.max_tokens = Math.min(Number(direct.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.cohereUrl + '/chat/completions', key: config.cohereApiKey, body: direct, via: 'cohere', model: COHERE_MODEL };
    }
    if (config.openrouterApiKey) {
      const orBody = prepareUpstreamBody(body, COHERE_VIA_OR, stripExtra);
      orBody.max_tokens = Math.min(Number(orBody.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.openrouterUrl + '/chat/completions', key: config.openrouterApiKey, body: orBody, via: 'openrouter', model: COHERE_VIA_OR };
    }
    if (config.ollamaApiKey) {
      const olModel = isOllamaActive() ? FRACS_FAST_MODEL : 'deepseek-v4.1-flash:1017';
      const olBody = prepareUpstreamBody(body, olModel, stripExtra);
      delete olBody.usage;
      olBody.max_tokens = Math.min(Number(olBody.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.ollamaUrl + '/chat/completions', key: config.ollamaApiKey, body: olBody, via: 'ollama', model: olModel };
    }
    return null;
  }
  const preferOllama = isOllamaActive() || (!config.openrouterApiKey && Boolean(config.ollamaApiKey));
  if (preferOllama && config.ollamaApiKey && !target.includes('/')) {
    const olBody = prepareUpstreamBody(body, target, stripExtra);
    delete olBody.usage; // usage:{include} — расширение OpenRouter
    return { url: config.ollamaUrl + '/chat/completions', key: config.ollamaApiKey, body: olBody, via: 'ollama', model: target };
  }
  if (config.openrouterApiKey) {
    const orBody = prepareUpstreamBody(body, target, stripExtra);
    return { url: config.openrouterUrl + '/chat/completions', key: config.openrouterApiKey, body: orBody, via: 'openrouter', model: target };
  }
  if (config.ollamaApiKey) {
    const fallbackOllamaModel = target.includes('/') ? 'kimi-k2.7-code' : target;
    const olBody = prepareUpstreamBody(body, fallbackOllamaModel, stripExtra);
    delete olBody.usage;
    return { url: config.ollamaUrl + '/chat/completions', key: config.ollamaApiKey, body: olBody, via: 'ollama', model: fallbackOllamaModel };
  }
  return null;
}
const FRACS_TASKS = new Set(['copy', 'critique', 'build']);
const priceOf = (model: string): [number, number] => AI_PRICE[model] || [1, 4];
const aiErr = (status: number, error: string, message: string, extra: object = {}): [number, any] => [status, { ok: false, error, message, ...extra }];

interface AiComplexity {
  points: number;
  tier: 'phrase' | 'light' | 'medium' | 'heavy';
  label: string;
  reserveOutputTokens: number;
}

function detectSiteBuild(messages: any[], maxTokens: number, imageCount: number): boolean {
  if (imageCount > 0 || maxTokens > 2200) return true;
  for (const m of messages) {
    const txt = typeof m?.content === 'string'
      ? m.content
      : Array.isArray(m?.content) ? m.content.map((p: any) => p?.text || '').join('\n') : '';
    if (/DESIGN_SYSTEM_VERSION:|СТИЛЕВОЙ РЕЦЕПТ|СТИЛЕВОЕ НАПРАВЛЕНИЕ|ТИПОГРАФИКА|текущая-версия-сайта\.html|<!DOCTYPE|<html/i.test(txt)) {
      return true;
    }
  }
  return false;
}

function detectPhraseGen(messages: any[], maxTokens: number, inChars: number, isSiteBuild: boolean): boolean {
  if (isSiteBuild || maxTokens > 2000 || inChars > 4000) return false;
  const full = messages.map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
  return /поисковую фразу|парсингу заявок в Telegram|Исходная фраза:/i.test(full);
}

function assessAiComplexity(maxTokens: number, inChars: number, imageCount: number, isSiteBuild: boolean, isPhraseGen: boolean): AiComplexity {
  if (isPhraseGen && imageCount === 0) {
    return {
      points: 0,
      tier: 'phrase',
      label: 'Генерация фраз',
      reserveOutputTokens: Math.min(maxTokens, 1200),
    };
  }
  if (!isSiteBuild && imageCount === 0 && inChars < 5500 && maxTokens <= 2200) {
    return {
      points: 1,
      tier: 'light',
      label: 'Лёгкая',
      reserveOutputTokens: Math.min(maxTokens, 1600),
    };
  }
  if ((inChars < 4500 && maxTokens <= 5000 && imageCount === 0) || (!isSiteBuild && imageCount === 0)) {
    return {
      points: 2,
      tier: 'medium',
      label: 'Средняя',
      reserveOutputTokens: Math.min(maxTokens, 5500),
    };
  }
  const extraSize = inChars > 14000 ? 1 : 0;
  return {
    points: Math.min(10, 4 + imageCount * 2 + extraSize),
    tier: 'heavy',
    label: 'Сложная',
    reserveOutputTokens: maxTokens,
  };
}

/** Чистим тело запроса: только модель из белого списка (или псевдоним Fracs AI), без stream/tools/plugins. */
function sanitizeAiBody(raw: any): { body: any; inChars: number; imageCount: number; task: string; rawModel: string } | { err: [number, any] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { err: aiErr(400, 'bad_request', 'Ожидается тело chat/completions.') };
  const rawModel = String(raw.model || '').trim() || 'fracs-ai';
  const model = FRACS_MODEL_ALIASES[rawModel] || rawModel;
  if (!FRACS_MODEL_ALIASES[rawModel] && !AI_MODELS.has(model)) return { err: aiErr(400, 'model_not_allowed', 'Эта модель недоступна во встроенном Fracs AI. Используйте встроенный режим Fracs AI или подключите свой API-ключ.') };
  const msgs = raw.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > 12) return { err: aiErr(400, 'bad_request', 'Некорректный список сообщений.') };
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
  if (model === COHERE_MODEL && images > 0) return { err: aiErr(400, 'no_vision', 'Эта модель работает только с текстом.') };
  if (chars > AI_LIMITS.maxInputChars) return { err: aiErr(413, 'input_too_long', `Запрос слишком длинный (лимит ${AI_LIMITS.maxInputChars} символов). Сократите промт или вложения.`) };
  const reqTok = Number(raw.max_tokens);
  const capTokens = model === COHERE_MODEL ? Math.min(AI_LIMITS.maxTokens, COHERE_MAX_OUT) : AI_LIMITS.maxTokens;
  const maxTokens = Math.min(capTokens, Number.isFinite(reqTok) && reqTok > 0 ? Math.floor(reqTok) : capTokens);
  const temp = Number(raw.temperature);
  const outBody: any = { model, messages, max_tokens: maxTokens, stream: false, usage: { include: true } };
  if (!MODELS_NO_TEMP.has(model)) {
    outBody.temperature = Number.isFinite(temp) ? Math.min(model === COHERE_MODEL ? 1 : 1.2, Math.max(0, temp)) : 0.7;
  }
  return {
    inChars: chars,
    imageCount: images,
    body: outBody,
    task: FRACS_TASKS.has(String(raw.fracs_task)) ? String(raw.fracs_task) : '',
    rawModel,
  };
}

appRouter.post('/ai', h(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !(await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  const isAdmin = isAdminTg(gate.user.tgId);
  if (!isAdmin && !(await rateLimit(`app-ai:${req.ip}`, 360, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  if (!hasAnyAiKey()) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
  }
  const uid = String(gate.user.id);
  const clean = sanitizeAiBody(req.body?.body ?? req.body);
  if ('err' in clean) return void res.status(clean.err[0]).json(clean.err[1]);
  const { body, inChars, imageCount } = clean;
  if (!resolveUpstream(body)) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
  }
  // copy/critique — лёгкие текстовые задачи (тексты и вычитка) с потолком 8000 токенов и без картинок.
  const cheapTask = (clean.task === 'copy' || clean.task === 'critique')
    && imageCount === 0
    && body.max_tokens <= COHERE_MAX_OUT
    && (body.model === COHERE_MODEL || clean.rawModel === 'fracs-ai-edit' || clean.rawModel === 'fracs-ai-copy');
  const isSiteBuild = cheapTask ? false : detectSiteBuild(body.messages, body.max_tokens, imageCount);
  const isPhraseGen = detectPhraseGen(body.messages, body.max_tokens, inChars, isSiteBuild);
  const complexity: AiComplexity = cheapTask
    ? { points: 1, tier: 'light', label: clean.task === 'copy' ? 'Тексты и концепция' : 'Вычитка', reserveOutputTokens: Math.min(body.max_tokens, 4500) }
    : assessAiComplexity(body.max_tokens, inChars, imageCount, isSiteBuild, isPhraseGen);

  // 0) Дизайн-система против «нейрослопа»: подмешиваем только при генерации/правке сайта,
  //    чтобы обычный диалог в чате, тест связи и генератор фраз не тратили лишние токены.
  let designChars = 0;
  const hasDesign = body.messages.some((m: any) => m.role === 'system' && typeof m.content === 'string' && m.content.includes(DESIGN_MARKER));
  if (isSiteBuild && !hasDesign) {
    const sys = `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}\n` + FRACS_DESIGN_SYSTEM;
    body.messages.unshift({ role: 'system', content: sys });
    designChars = sys.length;
  }
  const totalInChars = inChars + designChars;

  // 1) Анти-флуд (минута / час) + лимит по сложности задач за окно (админу ADMIN_TG_ID — безлимит)
  if (!isAdmin) {
    if (!(await rateLimit(`ai-u-min:${uid}`, AI_LIMITS.perMinute, 60_000, true))) {
      return void res.status(429).json({ ok: false, error: 'quota_minute', resetAt: Date.now() + 60_000, message: 'Слишком частые запросы. Подождите минуту и повторите.' });
    }
    if (!(await rateLimit(`ai-u-hr:${uid}`, AI_LIMITS.perHour, 3_600_000, true))) {
      return void res.status(429).json({ ok: false, error: 'quota_hour', resetAt: Date.now() + 3_600_000, message: `Лимит Fracs AI: ${AI_LIMITS.perHour} обращений в час. Продолжите позже или подключите свой API-ключ — без лимитов.` });
    }
  }

  let balance = 0;
  let usage: Awaited<ReturnType<typeof aiUsageToday>> = { userRequests: 0, userCostUsd: 0, userTokens: 0, totalRequests: 0, totalCostUsd: 0, totalTokens: 0 };
  if (isAdmin) {
    [usage, balance] = await Promise.all([aiUsageToday(uid).catch(() => usage), aiTokensGet(uid).catch(() => 0)]);
  } else {
    try {
      [usage, balance] = await Promise.all([aiUsageToday(uid), aiTokensGet(uid)]);
    } catch (e) {
      console.error('[ai] usage/tokens read failed — запрос отклонён (предохранитель):', e);
      return void res.status(503).json({ ok: false, error: 'budget_unavailable', message: 'Fracs AI временно недоступен. Попробуйте позже или используйте свой API-ключ.' });
    }
  }

  const cxKey = isPhraseGen ? `ai-phrase-day:${uid}` : `ai-cx-day:${uid}`;
  const cxCost = isPhraseGen ? 1 : complexity.points;
  const cxLimit = isPhraseGen ? AI_LIMITS.dailyPhrases : AI_LIMITS.dailyComplexity;
  let cxUsed = 0;
  let cxConsumed = false;
  let cxResetAt = 0;
  if (!isAdmin && balance <= 0) {
    const cx = await consumeBudgetWindow(cxKey, cxCost, cxLimit, AI_LIMITS.perDayWindowMs, true);
    cxUsed = cx.used;
    cxResetAt = cx.resetAt || (Date.now() + AI_LIMITS.perDayWindowMs);
    if (!cx.allowed) {
      const hours = Math.max(1, Math.round((cxResetAt - Date.now()) / 3_600_000));
      return void res.status(429).json({
        ok: false,
        error: 'quota_day',
        complexity,
        complexityUsed: cx.used,
        complexityLimit: cxLimit,
        resetAt: cxResetAt,
        message: isPhraseGen
          ? `Дневной лимит генерации фраз Telegram исчерпан (${cx.used}/${cxLimit}). Он обновится через ${hours} ч — или докупите токены прямо в программе.`
          : `Лимит сложности Fracs AI исчерпан (${cx.used}/${cxLimit} ед.; задача «${complexity.label}» требует ${cxCost} ед.). Он обновится через ${hours} ч — или докупите токены прямо в программе.`,
        buyUrl: `${config.appUrl}/app`,
      });
    }
    cxConsumed = true;
  }

  // 2) Лимит по токенам: включённая дневная квота + купленные пакеты (пакеты не истекают).
  const worstTokens = Math.round(totalInChars / 3.5) + complexity.reserveOutputTokens;
  const tokensAllowed = AI_LIMITS.dailyTokens + balance;
  if (!isAdmin && usage.userTokens + worstTokens > tokensAllowed) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    const left = Math.max(0, tokensAllowed - usage.userTokens);
    const nextUtcMidnight = new Date();
    nextUtcMidnight.setUTCHours(24, 0, 0, 0);
    return void res.status(429).json({
      ok: false,
      error: 'quota_tokens',
      resetAt: nextUtcMidnight.getTime(),
      message: `Дневной лимит токенов Fracs AI исчерпан (включено ${AI_LIMITS.dailyTokens.toLocaleString('ru-RU')}/сутки). Докупите токены прямо в программе — они не истекают.`,
      tokensLeft: left,
      buyUrl: `${config.appUrl}/app`,
    });
  }

  // 3) Бюджет в долларах: по пользователю и общий (предохранители от дорогих моделей).
  const [pin, pout] = priceOf(body.model);
  const worstUsd = (totalInChars / 3.5) * pin / 1e6 + complexity.reserveOutputTokens * pout / 1e6;
  if (!isAdmin && usage.totalCostUsd + worstUsd > AI_LIMITS.globalDailyUsd) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    return void res.status(503).json({ ok: false, error: 'daily_budget', message: 'Общий лимит Fracs AI на сегодня исчерпан — он обновится завтра. Со своим API-ключом можно работать без ограничений.' });
  }
  if (!isAdmin && balance <= 0 && usage.userCostUsd + worstUsd > AI_LIMITS.userDailyUsd) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    const nextUtcMidnight = new Date();
    nextUtcMidnight.setUTCHours(24, 0, 0, 0);
    return void res.status(429).json({ ok: false, error: 'quota_budget', resetAt: nextUtcMidnight.getTime(), message: 'Дневной лимит Fracs AI по объёму генерации исчерпан. Он обновится завтра или после покупки пакета токенов.' });
  }

  try {
    const callUpstream = (u: Upstream, timeoutMs: number) => fetch(u.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.key}` },
      body: JSON.stringify(u.body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const candidates = buildFallbackModels(body.model, imageCount);
    const deadline = Date.now() + 160_000;
    let okUpstream: { status: number; parsed: any; model: string } | null = null;
    let lastStatus = 502;

    for (let idx = 0; idx < candidates.length; idx++) {
      const remaining = deadline - Date.now();
      if (remaining <= 3_000) break;
      const candidate = candidates[idx];
      const timeoutMs = Math.min(remaining, idx === 0 ? 70_000 : 45_000);
      const attempts: Upstream[] = [];
      const u1 = resolveUpstream(body, false, candidate, false);
      if (u1) attempts.push(u1);
      if (candidate === COHERE_MODEL && config.cohereApiKey && config.openrouterApiKey) {
        const uOr = resolveUpstream(body, true, candidate, false);
        if (uOr) attempts.push(uOr);
      }

      for (const route of attempts) {
        try {
          let r = await callUpstream(route, timeoutMs);
          let rawText = await r.text();
          // На HTTP 400 пробуем один раз без лишних параметров (temperature / reasoning / usage).
          if (r.status === 400 && (route.body.temperature !== undefined || route.body.reasoning !== undefined || route.body.usage !== undefined)) {
            const stripped = resolveUpstream(body, route.via === 'openrouter' && candidate === COHERE_MODEL, candidate, true);
            if (stripped) {
              r = await callUpstream(stripped, timeoutMs);
              rawText = await r.text();
            }
          }
          // На HTTP 402 (нехватка кредитов под большой max_tokens) пробуем один раз с умеренным потолком.
          if (r.status === 402 && (Number(route.body.max_tokens) || 0) > 4096) {
            const capped = resolveUpstream({ ...body, max_tokens: 4096 }, route.via === 'openrouter' && candidate === COHERE_MODEL, candidate, true);
            if (capped) {
              r = await callUpstream(capped, timeoutMs);
              rawText = await r.text();
            }
          }
          lastStatus = r.status;
          if (r.ok) {
            try {
              const parsed = JSON.parse(rawText);
              if (hasNonEmptyCompletion(parsed)) {
                okUpstream = { status: r.status, parsed, model: candidate };
                break;
              }
              console.error('[ai] upstream empty completion:', candidate, rawText.slice(0, 240));
            } catch (parseErr) {
              console.error('[ai] upstream invalid json:', candidate, parseErr);
            }
          } else {
            console.error('[ai] upstream error:', candidate, route.via, r.status, rawText.slice(0, 300));
          }
        } catch (err: any) {
          console.error('[ai] upstream fetch failed:', candidate, route.via, err?.message || err);
        }
      }
      if (okUpstream) break;
    }

    let safeBody: string;
    let outStatus: number;
    if (okUpstream) {
      outStatus = okUpstream.status;
      const parsed = okUpstream.parsed;
      const [usedIn, usedOut] = priceOf(okUpstream.model);
      // фактический расход: cost от OpenRouter, иначе по токенам и таблице цен фактически сработавшей модели
      try {
        const u = parsed?.usage || {};
        const tokens = Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0);
        const cost = Number(u.cost) > 0 ? Number(u.cost)
          : ((Number(u.prompt_tokens) || totalInChars / 3.5) * usedIn + (Number(u.completion_tokens) || complexity.reserveOutputTokens) * usedOut) / 1e6;
        await aiUsageAdd(uid, tokens, cost);
        if (!isAdmin) {
          // Списание с купленного баланса: только дельта, на которую текущий запрос вышел за дневную квоту.
          const prevOver = Math.max(0, usage.userTokens - AI_LIMITS.dailyTokens);
          const nextOver = Math.max(0, usage.userTokens + tokens - AI_LIMITS.dailyTokens);
          const over = Math.max(0, nextOver - prevOver);
          if (over > 0) await aiTokensSpend(uid, over).catch((e) => console.error('[ai] tokens spend failed:', e));
        }
      } catch (e) { console.error('[ai] usage write failed:', e); }
      // Скрываем имя реальной модели в ответе прокси
      if (parsed && typeof parsed === 'object') {
        parsed.model = 'fracs-ai';
        if ('provider' in parsed) delete parsed.provider;
        if ('system_fingerprint' in parsed) delete parsed.system_fingerprint;
      }
      safeBody = JSON.stringify(parsed);
    } else {
      if (cxConsumed) {
        await refundBudgetWindow(cxKey, cxCost);
      }
      outStatus = lastStatus >= 500 ? lastStatus : 502;
      safeBody = JSON.stringify({ ok: false, error: 'upstream', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
    }
    res.setHeader('X-Fracs-Complexity-Tier', complexity.tier);
    res.setHeader('X-Fracs-Complexity-Cost', String(cxCost));
    if (!isAdmin && balance <= 0 && !isPhraseGen) {
      res.setHeader('X-Fracs-Complexity-Left', String(Math.max(0, cxLimit - cxUsed)));
    }
    if (!isAdmin && cxResetAt > 0) {
      res.setHeader('X-Fracs-Reset-At', String(cxResetAt));
    }
    res.status(outStatus).type('application/json').send(safeBody);
  } catch (e: any) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    console.error('[ai] unexpected route error:', e);
    res.status(502).json({ ok: false, error: 'upstream', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
  }
}));

appRouter.get('/ai/models', h(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !(await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!isAdminTg(gate.user.tgId) && !(await rateLimit(`app-ai-models:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  if (!hasAnyAiKey()) {
    return void res.status(503).json({ ok: false, error: 'not_configured' });
  }
  // Не раскрываем внутренние модели — отдаём единый брендированный профиль Fracs AI.
  res.json({
    data: [
      { id: 'fracs-ai', name: 'Fracs AI', context_length: 256000 },
    ],
  });
}));

/** Остаток токенов Fracs AI: включённая дневная квота + купленный баланс + пакеты к покупке.
 *  Программа и кабинет показывают это в интерфейсе AI-агента. Для ADMIN_TG_ID — безлимит. */
appRouter.get('/ai/usage', h(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !(await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  const isAdmin = isAdminTg(gate.user.tgId);
  if (!isAdmin && !(await rateLimit(`app-ai-usage:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  try {
    const uid = String(gate.user.id);
    const emptyUsage = { userRequests: 0, userCostUsd: 0, userTokens: 0, totalRequests: 0, totalCostUsd: 0, totalTokens: 0 };
    const [usage, balance, cx, px] = await Promise.all([
      isAdmin ? aiUsageToday(uid).catch(() => emptyUsage) : aiUsageToday(uid),
      isAdmin ? aiTokensGet(uid).catch(() => 0) : aiTokensGet(uid),
      getBudgetWindow(`ai-cx-day:${uid}`).catch(() => ({ used: 0, resetAt: 0 })),
      getBudgetWindow(`ai-phrase-day:${uid}`).catch(() => ({ used: 0, resetAt: 0 })),
    ]);
    const allowed = AI_LIMITS.dailyTokens + balance;
    res.json({
      ok: true,
      now: Date.now(),
      unlimited: isAdmin,
      dailyIncluded: isAdmin ? null : AI_LIMITS.dailyTokens,
      usedToday: usage.userTokens,
      requestsToday: usage.userRequests,
      balance,
      tokensLeft: isAdmin ? null : Math.max(0, allowed - usage.userTokens),
      dailyComplexityLimit: isAdmin ? null : AI_LIMITS.dailyComplexity,
      complexityUsed: cx.used,
      complexityLeft: isAdmin ? null : Math.max(0, AI_LIMITS.dailyComplexity - cx.used),
      complexityResetAt: isAdmin ? null : (cx.resetAt || null),
      dailyPhrasesLimit: isAdmin ? null : AI_LIMITS.dailyPhrases,
      phrasesUsed: px.used,
      phrasesLeft: isAdmin ? null : Math.max(0, AI_LIMITS.dailyPhrases - px.used),
      phrasesResetAt: isAdmin ? null : (px.resetAt || null),
      packs: loadTokenPacks(),
      paymentMethods: {
        cryptobot: Boolean(config.cryptobotToken),
        xrocket: Boolean(config.xrocketKey),
        requisites: true,
      },
      supportUsername: config.supportUsername,
    });
  } catch (e) {
    console.error('[ai] usage endpoint failed:', e);
    res.status(503).json({ ok: false, error: 'usage_unavailable' });
  }
}));

/** Покупка дополнительных токенов Fracs AI прямо из программы (по ключу лицензии). */
appRouter.post('/ai/buy', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-buy-ip:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком часто. Подождите немного.' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  const user = gate.user;
  if (!(await rateLimit(`app-ai-buy:${user.id}`, 15, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком много попыток оплаты. Подождите пару минут.' });
  }
  const packId = String(req.body?.packId || '');
  const pack = loadTokenPacks().find((p) => p.id === packId);
  if (!pack) {
    return void res.status(400).json({ ok: false, error: 'bad_pack', message: 'Неизвестный пакет токенов.' });
  }
  const rawMethod = String(req.body?.method || 'cryptobot');
  const supportUser = (config.supportUsername || 'HelpManage').replace(/^@/, '');
  if (rawMethod === 'requisites') {
    const whoLabel = user.tgId != null
      ? `${user.username ? '@' + user.username : user.firstName} (id ${user.tgId})`
      : `${user.email || user.firstName} (почта)`;
    const targetGrant = user.tgId != null ? String(user.tgId) : (user.email || user.id);
    if (config.adminTgId > 0) {
      await notify(
        config.adminTgId,
        `🧾 Заявка на токены Fracs AI из программы (реквизиты)\n${whoLabel}\nПакет: ${pack.title}, ${pack.priceRub} ₽\n\nВыдать: /granttokens ${targetGrant} ${pack.tokens}`,
      ).catch(() => {});
    }
    const text = `Здравствуйте! Хочу докупить токены Fracs AI из программы: ${pack.title} (${pack.priceRub} ₽).`;
    return void res.json({
      ok: true,
      method: 'requisites',
      confirmationUrl: `https://t.me/${supportUser}?text=${encodeURIComponent(text)}`,
    });
  }
  const method: PaymentMethod = rawMethod === 'xrocket' ? 'xrocket' : 'cryptobot';
  try {
    const r = await createPayment(user, pack.id, method);
    res.json({ ok: true, method, paymentId: r.paymentId, confirmationUrl: r.confirmationUrl });
  } catch (e: any) {
    console.error('[app ai buy]', e);
    res.status(e.status || 502).json({
      ok: false,
      error: 'payment',
      message: e.status ? e.message : 'Не удалось создать счёт на оплату. Попробуйте «Реквизиты».',
    });
  }
}));

/** Дизайн-пакет: system-промт против «нейрослопа» + каталог MIT-библиотек.
 *  Программа может забрать его заранее (GET, Authorization: Bearer <license_key>)
 *  и положить в system-сообщение — тогда сервер не будет дублировать промт
 *  (маркер DESIGN_SYSTEM_VERSION: в первой строке). Обновляется без пересборки приложения. */
appRouter.get('/ai/design', h(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !(await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!isAdminTg(gate.user.tgId) && !(await rateLimit(`app-ai-design:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
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
  const rawKey = orAuthKey(req);
  const uid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!uid && !(await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком часто. Повторите позже.' });
  }
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, reason: 'invalid' });
  const isAdmin = isAdminTg(user.tgId);
  if (!isAdmin && !(await rateLimit(`app-demo:${req.ip}`, 60, 3_600_000, true))) {
    return void res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком часто. Повторите позже.' });
  }
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, reason: 'expired' });
  if (!(await checkChannelSubs(user.tgId))) {
    return void res.status(403).json({ ok: false, error: 'channels_required', message: 'Подпишитесь на обязательные каналы в боте Fracs.' });
  }
  const feats = await getActiveFeatures(user);
  if (!feats.some((f) => ['ai', 'ai_provider', 'fracs_ai'].includes(f))) {
    return void res.status(402).json({ ok: false, error: 'plan', message: 'Публикация демо доступна с AI-агентом (PRO / Ultra).' });
  }
  const html = req.body?.html;
  if (typeof html !== 'string' || !html.includes(DEMO_MARK)) return void res.status(400).json({ ok: false, error: 'bad_request', message: 'Ожидается страница видеообзора.' });
  if (Buffer.byteLength(html) > DEMO_MAX_BYTES) {
    return void res.status(413).json({ ok: false, error: 'too_big', message: 'Страница слишком большая (лимит 1,2 МБ) — уберите из сайта тяжёлые встроенные картинки.' });
  }
  if (!isAdmin) {
    const c = await demoCounts(user.id);
    if (c.day >= DEMO_PER_DAY) return void res.status(429).json({ ok: false, error: 'quota_day', message: `Лимит публикаций демо: ${DEMO_PER_DAY} в сутки.` });
    if (c.total >= DEMO_MAX_ACTIVE) return void res.status(429).json({ ok: false, error: 'quota_total', message: 'Слишком много активных демо — старые удаляются через 45 дней.' });
  }
  const id = await demoCreate(user.id, html);
  res.json({ ok: true, id, url: `${config.appUrl}/v/${id}` });
}));

/** GET /v/:id — публичная страница видеообзора (открывается по QR с телефона заказчика). */
export const demoPage: RequestHandler = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[A-Za-z0-9_-]{8,24}$/.test(id)) return void res.status(404).type('text/plain').send('Не найдено');
    if (!(await rateLimit(`demo-view:${req.ip}`, 120, 60_000, false))) return void res.status(429).type('text/plain').send('Слишком часто');
    const rawHtml = await demoGet(id);
    if (!rawHtml) return void res.status(404).type('text/plain; charset=utf-8').send('Демо не найдено или срок хранения истёк.');
    // Лечим ранее сохранённые review.html, где `<!--` экранировался невалидным для JSON `<\!--`
    const html = rawHtml.replace(
      /(<script[^>]+id=["']site-data["'][^>]*>)([\s\S]*?)(<\/script>)/i,
      (_m, open, jsonBody, close) => `${open}${String(jsonBody).replace(/<\\!--/g, '\\u003c!--')}${close}`,
    );
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      // sandbox: страница живёт в «чужом» origin. allow-same-origin нужен самому review.html
      // (его JS читает <script type="application/json"> и грузит srcdoc iframe); сгенерированный
      // сайт при этом остаётся изолированным — у внутреннего iframe выставлен свой sandbox без allow-same-origin.
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=300',
    }).send(html);
  } catch (e) {
    console.error('[demo]', e);
    res.status(500).type('text/plain').send('Ошибка сервера');
  }
};
