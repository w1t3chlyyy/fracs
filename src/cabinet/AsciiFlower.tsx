import { useEffect, useRef } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
 * AsciiFlower — ASCII-арт цветок справа на экране входа.
 *
 * Анимация (как в макете Frame 127, только живая):
 *   1. «Распускание»: всё поле пусто, в центре мигает «0», затем цветок
 *      вырастает из центра волной по радиусу (~2.6 c).
 *   2. «Цикличная прокрутка по кругу»: распустившийся цветок бесконечно
 *      вращается вокруг центра (истинное вращение поля по полярным
 *      координатам — период 2π, поэтому цикл замкнут и бесшовен).
 *
 * Цвета — как в макете: оранжевое ядро, зелёные/жёлтые включения, серые
 * «обрывки» символов по краям. Всё считается на клиенте, без картинок.
 * ──────────────────────────────────────────────────────────────────────────── */

// Детерминированный PRNG — картинка одинаковая при каждом заходе.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARS = '0123456789abcdefXYUuvsxwzZkkr*+=<>/{}[]()#%&@$!?~^|;:';

// Палитра макета.
const ORANGE = ['#ff5a0f', '#F26522', '#ff7f33', '#e8590c', '#ff6a1f'];
const GREEN = ['#3fd96e', '#2fbf5e', '#7ee08a', '#24a35a'];
const YELLOW = ['#ffc233', '#ffaa00'];
const DIM = ['#4a4a4a', '#5c5c5c', '#3a3a3a', '#666666'];

const pick = <T,>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

interface Cell {
  ch: string;
  color: string;
  /** Нормированный радиус в «визуальных» единицах (0..~1.6), 0 — центр. */
  dist: number;
  /** Полярный угол [0..2π) — для сортировки по кольцам. */
  ang: number;
}

// Геометрия: моноширинный символ ≈ 0.6 ширины к высоте, поэтому сетка шире, чем выше.
const COLS = 121;
const ROWS = 61;
const CX = (COLS - 1) / 2;
const CY = (ROWS - 1) / 2;
// Горизонтальный радиус в колонках; вертикальный получается из пропорции символа.
const R = 31;
const ROW_H = 1.66; // высота строки / ширина символа
const PETALS = 8; // 8 острий: вверх/вниз/по диагоналям — круглый ореол звезды, как в макете
const BLOOM_MS = 2600;
const ROT_SPEED = 0.5; // рад/с: полный круг за ~12.6 с
const FRAME_MS = 90; // ~11 fps — «терминальный» темп

function buildField(): Cell[] {
  const rnd = mulberry32(20261127);
  const cells: Cell[] = new Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const vx = x - CX;
      const vy = (y - CY) * ROW_H;
      const dist = Math.sqrt(vx * vx + vy * vy) / R;
      const th = Math.atan2(vy, vx);
      // Радиус лепестка: 8 «острий» + лёгкая асимметрия, как у макетной звезды.
      const petal = 0.6 + 0.36 * Math.cos(PETALS * th) + 0.05 * Math.sin(3 * th + 1.7);
      const noise = 0.94 + 0.14 * rnd();
      let fragment = false;
      let filled = false;

      if (dist < 0.62) {
        filled = true; // плотное ядро
      } else if (dist < petal * noise) {
        // Почти сплошное тело лепестка, у контура — реже («рваный» край).
        filled = rnd() < 1.08 - 0.52 * (dist / (petal * noise));
      } else if (dist < 1.3 && rnd() < 0.035 * Math.max(0, 1.3 - dist)) {
        fragment = true; // обрывки вокруг
        filled = true;
      }

      let ch = ' ';
      let color = '#000';
      if (filled) {
        ch = pick(rnd, CHARS.split(''));
        if (fragment) {
          color = rnd() < 0.55 ? pick(rnd, DIM) : pick(rnd, GREEN);
        } else if (dist < 0.45) {
          color = pick(rnd, ORANGE);
        } else if (dist < 0.72) {
          color = rnd() < 0.88 ? pick(rnd, ORANGE) : pick(rnd, YELLOW);
        } else if (dist < 1.02) {
          const p = rnd();
          color = p < 0.6 ? pick(rnd, ORANGE) : p < 0.87 ? pick(rnd, GREEN) : pick(rnd, YELLOW);
        } else {
          color = rnd() < 0.6 ? pick(rnd, GREEN) : pick(rnd, DIM);
        }
      }
      cells[y * COLS + x] = { ch, color, dist, ang: Math.atan2(vy, vx) + Math.PI };
    }
  }
  return cells;
}

/**
 * Кольца: ячейки с близким радиусом, отсортированные по углу. Вращение —
 * циклический сдвиг содержимого внутри каждого кольца (бесшовно и без
 * потерь: каждая заполненная ячейка всегда видна, просто «едет по кругу»).
 */
interface Ring {
  /** Индексы ячеек поля, отсортированные по углу. */
  idx: number[];
  /** Средний радиус кольца в колонках — для расчёта сдвига при вращении. */
  radius: number;
}

function buildRings(cells: Cell[]): Ring[] {
  const RING_SCALE = 14; // колец на единицу нормированного радиуса
  const byRing = new Map<number, number[]>();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].ch === ' ') continue;
    const r = Math.round(cells[i].dist * RING_SCALE);
    let arr = byRing.get(r);
    if (!arr) byRing.set(r, (arr = []));
    arr.push(i);
  }
  const rings: Ring[] = [];
  for (const [r, idx] of [...byRing.entries()].sort((a, b) => a[0] - b[0])) {
    idx.sort((a, b) => cells[a].ang - cells[b].ang);
    rings.push({ idx, radius: (r / RING_SCALE) * R });
  }
  return rings;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (ch: string, color: string) => `<span style="color:${color}">${esc(ch)}</span>`;
const CENTER = ROWS >> 1;

/** Собирает HTML-кадр: кольца сдвинуты на угол (вращение), распускание по радиусу. */
function renderFrame(cells: Cell[], rings: Ring[], angle: number, bloom: number): string {
  const out: (string | null)[] = new Array(COLS * ROWS).fill(null);
  for (const ring of rings) {
    const n = ring.idx.length;
    // Сдвиг пропорционален радиусу кольца — узор вращается «жёстко», как диск.
    let shift = Math.round(angle * ring.radius);
    shift = ((shift % n) + n) % n;
    for (let j = 0; j < n; j++) {
      const src = cells[ring.idx[(j - shift + n) % n]];
      if (src.dist > bloom) continue; // ещё не распустилось
      out[ring.idx[j]] = span(src.ch, src.color);
    }
  }
  // Сердцевина — «0», из которого всё выросло.
  if (bloom > 0.05) out[CENTER * COLS + (COLS >> 1)] = span('0', '#ff5a0f');

  const lines: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    const line: string[] = [];
    for (let x = 0; x < COLS; x++) {
      line.push(out[y * COLS + x] ?? '<span> </span>');
      if (x < COLS - 1) line.push(' ');
    }
    lines.push(line.join(''));
  }
  return lines.join('\n');
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);

export default function AsciiFlower({ className = '' }: { className?: string }) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const cells = buildField();
    const rings = buildRings(cells);
    const pre = preRef.current;
    if (!pre) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      // Уважаем настройку «меньше движения»: статичный распустившийся цветок.
      pre.innerHTML = renderFrame(cells, rings, 0, 1.4);
      return;
    }

    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      const t = now - start;
      const bloom = Math.min(1.4, easeOut(Math.min(1, t / BLOOM_MS)) * 1.4);
      const angle = t * 0.001 * ROT_SPEED;
      pre.innerHTML = renderFrame(cells, rings, angle, bloom);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <pre
      ref={preRef}
      aria-hidden
      className={`select-none font-mono leading-none text-[10px] sm:text-[11px] origin-center ${className}`}
      style={{ lineHeight: 1.0, margin: 0 }}
    />
  );
}
