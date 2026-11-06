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

export const mapsIsDemo = () => config.mapsProvider !== '2gis' || !config.gisKey;
export const tgIsDemo = () => config.tgProvider !== 'http' || !config.tgParserUrl;

function mockMaps(niche: string, city: City): { stats: MapsStats; rows: MapsRow[] } {
  const streets = ['ул. Ленина', 'пр-кт Мира', 'ул. Гагарина', 'ул. Советская', 'ул. Победы', 'ул. Кирова', 'ул. Пушкина', 'ш. Заводское', 'ул. Строителей', 'ул. Промышленная'];
  const prefixes = ['ГК', 'Компания', 'Студия', 'Центр', 'Мастерская', 'Бюро', 'ПКФ', 'ООО', 'ИП'];
  const total = 42 + Math.floor(Math.random() * 58);
  const withoutSite = Math.floor(total * 0.42);
  const rows: MapsRow[] = [];
  const count = Math.min(withoutSite, 25);

  for (let i = 1; i <= count; i++) {
    const street = streets[i % streets.length];
    const bldg = ((i * 3 + 2) % 48) + 1;
    const phone = `+7 (9${((i * 7 + 10) % 90) + 10}) ${((i * 123 + 456) % 900) + 100}-${String((i * 47) % 90 + 10).padStart(2, '0')}-${String((i * 19) % 90 + 10).padStart(2, '0')}`;
    rows.push({
      id: `firm_${i}_${Date.now()}`,
      name: `${prefixes[i % prefixes.length]} "${niche.charAt(0).toUpperCase() + niche.slice(1)} ${city.name} №${i}"`,
      category: niche,
      address: `г. ${city.name}, ${street}, ${bldg}`,
      phone: i % 7 === 0 ? null : phone,
      rating: Number((4.2 + (i % 8) * 0.1).toFixed(1)),
      reviews: ((i * 13 + 7) % 150) + 4,
      url: `https://2gis.ru/${encodeURIComponent(city.name.toLowerCase())}/firm/700000010${100000 + i}`,
    });
  }

  return {
    stats: {
      total,
      withoutSite,
      withPhone: rows.filter((r) => r.phone).length,
    },
    rows,
  };
}

function mockTg(phrase: string, days: number): { stats: TgStats; rows: TgRow[] } {
  const authors = [
    { username: 'alex_director', name: 'Александр В.' },
    { username: 'sergey_biz', name: 'Сергей К.' },
    { username: 'mikhail_prod', name: 'Михаил Т.' },
    { username: 'elena_opt', name: 'Елена С.' },
    { username: 'dmitry_stroy', name: 'Дмитрий Н.' },
    { username: 'igor_logist', name: 'Игорь М.' },
    { username: 'anna_marketer', name: 'Анна Р.' },
    { username: 'artem_ceo', name: 'Артём Г.' },
  ];
  const chats = [
    'Бизнес Клуб РФ / Партнеры',
    'B2B Закупки и Поставки',
    'Предприниматели Москвы и Регионов',
    'Поиск Подрядчиков и Исполнителей',
    'Оптовый Чат Закупок',
  ];
  const templates = [
    `Коллеги, добрый день! Ищем надежного подрядчика по направлению "${phrase}". Бюджет согласован, готовы к договору. Кто может помочь?`,
    `Ищу специалистов: ${phrase}. Интересует сотрудничество на постоянной основе, объемы хорошие. Пишите в лс с кейсами.`,
    `Срочно нужен контакт проверенной компании (${phrase}). Напишите, пожалуйста, в личные сообщения.`,
    `Добрый день! Подскажите, кто сейчас профессионально занимается: ${phrase}? Нужен расчет КП до конца недели.`,
    `Ищем компанию под задачу: ${phrase}. Просьба без спама, сразу контакты и опыт в лс.`,
  ];
  const rows: TgRow[] = [];
  const now = Date.now();
  for (let i = 0; i < 12; i++) {
    const a = authors[i % authors.length];
    const c = chats[i % chats.length];
    const text = templates[i % templates.length];
    const msAgo = (i * 3.5 + 1) * 3600_000;
    rows.push({
      id: `msg_${i}_${now}`,
      username: `${a.username}_${i}`,
      name: a.name,
      chat: c,
      text,
      date: new Date(now - msAgo).toISOString(),
      link: `https://t.me/${a.username}_${i}`,
    });
  }
  return {
    stats: {
      people: rows.length,
      chats: new Set(rows.map((r) => r.chat)).size,
    },
    rows,
  };
}

export async function searchMaps(niche: string, city: City): Promise<{ stats: MapsStats; rows: MapsRow[] }> {
  if (config.mapsProvider !== '2gis' || !config.gisKey) {
    return mockMaps(niche, city);
  }

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

  try {
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
  } catch (err) {
    console.warn('[maps] 2ГИС ошибка, используем mock режим:', err);
    return mockMaps(niche, city);
  }
}

export async function searchTg(phrase: string, days: number): Promise<{ stats: TgStats; rows: TgRow[] }> {
  if (config.tgProvider !== 'http' || !config.tgParserUrl) {
    return mockTg(phrase, days);
  }

  try {
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
  } catch (err) {
    console.warn('[tg] Парсер ошибка, используем mock режим:', err);
    return mockTg(phrase, days);
  }
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
