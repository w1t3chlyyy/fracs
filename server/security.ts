import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    res.setHeader('Content-Security-Policy', CSP);
  }
  next();
}

export const noStoreApi = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** CSRF: изменяющие запросы принимаем только со своего origin. Вебхуки (Telegram, ЮKassa, cron, программа) Origin не шлют. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowed = new Set(
  [config.appUrl, ...(process.env.EXTRA_ORIGINS || '').split(',')].map((s) => s.trim()).filter(Boolean).map((u) => { try { return new URL(u).origin; } catch { return ''; } }),
);
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  const sameHost = origin === `${req.protocol}://${req.get('host')}`;
  if (origin ? !(sameHost || allowed.has(origin)) : req.get('sec-fetch-site') === 'cross-site') {
    return void res.status(403).json({ error: 'forbidden_origin' });
  }
  next();
}

/** Дешёвый in-memory лимитер для публичных ручек (основная защита от DDoS — Vercel Firewall). */
const hits = new Map<string, { n: number; reset: number }>();
export const limit = (name: string, max: number, windowMs: number) => (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  if (hits.size > 20_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const key = `${name}:${req.ip}`;
  const e = hits.get(key);
  if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return next(); }
  if (++e.n > max) return void res.status(429).json({ error: 'rate_limited' });
  next();
};
