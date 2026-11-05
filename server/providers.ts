import { config } from './config.ts';
import type { SearchRecord } from './db.ts';
import { cityTier, type City } from './cities.ts';
import { hashStr, mulberry32, norm, pick, rint } from './util.ts';

export interface MapsStats { total: number; withoutSite: number; withPhone: number }
export interface MapsRow {
  id: string; name: string; category: string; address: string;
  phone: string | null; rating: number | null; reviews: number | null; url: string | null;
}
export interface TgStats { people: number; chats: number }
export interface TgRow { id: string; username: string; name: string; chat: string; text: string; date: string; link: string }

const DEMO_ROWS_CAP = 300;

/* ───────────────────────── Карты ───────────────────────── */

export const mapsIsDemo = () => config.mapsProvider !== '2gis';

export async function searchMaps(niche: string, city: City): Promise<{ stats: MapsStats; rows?: MapsRow[] }> {
  if (config.mapsProvider === '2gis') return gisSearch(niche, city);
  return { stats: mockMapsStats(`${norm(niche)}|${city.id}`, city) };
}

function mockMapsStats(seed: string, city: City): MapsStats {
  const r = mulberry32(hashStr(seed));
  const [lo, hi] = { big: [900, 2600], mid: [300, 950], small: [40, 320] }[cityTier(city)];
  const total = rint(r, lo, hi);
  const withoutSite = Math.round(total * (0.28 + r() * 0.24));
  const withPhone = Math.round(withoutSite * (0.7 + r() * 0.22));
  return { total, withoutSite, withPhone };
}

const PREFIX = ['Профи', 'Мастер', 'Центр', 'Эксперт', 'Альфа', 'Гарант', 'Лидер', 'Вектор', 'Союз', 'Норма'];
const STREETS = ['Ленина', 'Мира', 'Советская', 'Гагарина', 'Промышленная', 'Центральная', 'Школьная', 'Заводская', 'Кирова', 'Победы'];

export function mockMapsRow(rec: SearchRecord, i: number): MapsRow {
  const r = mulberry32(hashStr(`${rec.seed}:${i}`));
  const niche = rec.query.niche || 'Компания';
  const phoneShare = rec.stats.withPhone / Math.max(1, rec.stats.withoutSite);
  return {
    id: `demo-${i}`,
    name: `${niche[0].toUpperCase()}${niche.slice(1)} «${pick(r, PREFIX)}-${rint(r, 1, 99)}»`,
    category: niche,
    address: `${rec.query.cityLabel?.split(',')[0] ?? ''}, ул. ${pick(r, STREETS)}, ${rint(r, 1, 120)}`,
    phone: r() < phoneShare ? `+7 (900) 000-${String(rint(r, 0, 99)).padStart(2, '0')}-${String(rint(r, 0, 99)).padStart(2, '0')}` : null,
    rating: Math.round((3.8 + r() * 1.2) * 10) / 10,
    reviews: rint(r, 3, 250),
    url: null,
  };
}

// Реальный провайдер: Places API 2ГИС (как в saleshustlify, переменная GIS_API_KEY).
// Реализован по описанию из README — сверьте поля ответа со своей подпиской 2ГИС.
async function gisSearch(niche: string, city: City): Promise<{ stats: MapsStats; rows: MapsRow[] }> {
  if (!config.gisKey) throw new Error('GIS_API_KEY не задан');
  const MAX_PAGES = 10;
  const rows: MapsRow[] = [];
  let scanned = 0;
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL('https://catalog.api.2gis.com/3.0/items');
    url.searchParams.set('q', `${niche} ${city.name}`);
    url.searchParams.set('type', 'branch');
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', '50');
    url.searchParams.set('fields', 'items.contact_groups,items.reviews,items.address_name,items.rubrics');
    url.searchParams.set('key', config.gisKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      if (page === 1) throw new Error(`2ГИС ответил ${resp.status}`);
      break;
    }
    const json: any = await resp.json();
    const items: any[] = json?.result?.items ?? [];
    if (page === 1) total = Number(json?.result?.total ?? 0);
    if (!items.length) break;
    scanned += items.length;
    for (const it of items) {
      const contacts: any[] = (it.contact_groups ?? []).flatMap((g: any) => g.contacts ?? []);
      if (contacts.some((c) => c.type === 'website')) continue;
      const phone = contacts.find((c) => c.type === 'phone');
      rows.push({
        id: String(it.id),
        name: String(it.name ?? ''),
        category: String(it.rubrics?.[0]?.name ?? niche),
        address: String(it.address_name ?? city.name),
        phone: phone ? String(phone.text ?? phone.value ?? '') || null : null,
        rating: it.reviews?.general_rating ?? null,
        reviews: it.reviews?.general_review_count ?? null,
        url: `https://2gis.ru/firm/${String(it.id).split('_')[0]}`,
      });
    }
    if (items.length < 50) break;
  }
  return {
    stats: { total: Math.max(total, scanned), withoutSite: rows.length, withPhone: rows.filter((r) => r.phone).length },
    rows,
  };
}

/* ───────────────────────── Telegram ───────────────────────── */

export const tgIsDemo = () => config.tgProvider !== 'http';

export async function searchTg(phrase: string, days: number): Promise<{ stats: TgStats; rows?: TgRow[] }> {
  if (config.tgProvider === 'http') return tgHttpSearch(phrase, days);
  const r = mulberry32(hashStr(`${norm(phrase)}|${days}`));
  return { stats: { people: rint(r, 8, 140) * days, chats: rint(r, 4, 40) } };
}

const NAMES = ['Алексей', 'Мария', 'Дмитрий', 'Анна', 'Сергей', 'Ольга', 'Иван', 'Елена', 'Андрей', 'Наталья'];

export function mockTgRow(rec: SearchRecord, i: number): TgRow {
  const r = mulberry32(hashStr(`${rec.seed}:${i}`));
  const username = `demo_user_${rint(r, 1000, 9999)}`;
  const days = rec.query.days ?? 3;
  return {
    id: `demo-${i}`,
    username,
    name: pick(r, NAMES),
    chat: `Демо-чат ${rint(r, 1, rec.stats.chats)}`,
    text: `Ищу: ${rec.query.phrase}. Кто может помочь? Пишите в личные сообщения.`,
    date: new Date(Date.now() - r() * days * 86400000).toISOString(),
    link: `https://t.me/${username}`,
  };
}

// Реальный провайдер: ваш сервис из репозитория lead (Telethon SearchGlobal) за HTTP.
// Ожидаемый контракт: POST {TG_PARSER_URL}/search {phrase, days} → { rows: TgRow[] }
async function tgHttpSearch(phrase: string, days: number): Promise<{ stats: TgStats; rows: TgRow[] }> {
  if (!config.tgParserUrl) throw new Error('TG_PARSER_URL не задан');
  const resp = await fetch(`${config.tgParserUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.tgParserKey}` },
    body: JSON.stringify({ phrase, days }),
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`TG-парсер ответил ${resp.status}`);
  const rows: TgRow[] = ((await resp.json()) as any).rows ?? [];
  return {
    stats: { people: new Set(rows.map((x) => x.username || x.id)).size, chats: new Set(rows.map((x) => x.chat)).size },
    rows,
  };
}

/* ───────────────────────── Общий доступ к строкам ───────────────────────── */

export function rowCount(rec: SearchRecord): number {
  if (rec.rows) return rec.rows.length;
  return Math.min(rec.kind === 'maps' ? rec.stats.withoutSite : rec.stats.people, DEMO_ROWS_CAP);
}

export function getRows(rec: SearchRecord, offset: number, limit: number): (MapsRow | TgRow)[] {
  if (rec.rows) return rec.rows.slice(offset, offset + limit) as (MapsRow | TgRow)[];
  const end = Math.min(offset + limit, rowCount(rec));
  const out: (MapsRow | TgRow)[] = [];
  for (let i = offset; i < end; i++) out.push(rec.kind === 'maps' ? mockMapsRow(rec, i) : mockTgRow(rec, i));
  return out;
}
