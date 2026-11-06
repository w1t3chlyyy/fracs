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

export async function searchMaps(niche: string, city: City): Promise<{ stats: MapsStats; rows: MapsRow[] }> {
  if (config.mapsProvider !== '2gis' || !config.gisKey) throw new Error('Поиск по 2ГИС не подключён: задайте MAPS_PROVIDER=2gis и GIS_API_KEY');
  const PAGE = 50, MAX_PAGES = 10;
  const rows: MapsRow[] = [];
  const seen = new Set<string>();
  let scanned = 0, total = 0;

  const fetchPage = async (page: number): Promise<any[] | null> => {
    const url = new URL('https://catalog.api.2gis.com/3.0/items');
    url.searchParams.set('q', `${niche} ${city.name}`);
    url.searchParams.set('type', 'branch');
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(PAGE));
    url.searchParams.set('fields', 'items.contact_groups,items.reviews,items.address_name,items.rubrics');
    url.searchParams.set('key', config.gisKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      if (page === 1) throw new Error(`2ГИС ответил ${resp.status}`);
      return null;
    }
    const json: any = await resp.json();
    if (page === 1) total = Number(json?.result?.total ?? 0);
    return json?.result?.items ?? [];
  };

  const take = (items: any[]) => {
    scanned += items.length;
    for (const it of items) {
      const id = String(it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const contacts: any[] = (it.contact_groups ?? []).flatMap((g: any) => g.contacts ?? []);
      if (contacts.some((c) => c.type === 'website')) continue;
      const phone = contacts.find((c) => c.type === 'phone');
      rows.push({
        id, name: String(it.name ?? ''), category: String(it.rubrics?.[0]?.name ?? niche),
        address: String(it.address_name ?? city.name),
        phone: phone ? String(phone.text ?? phone.value ?? '') || null : null,
        rating: it.reviews?.general_rating ?? null, reviews: it.reviews?.general_review_count ?? null,
        url: `https://2gis.ru/firm/${id.split('_')[0]}`,
      });
    }
  };

  const first = (await fetchPage(1)) ?? [];
  take(first);
  if (first.length >= PAGE) {
    const last = Math.min(MAX_PAGES, Math.max(2, Math.ceil(total / PAGE)));
    for (let from = 2; from <= last; from += 5) {
      const batch = await Promise.all(Array.from({ length: Math.min(5, last - from + 1) }, (_, i) => fetchPage(from + i).catch(() => null)));
      for (const items of batch) if (items?.length) take(items);
      if (batch.some((b) => !b || b.length < PAGE)) break;
    }
  }
  return { stats: { total: Math.max(total, scanned), withoutSite: rows.length, withPhone: rows.filter((r) => r.phone).length }, rows };
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
