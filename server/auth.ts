import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import {
  createLoginToken,
  getLoginToken,
  getUser,
  takeLoginToken,
  upsertTgUser,
  upsertEmailUser,
  rateLimit,
  type User,
  extendSubscription,
  isSubscribed,
} from './db.ts';
import { getBotUsername, checkChannelSubs } from './bot.ts';
import { randomToken } from './util.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const COOKIE = 'fracs_session';
const SESSION_MS = 30 * 86400_000;

// Разделение назначений ключа: сессия подписывается с префиксом 'session:'.
// Это не даёт переиспользовать подпись сессии как trial-ticket или лицензию
// (те используют свои префиксы и, где нужно, отдельный секрет).
const sign = (p: string) => crypto.createHmac('sha256', config.sessionSecret).update('session:' + p).digest('base64url');

function makeSession(uid: string) {
  const payload = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSession(raw?: string): string | null {
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return e > Date.now() ? u : null;
  } catch {
    return null;
  }
}

function cookies(header = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* битая cookie */ }
  }
  return out;
}

function cookieOpts(req: Request) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https' || config.isProd;
  // SameSite=None нужен только если кабинет встраивается в iframe (AI Studio):
  // включайте явно через COOKIE_SAMESITE=None. Возврат с ЮKassa (/app?paid=1) идёт
  // обычной навигацией, поэтому с Lax cookie доезжает.
  const sameSite = secure && process.env.COOKIE_SAMESITE === 'None' ? 'None' : 'Lax';
  return { secure, sameSite };
}

function setSession(req: Request, res: Response, uid: string) {
  const { secure, sameSite } = cookieOpts(req);
  res.append('Set-Cookie', `${COOKIE}=${makeSession(uid)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const uid = readSession(cookies(req.headers.cookie)[COOKIE]);
    if (uid) req.user = (await getUser(uid)) ?? undefined;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized', message: 'Войдите через Telegram или email' });
    return;
  }
  // Непрерывная проверка подписок на каналы: отписался — любое действие в кабинете блокируется.
  // Админ (ADMIN_TG_ID) проверку проходит всегда.
  // Аккаунт, созданный входом по email-коду (tgId = null), проверить нечем — не блокируем.
  if (req.user.tgId != null && !(await checkChannelSubs(req.user.tgId))) {
    res.status(403).json({ error: 'channels_required', message: 'Подпишитесь на обязательные каналы в боте Fracs, чтобы продолжить.' });
    return;
  }
  next();
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export const authRouter = Router();

authRouter.post('/start', h(async (req, res) => {
  // failClosed=true: при сбое Supabase не пропускаем перебор токенов входа.
  if (!(await rateLimit(`auth:${req.ip}`, 20, 10 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited' });
  const username = await getBotUsername();
  if (!username) return void res.status(503).json({ error: 'bot_not_configured', message: 'Бот не настроен' });
  const token = randomToken(24);
  await createLoginToken(token);
  res.json({ token, url: `https://t.me/${username}?start=${token}` });
}));

authRouter.get('/status', h(async (req, res) => {
  const token = String(req.query.token || '');
  const t = await getLoginToken(token);
  if (!t) return void res.json({ status: 'expired' });
  if (!t.userId) return void res.json({ status: 'pending' });
  const uid = await takeLoginToken(token); // одноразовый
  if (!uid) return void res.json({ status: 'expired' });
  setSession(req, res, uid);
  res.json({ status: 'ok' });
}));

authRouter.post('/dev', h(async (req, res) => {
  if (!config.devLogin) return void res.status(404).json({ error: 'not_found' });
  let user = await upsertTgUser({ id: 1, username: 'dev_user', first_name: 'Разработчик' });
  if (!isSubscribed(user)) {
    user = await extendSubscription(user.id, 30);
  }
  setSession(req, res, user.id);
  res.json({ ok: true });
}));

authRouter.post('/logout', (req, res) => {
  const { secure, sameSite } = cookieOpts(req);
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

/* ── Вход по email-коду (OTP) через Supabase Auth ───────────────────────────
 *
 * Как работает:
 *  1. POST /auth/email/start { email } → Supabase Auth отправляет на почту
 *     одноразовый 6-значный код (встроенный email-провайдер Supabase, на
 *     бесплатном тарифе доступен «из коробки»; лимит писем в час — см. доки).
 *  2. POST /auth/email/verify { email, code } → проверяем код в Supabase,
 *     находим/создаём пользователя в таблице users (tg_id = NULL) и выдаём
 *     обычную сессию Fracs (та же cookie, что у входа через Telegram).
 *
 * Настоящий «источник истины» кода — Supabase: мы его не храним и не
 * проверяем сами. Настоятельно рекомендуется включить в Supabase
 * «Secure email change» и кастомный SMTP (Any SMTP, бесплатно) — встроенный
 * провайдер жёстко ограничивает частоту писем (email rate limit).
 */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RE = /^\d{6,8}$/; // Supabase шлёт 6- или 8-значный OTP в зависимости от настроек проекта
const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

/** true, если Supabase настроен (без него email-вход недоступен). */
const emailAuthReady = () => Boolean(config.supabaseUrl && config.supabaseKey);

function supabaseAuthHeaders() {
  return {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    'Content-Type': 'application/json',
  };
}

/** Просим Supabase отправить одноразовый код на почту. create_user: true — регистрирует нового. */
async function supabaseOtpStart(email: string) {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    // over_email_send_rate_limit — упёрлись в лимит писем Supabase
    const msg = body?.error_description || body?.msg || body?.message || `supabase_${r.status}`;
    throw Object.assign(new Error(msg), { code: r.status === 429 ? 'email_rate_limited' : 'email_start_failed' });
  }
}

/** Проверяем код у Supabase. Возвращает true, если код верный и не истёк. */
async function supabaseOtpVerify(email: string, code: string): Promise<boolean> {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({ type: 'email', email, token: code }),
  });
  return r.ok; // 200 — код принят (Supabase сам погасит одноразовый токен)
}

authRouter.post('/email/start', h(async (req, res) => {
  if (!emailAuthReady()) return void res.status(503).json({ error: 'email_auth_unavailable', message: 'Email-вход не настроен' });

  const email = normalizeEmail(String(req.body?.email || ''));
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'bad_email', message: 'Введите корректный адрес эл. почты' });

  // Антиспам: на IP — скромно, на адрес — ещё скромнее (письмо стоит денег репутации домена).
  if (!(await rateLimit(`auth-email-ip:${req.ip}`, 10, 10 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited' });
  if (!(await rateLimit(`auth-email-addr:${email}`, 4, 30 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited', message: 'Слишком часто. Подождите немного — код уже летит.' });

  try {
    await supabaseOtpStart(email);
  } catch (e: any) {
    if (e?.code === 'email_rate_limited') return void res.status(429).json({ error: 'rate_limited', message: 'Письмо уже отправлено. Подождите минуту перед повторной отправкой.' });
    console.warn('[auth] email/start supabase:', e?.message);
    return void res.status(502).json({ error: 'email_start_failed', message: 'Не удалось отправить код. Попробуйте позже.' });
  }
  res.json({ ok: true, email });
}));

authRouter.post('/email/verify', h(async (req, res) => {
  if (!emailAuthReady()) return void res.status(503).json({ error: 'email_auth_unavailable', message: 'Email-вход не настроен' });

  const email = normalizeEmail(String(req.body?.email || ''));
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'bad_email', message: 'Введите корректный адрес эл. почты' });
  if (!CODE_RE.test(code)) return void res.status(400).json({ error: 'bad_code', message: 'Код — 6–8 цифр из письма' });

  // Перебор кода делаем дорогим: 8 попыток за 10 минут на пару «IP+email».
  if (!(await rateLimit(`auth-email-verify:${req.ip}:${email}`, 8, 10 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited', message: 'Слишком много попыток. Подождите 10 минут.' });

  let ok = false;
  try {
    ok = await supabaseOtpVerify(email, code);
  } catch (e) {
    console.warn('[auth] email/verify supabase:', e);
  }
  if (!ok) return void res.status(400).json({ error: 'bad_code', message: 'Неверный или устаревший код' });

  const user = await upsertEmailUser(email);
  setSession(req, res, user.id);
  res.json({ ok: true });
}));
