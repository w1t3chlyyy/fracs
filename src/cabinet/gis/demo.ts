import type { Filters, GenCity, GisRecord } from './types';

/** Демо-данные: генерируются в браузере, к реальным организациям отношения не имеют. */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIX = ['Профи', 'Мастер', 'Центр', 'Эксперт', 'Альфа', 'Гарант', 'Лидер', 'Вектор', 'Союз', 'Норма', 'Прайм', 'Атлант'];
const STREETS = ['Ленина', 'Мира', 'Советская', 'Гагарина', 'Промышленная', 'Центральная', 'Школьная', 'Заводская', 'Кирова', 'Победы', 'Садовая', 'Новая'];

/** Достаёт город и запрос из ссылки вида https://2gis.ru/<город>/search/<запрос>/… */
export function parseSearchUrl(url: string, cities: GenCity[]): { city: string; query: string } {
  let city = '';
  let query = '';
  try {
    const u = new URL(url.trim());
    const [code, , q] = u.pathname.split('/').filter(Boolean);
    city = cities.find((c) => c.c === code && u.hostname.endsWith('.' + c.d))?.n ?? cities.find((c) => c.c === code)?.n ?? '';
    query = q ? decodeURIComponent(q) : '';
  } catch { /* некорректная ссылка — используем значения по умолчанию */ }
  return { city: city || 'Ваш город', query: query || 'Компания' };
}

export function makePool(url: string, count: number, city: string, query: string): GisRecord[] {
  const r = rng(hash(url));
  const rint = (a: number, b: number) => Math.floor(r() * (b - a + 1)) + a;
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const cap = query.charAt(0).toUpperCase() + query.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const id = `${hash(url + i)}`;
    const d2 = () => String(rint(0, 99)).padStart(2, '0');
    const contacts: Record<string, string> = {};
    const num = `7900000${d2()}${d2()}`.slice(0, 11);
    if (r() < 0.85) contacts.phone = `+7 (900) 000-${num.slice(7, 9)}-${num.slice(9, 11)}`;
    if (r() < 0.4) contacts.telegram = `https://t.me/demo_${num.slice(7)}`;
    if (r() < 0.18) contacts.instagram = 'https://instagram.com/demo';
    if (r() < 0.2) contacts.email = 'demo@example.com';
    if (r() < 0.45) contacts.website = 'https://example.com';
    return {
      name: `${cap} «${pick(PREFIX)}-${rint(1, 99)}»`,
      description: null,
      rubrics: [cap],
      address: `ул. ${pick(STREETS)}, ${rint(1, 120)}`,
      city,
      rating: r() < 0.85 ? Math.round((3.4 + r() * 1.6) * 10) / 10 : null,
      review_count: rint(0, 250),
      contacts,
      url: `https://2gis.example/firm/${id}`,
      district: null,
    };
  });
}

export function passes(rec: GisRecord, f: Filters): boolean {
  const c = rec.contacts;
  const social = Object.keys(c).some((k) => !['phone', 'email', 'website'].includes(k));
  if (f.require_phone && !c.phone) return false;
  if (f.require_telegram && !c.telegram) return false;
  if (f.require_social && !social) return false;
  if (f.require_email && !c.email) return false;
  if (f.require_website && !c.website) return false;
  if (f.require_no_website && c.website) return false;
  if (f.min_rating && (rec.rating ?? 0) < f.min_rating) return false;
  if (f.min_reviews && (rec.review_count ?? 0) < f.min_reviews) return false;
  return true;
}
