import { config } from './config.ts';
import type { SearchRecord } from './db.ts';
import type { City } from './cities.ts';

export interface MapsStats { total: number; withoutSite: number; withPhone: number }
export interface MapsRow {
  id: string; name: string; category: string; address: string;
  phone: string | null; rating: number | null; reviews: number | null; url: string | null;
}
export interface TgStats { people: number; chats: number }
export interface TgRow { id: string; username: string; name: string; chat: string; text: string; date: string; link: string }

/** Демо-данных больше нет: если источник не подключён, поиск честно отвечает ошибкой. */
export const mapsIsDemo = () => false;
export const tgIsDemo = () => false;

const SERPER = () => process.env.SERPER_API_KEY || '';
const MIN_REVIEWS = Number(process.env.MIN_REVIEWS) || 3;
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const hostOf = (u: string) => { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// Соцсети, каталоги и мессенджеры своим сайтом не считаются (список из вашего lib/sitecheck.js)
const AGG = ['2gis.ru', '2gis.com', 'yandex.ru', 'yandex.com', 'ya.ru', 'google.com', 'google.ru', 'zoon.ru', 'flamp.ru', 'tripadvisor.ru', 'yell.ru', 'orgpage.ru', 'spr.ru', 'vk.com', 'vk.ru', 'ok.ru', 'instagram.com', 'facebook.com', 't.me', 'telegram.me', 'youtube.com', 'tiktok.com', 'avito.ru', 'hh.ru', 'restoclub.ru', 'wikipedia.org', 'rusprofile.ru', 'list-org.com', 'sbis.ru', 'profi.ru', 'yclients.com', 'dikidi.net', 'booksy.com', 'dzen.ru', 'rutube.ru', 'otzovik.com', 'irecommend.ru', 'checko.ru', 'kontur.ru', 'allbiz.ru', 'cylex.ru', 'pulscen.ru', 'tiu.ru', 'prodoctorov.ru', 'docdoc.ru', 'napopravku.ru', 'wa.me', 'linktr.ee', 'taplink.cc', 'booking.com'];
const isAgg = (h: string) => AGG.some((d) => h === d || h.endsWith('.' + d));
// Госструктуры и явные юрлица (ООО/АО…) отсекаем: нужны частные заведения
const NOT_IP = /(?:^|[^a-zа-яё0-9])(?:гбу\w*|гку|мбу\w*|мбоу|мдоу|муп|гуп|мфц|загс|мвд|мчс|ооо|оао|зао|пао|ао|нко|тсж|жэк)(?=$|[^a-zа-яё0-9])|муниципальн|государственн|бюджетн|администрац|министерств|департамент|поликлиник|больниц|диспансер|полици|налогов|пенсионн|суд\b|школа|гимназия|лицей|колледж|детский сад|университет|библиотек|музей|театр|церковь|храм|мечеть|кладбищ|управляющая компания/iu;
const CLOSED = /закрыто навсегда|навсегда закрыт|permanently closed|прекратил[а-я]* работу|больше не работает/i;

async function serper(path: 'places' | 'search', body: object): Promise<any> {
  const r = await fetch('https://google.serper.dev/' + path, {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ gl: 'ru', hl: 'ru', ...body }),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error('Serper HTTP ' + r.status);
  return r.json();
}

function phoneOf(raw: unknown): string {
  const d = String(raw || '').split(/[;,]/)[0].replace(/\D/g, '');
  const t = d.length === 11 && (d[0] === '7' || d[0] === '8') ? d.slice(1) : d.length === 10 ? d : '';
  return t ? `+7 ${t.slice(0, 3)} ${t.slice(3, 6)}-${t.slice(6, 8)}-${t.slice(8)}` : '';
}

type Cand = MapsRow & { site: boolean; key: string };

/** Есть ли у заведения свой сайт или оно закрыто. true — не выдаём. Исключение — проверить не удалось. */
async function hasOwnSite(c: Cand, city: string): Promise<boolean> {
  const toks = norm(c.name).split(' ').filter((t) => t.length >= 3);
  if (!toks.length) return false;
  const need = Math.max(1, Math.ceil(toks.length * 0.6));
  const hit = (t: string) => { const h = norm(t); return h.includes(norm(c.name)) || toks.filter((x) => h.includes(x)).length >= need; };
  const web = await serper('search', { q: `${c.name} ${city}`, num: 10 });
  const org: any[] = web.organic || [];
  for (const r of [web.knowledgeGraph, ...org.slice(0, 5)].filter(Boolean)) {
    const text = `${r.title || ''} ${r.description || ''} ${r.snippet || ''}`;
    if (hit(r.title || text) && CLOSED.test(text)) return true;
  }
  if (web.knowledgeGraph?.website && !isAgg(hostOf(web.knowledgeGraph.website)) && hit(web.knowledgeGraph.title || '')) return true;
  for (let i = 0; i < org.length; i++) {
    const host = hostOf(org[i].link);
    if (!host || isAgg(host)) continue;
    const hay = `${org[i].title || ''} ${org[i].snippet || ''}`;
    if (!hit(hay)) continue;
    if (norm(hay).includes(norm(city)) || i < 3 || toks.some((t) => t.length >= 4 && host.replace(/[^a-zа-я0-9]/g, '').includes(t))) return true;
  }
  return false;
}

async function serperMaps(niche: string, city: City, deadline: number): Promise<{ stats: MapsStats; rows: MapsRow[] }> {
  const all = new Map<string, Cand>();
  const errors: string[] = [];
  const queries = [niche, `${niche} адрес телефон`, `${niche} рядом`];
  const jobs = queries.flatMap((q) => [1, 2, 3].map((page) => ({ q: `${q} ${city.name}`, page })));
  for (let i = 0; i < jobs.length; i += 3) {
    if (Date.now() > deadline - 25000) break;
    const res = await Promise.all(jobs.slice(i, i + 3).map((j) => serper('places', j).then((x) => x.places || []).catch((e) => { errors.push(e.message); return []; })));
    for (const p of res.flat()) {
      const name = String(p.title || '').trim();
      const address = String(p.address || '').trim();
      const id = String(p.cid || p.placeId || '').trim();
      const phone = phoneOf(p.phoneNumber || p.phone);
      if (!id || name.length < 2 || all.has(id) || NOT_IP.test(`${name} ${p.category || ''}`)) continue;
      if (!norm(address).includes(norm(city.name)) || !/\d/.test(address) || !phone) continue;
      if (!(Number(p.ratingCount) >= MIN_REVIEWS)) continue;
      const host = p.website ? hostOf(String(p.website)) : '';
      all.set(id, { id, name, category: String(p.category || niche), address, phone, rating: Number(p.rating) || null, reviews: Number(p.ratingCount) || null, url: `https://www.google.com/maps?cid=${encodeURIComponent(id)}`, site: !!host && !isAgg(host), key: norm(name) });
    }
  }
  if (!all.size && errors.length) throw new Error(errors[0]);
  // сети и дубли: одно название или телефон у нескольких точек
  const cnt = new Map<string, number>();
  for (const c of all.values()) for (const k of [c.key, c.phone!]) cnt.set(k, (cnt.get(k) || 0) + 1);
  const todo = [...all.values()].filter((c) => !c.site && cnt.get(c.key)! < 2 && cnt.get(c.phone!)! < 2);
  const rows: MapsRow[] = [];
  for (let i = 0; i < todo.length && Date.now() < deadline; i += 5) {
    const batch = todo.slice(i, i + 5);
    const res = await Promise.all(batch.map((c) => hasOwnSite(c, city.name).catch(() => null)));
    batch.forEach((c, k) => { if (res[k] === false) { const { site, key, ...row } = c; rows.push(row); } }); // сомнение или ошибка проверки = не выдаём
  }
  return { stats: { total: all.size, withoutSite: rows.length, withPhone: rows.length }, rows };
}

export async function searchMaps(niche: string, city: City): Promise<{ stats: MapsStats; rows: MapsRow[] }> {
  const deadline = Date.now() + 50000;
  if (SERPER()) return serperMaps(niche, city, deadline);
  if (config.gisKey) return gisSearch(niche, city);
  throw new Error('Источник данных не подключён: задайте SERPER_API_KEY (или GIS_API_KEY)');
}

async function gisSearch(niche: string, city: City): Promise<{ stats: MapsStats; rows: MapsRow[] }> {
  const rows: MapsRow[] = [];
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const url = new URL('https://catalog.api.2gis.com/3.0/items');
    url.searchParams.set('q', `${niche} ${city.name}`);
    url.searchParams.set('type', 'branch');
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', '50');
    url.searchParams.set('fields', 'items.contact_groups,items.reviews,items.address_name,items.rubrics');
    url.searchParams.set('key', config.gisKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) { if (page === 1) throw new Error(`2ГИС ответил ${resp.status}`); break; }
    const items: any[] = ((await resp.json()) as any)?.result?.items ?? [];
    total += items.length;
    for (const it of items) {
      const contacts: any[] = (it.contact_groups ?? []).flatMap((g: any) => g.contacts ?? []);
      const phone = contacts.find((c) => c.type === 'phone');
      if (contacts.some((c) => c.type === 'website') || !phone) continue; // без контактов в ответе ключ ничего не докажет
      rows.push({ id: String(it.id), name: String(it.name ?? ''), category: String(it.rubrics?.[0]?.name ?? niche), address: String(it.address_name ?? city.name), phone: String(phone.text ?? phone.value ?? '') || null, rating: it.reviews?.general_rating ?? null, reviews: it.reviews?.general_review_count ?? null, url: `https://2gis.ru/firm/${String(it.id).split('_')[0]}` });
    }
    if (items.length < 50) break;
  }
  return { stats: { total, withoutSite: rows.length, withPhone: rows.length }, rows };
}

export async function searchTg(phrase: string, days: number): Promise<{ stats: TgStats; rows: TgRow[] }> {
  if (config.tgProvider !== 'http' || !config.tgParserUrl) throw new Error('Парсер Telegram не подключён: задайте TG_PROVIDER=http и TG_PARSER_URL');
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

/** Число строк и первые 3 для замаскированного превью — всё из реальных данных. */
export function summarize(_kind: SearchRecord['kind'], _stats: Record<string, number>, rows: unknown[] = []) {
  return { rowsTotal: rows.length, head: rows.slice(0, 3) };
}

export const rowCount = (rec: SearchRecord): number => rec.rowsTotal;

export function getRows(rec: SearchRecord, offset: number, limit: number): (MapsRow | TgRow)[] {
  return ((rec.rows ?? []) as (MapsRow | TgRow)[]).slice(offset, offset + limit);
}

export const headRows = (rec: SearchRecord): (MapsRow | TgRow)[] => (rec.head ?? []) as (MapsRow | TgRow)[];
