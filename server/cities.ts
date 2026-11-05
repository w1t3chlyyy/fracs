import { CITIES_BY_REGION, TOP_CITIES } from './cityData.ts';
import { norm } from './util.ts';

export interface City {
  id: string; // «Город|Регион» — однозначно даже для одноимённых городов
  name: string;
  region: string;
  n: string; // нормализованное имя
  rank: number; // место среди крупнейших, 999 — остальные
}

export const CITIES: City[] = Object.entries(CITIES_BY_REGION).flatMap(([region, names]) =>
  names.map((name) => {
    const idx = TOP_CITIES.indexOf(name);
    return { id: `${name}|${region}`, name, region, n: norm(name), rank: idx === -1 ? 999 : idx };
  }),
);

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));
export const findCity = (id: string) => BY_ID.get(id) ?? null;

/** Размер рынка по месту в рейтинге — нужен демо-провайдеру для правдоподобных чисел. */
export const cityTier = (c: City): 'big' | 'mid' | 'small' => (c.rank < 15 ? 'big' : c.rank < 60 ? 'mid' : 'small');

// Раскладка QWERTY → ЙЦУКЕН: «rfpfym» → «казань»
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const LAYOUT = new Map([...EN].map((ch, i) => [ch, RU[i]]));
export const fixLayout = (s: string) => [...s.toLowerCase()].map((ch) => LAYOUT.get(ch) ?? ch).join('');

/** Расстояние Дамерау — Левенштейна (с перестановкой соседних букв). Возвращает 3, если больше 2. */
function osa(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 2) return 3;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}

function score(n: string, v: string): number {
  if (n === v) return 80; // как префикс: порядок среди равных решает размер города
  if (n.startsWith(v)) return 80;
  const words = n.split(' ');
  if (words.some((w) => w.startsWith(v))) return 60;
  if (n.includes(v)) return 40;
  if (v.length >= 4) {
    const maxEdits = v.length >= 7 ? 2 : 1;
    const close = (target: string) => {
      for (const len of [v.length, v.length + 1, v.length - 1]) if (osa(v, target.slice(0, len)) <= maxEdits) return true;
      return false;
    };
    if (close(n)) return 30;
    if (words.some(close)) return 25;
  }
  return 0;
}

export function searchCities(q: string, limit = 8): Pick<City, 'id' | 'name' | 'region'>[] {
  const base = norm(q);
  const out = (cs: City[]) => cs.slice(0, limit).map(({ id, name, region }) => ({ id, name, region }));
  if (!base) return out(CITIES.filter((c) => c.rank < 999).sort((a, b) => a.rank - b.rank));

  const variants = new Set([base, norm(fixLayout(q))]);
  const scored: { c: City; s: number }[] = [];
  for (const c of CITIES) {
    let s = 0;
    for (const v of variants) s = Math.max(s, score(c.n, v));
    if (s) scored.push({ c, s });
  }
  // Нечёткие совпадения (опечатки) показываем только если точных нет
  const hasStrong = scored.some((x) => x.s >= 40);
  const list = hasStrong ? scored.filter((x) => x.s >= 40) : scored;
  list.sort((a, b) => b.s - a.s || a.c.rank - b.c.rank || a.c.name.localeCompare(b.c.name, 'ru'));
  return out(list.map((x) => x.c));
}
