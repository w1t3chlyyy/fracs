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
  const sameSite = secure && process.env.COOKIE_SAMESITE !== 'Lax' ? 'None' : 'Lax';
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
  if (!username) {
    return void res.status(503).json({
      error: 'bot_not_configured',
      message: 'Бот не настроен на сервере: проверьте TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME',
    });
  }
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

authRouter.post('/logout', (req, res) => {
  const { secure, sameSite } = cookieOpts(req);
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

/* ── Вход по email-коду (OTP): Resend / Supabase Auth / локальный fallback в dev ── */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RE = /^\d{6,8}$/;
const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

const OTP_TTL_MS = 10 * 60_000;
const localOtps = new Map<string, { hash: string; expiresAt: number; attempts: number }>();

const hashOtp = (email: string, code: string) =>
  crypto.createHmac('sha256', config.sessionSecret).update(`email-otp:${email}:${code}`).digest('hex');

function issueLocalOtp(email: string): string {
  const now = Date.now();
  for (const [k, v] of localOtps) if (v.expiresAt < now) localOtps.delete(k);
  const code = String(crypto.randomInt(100000, 1000000));
  localOtps.set(email, { hash: hashOtp(email, code), expiresAt: now + OTP_TTL_MS, attempts: 0 });
  return code;
}

function verifyLocalOtp(email: string, code: string): boolean {
  const entry = localOtps.get(email);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt || entry.attempts >= 5) {
    localOtps.delete(email);
    return false;
  }
  entry.attempts++;
  const expected = hashOtp(email, code);
  const a = Buffer.from(entry.hash);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok || entry.attempts >= 5) localOtps.delete(email);
  return ok;
}

const supabaseEmailReady = () => Boolean(config.supabaseUrl && config.supabaseKey);

function supabaseAuthHeaders() {
  return {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    'Content-Type': 'application/json',
  };
}

async function resendSendOtp(email: string, code: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resendFrom,
      to: [email],
      subject: `Код для входа в Fracs: ${code}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:16px;max-width:480px;margin:0 auto">
        <h2 style="margin:0 0 12px;color:#fff">Вход в Fracs</h2>
        <p style="margin:0 0 20px;color:#ccc">Ваш одноразовый код для входа (действителен 10 минут):</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#F26522;background:#141414;padding:16px 24px;border-radius:12px;text-align:center;border:1px solid #F26522">${code}</div>
      </div>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.message || `resend_${r.status}`);
  }
}

/** Просим Supabase отправить одноразовый код на почту. create_user: true — регистрирует нового. */
async function supabaseOtpStart(email: string) {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({ email, create_user: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const msg = body?.error_description || body?.msg || body?.message || `supabase_${r.status}`;
    const isRate = r.status === 429 || body?.error_code === 'over_email_send_rate_limit';
    throw Object.assign(new Error(msg), { code: isRate ? 'email_rate_limited' : 'email_start_failed' });
  }
}

/** Проверяем код у Supabase. Возвращает true, если код верный и не истёк. */
async function supabaseOtpVerify(email: string, code: string): Promise<boolean> {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({ type: 'email', email, token: code }),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok;
}

authRouter.post('/email/start', h(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ''));
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'bad_email', message: 'Введите корректный адрес эл. почты' });

  // Антиспам: на IP — скромно, на адрес — ещё скромнее.
  if (!(await rateLimit(`auth-email-ip:${req.ip}`, 10, 10 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited' });
  if (!(await rateLimit(`auth-email-addr:${email}`, 5, 30 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited', message: 'Слишком часто. Подождите немного — код уже летит.' });

  if (config.resendApiKey) {
    const code = issueLocalOtp(email);
    try {
      await resendSendOtp(email, code);
      return void res.json({ ok: true, email });
    } catch (e: any) {
      localOtps.delete(email);
      console.warn('[auth] email/start resend:', e?.message);
      return void res.status(502).json({ error: 'email_start_failed', message: 'Не удалось отправить код. Попробуйте позже.' });
    }
  }

  if (supabaseEmailReady()) {
    try {
      await supabaseOtpStart(email);
      return void res.json({ ok: true, email });
    } catch (e: any) {
      if (e?.code === 'email_rate_limited') return void res.status(429).json({ error: 'rate_limited', message: 'Письмо уже отправлено. Подождите минуту перед повторной отправкой.' });
      console.warn('[auth] email/start supabase:', e?.message);
      return void res.status(502).json({ error: 'email_start_failed', message: 'Не удалось отправить код. Проверьте настройки почты или войдите через Telegram.' });
    }
  }

  return void res.status(503).json({ error: 'email_auth_unavailable', message: 'Отправка почты на сервере не настроена. Войдите через Telegram или задайте RESEND_API_KEY / SUPABASE_URL.' });
}));

authRouter.post('/email/verify', h(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ''));
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'bad_email', message: 'Введите корректный адрес эл. почты' });
  if (!CODE_RE.test(code)) return void res.status(400).json({ error: 'bad_code', message: 'Код — 6–8 цифр из письма' });

  // Перебор кода делаем дорогим: 8 попыток за 10 минут на пару «IP+email».
  if (!(await rateLimit(`auth-email-verify:${req.ip}:${email}`, 8, 10 * 60_000, true))) return void res.status(429).json({ error: 'rate_limited', message: 'Слишком много попыток. Подождите 10 минут.' });

  let ok = verifyLocalOtp(email, code);
  if (!ok && supabaseEmailReady()) {
    try {
      ok = await supabaseOtpVerify(email, code);
    } catch (e) {
      console.warn('[auth] email/verify supabase:', e);
    }
  }
  if (!ok) return void res.status(400).json({ error: 'bad_code', message: 'Неверный или устаревший код' });

  const user = await upsertEmailUser(email);
  setSession(req, res, user.id);
  res.json({ ok: true });
}));
