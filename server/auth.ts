import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import {
  createLoginToken,
  getLoginToken,
  getUser,
  takeLoginToken,
  upsertTgUser,
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
    res.status(401).json({ error: 'unauthorized', message: 'Войдите через Telegram' });
    return;
  }
  // Непрерывная проверка подписок на каналы: отписался — любое действие в кабинете блокируется.
  // Админ (ADMIN_TG_ID) проверку проходит всегда.
  if (!(await checkChannelSubs(req.user.tgId))) {
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
