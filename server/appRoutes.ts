import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config } from './config.ts';
import { getUser, isSubscribed, rateLimit } from './db.ts';
import { requireAuth } from './auth.ts';

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

const mac = (uid: string) => crypto.createHmac('sha256', config.sessionSecret).update('fracs-app-license:' + uid).digest('base64url').slice(0, 24);

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
  if (!(await rateLimit(`app-verify:${req.ip}`, 60, 10 * 60_000))) return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  const uid = parseKey(req.body?.key);
  if (!uid) return void res.json({ ok: false, reason: 'invalid' });
  const user = await getUser(uid);
  if (!user) return void res.json({ ok: false, reason: 'invalid' });
  if (!isSubscribed(user)) return void res.json({ ok: false, reason: 'expired' });
  res.json({ ok: true, until: user.subscriptionUntil, name: user.firstName });
}));
