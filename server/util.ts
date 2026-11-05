import crypto from 'node:crypto';

/** Нормализация для поиска: регистр, ё→е, дефисы → пробелы. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[-–—_.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rint = (r: () => number, min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
export const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

/** Чистит пользовательский текст: управляющие символы, угловые скобки, лишние пробелы. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const buckets = new Map<string, { n: number; reset: number }>();
/** true — можно, false — лимит исчерпан. Память процесса, для одного инстанса этого достаточно. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  b.n++;
  return b.n <= max;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
