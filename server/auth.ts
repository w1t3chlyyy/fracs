import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { data, save, upsertTgUser, type User } from './db.ts';
import { getBotUsername } from './bot.ts';
import { randomToken, rateLimit } from './util.ts';

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
const TOKEN_MS = 10 * 60_000;

const sign = (p: string) => crypto.createHmac('sha256', config.sessionSecret).update(p).digest('base64url');

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
  return Object.fromEntries(
    header.split(';').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
    }),
  );
}

function setSession(req: Request, res: Response, uid: string) {
  const secure = req.secure || config.isProd;
  res.append('Set-Cookie', `${COOKIE}=${makeSession(uid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const uid = readSession(cookies(req.headers.cookie)[COOKIE]);
  if (uid) req.user = data.users.find((u) => u.id === uid);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized', message: 'Войдите через Telegram' });
    return;
  }
  next();
}

export const authRouter = Router();

authRouter.post('/start', (req, res) => {
  if (!rateLimit(`auth:${req.ip}`, 20, 10 * 60_000)) return void res.status(429).json({ error: 'rate_limited' });
  const username = getBotUsername();
  if (!username) return void res.status(503).json({ error: 'bot_not_configured', message: 'Бот не настроен' });
  const now = Date.now();
  data.loginTokens = data.loginTokens.filter((t) => now - t.createdAt < TOKEN_MS);
  const token = randomToken(24);
  data.loginTokens.push({ token, createdAt: now });
  save();
  res.json({ token, url: `https://t.me/${username}?start=${token}` });
});

authRouter.get('/status', (req, res) => {
  const token = String(req.query.token || '');
  const t = data.loginTokens.find((x) => x.token === token);
  if (!t || Date.now() - t.createdAt > TOKEN_MS) return void res.json({ status: 'expired' });
  if (!t.userId) return void res.json({ status: 'pending' });
  data.loginTokens = data.loginTokens.filter((x) => x !== t); // одноразовый
  save();
  setSession(req, res, t.userId);
  res.json({ status: 'ok' });
});

authRouter.post('/dev', (req, res) => {
  if (!config.devLogin) return void res.status(404).json({ error: 'not_found' });
  const user = upsertTgUser({ id: 1, username: 'dev_user', first_name: 'Разработчик' });
  setSession(req, res, user.id);
  res.json({ ok: true });
});

authRouter.post('/logout', (_req, res) => {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

