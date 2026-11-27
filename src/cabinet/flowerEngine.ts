/* ────────────────────────────────────────────────────────────────────────────
 * flowerEngine — движок ASCII-цветка (порт референса «ASCII-цветок.html»).
 *
 * Сцена рисуется на скрытом canvas 720×704, затем попиксельно превращается
 * в ASCII-символы (яркость → символ из RAMP, цвет → усиленный RGB) на видимом
 * canvas той же сетки (120×64 ячеек, ячейка 6×11 px).
 *
 * Анимация: цветок (оранжевая головка TY.main, 9 зелёных листьев) вырастает
 * за 7 с (стебель → листья → бутон → лепестки волнами), после el>7 плавно
 * разгоняется и дальше бесконечно вращается (0.5 рад/с) с лёгким «дыханием»
 * (sway). Кнопки «вырастить заново» нет — цикл живёт сам.
 * ──────────────────────────────────────────────────────────────────────────── */

const COLS = 120, ROWS = 64, CW = 4, CH = 8;
const W = COLS * CW, H = ROWS * CH;

const RAMP = " .'`^,:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$".split('');

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => x * x * (3 - 2 * x);
const lr = (a: number, b: number, t: number) => a + (b - a) * t;
const hx = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
const mix = (a: string, b: string, t: number) => {
  let r = '#';
  for (let i = 0; i < 3; i++) r += Math.round(lr(hx(a, i), hx(b, i), t)).toString(16).padStart(2, '0');
  return r;
};

interface Pal { d: string; m: string; t: string; st: string; c0: string; c1: string; }

const lerpPal = (a: Pal, b: Pal, t: number): Pal =>
  t <= 0 ? a : { d: mix(a.d, b.d, t), m: mix(a.m, b.m, t), t: mix(a.t, b.t, t), st: mix(a.st, b.st, t), c0: mix(a.c0, b.c0, t), c1: mix(a.c1, b.c1, t) };

const WHITE: Pal = { d: '#9a9a8c', m: '#f4f4ee', t: '#ffffff', st: '#78788a', c0: '#ffe34a', c1: '#7a5008' };
const ORNG: Pal = { d: '#a82500', m: '#ff5a00', t: '#ff8c1a', st: '#6e1e00', c0: '#e07a00', c1: '#5a2a06' };

interface FlowerType { L: number[][]; c: number; }

const TY: Record<string, FlowerType> = {
  main: { L: [[14, 128, 38, 0], [12, 104, 34, .2], [10, 80, 28, .35], [8, 56, 22, .1]], c: 20 },
  rose: { L: [[5, 100, 50, 0], [5, 80, 44, .6], [5, 62, 38, .3], [4, 44, 30, .9], [3, 26, 20, .2]], c: 0 },
  glad: { L: [[6, 105, 26, 0], [6, 72, 20, .52]], c: 10 },
  daisy: { L: [[22, 100, 9, 0], [18, 82, 8, .15]], c: 19 },
  tulip: { L: [[6, 92, 38, 0], [5, 64, 32, .5]], c: 8 },
};

interface Flower {
  x: number; y: number; sc: number; pal: Pal; ty: FlowerType; rot: number;
  st: number; du: number; hx: number; hy: number; nl: number; ll: number; sh: number;
}

const F: Flower[] = [];
F.push({ x: 0, y: 0, sc: .95, pal: ORNG, ty: TY.main, rot: 0, st: 0, du: 7, hx: 0, hy: -5, nl: 9, ll: 190, sh: 14 });

/** Запускает анимацию на видимом canvas. Возвращает функцию остановки. */
export function createFlowerEngine(out: HTMLCanvasElement, staticFrame = false): () => void {
  out.width = 720; out.height = 704;

  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const g = src.getContext('2d', { willReadFrequently: true })!;
  const o = out.getContext('2d')!;

  let PAL: Pal = WHITE;
  let SH = 9;

  function leaf(a: number, len: number, w: number, k: number, sw: number) {
    if (k <= 0) return;
    g.save(); g.rotate(a + sw); g.scale(k, k);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, '#14521a'); gr.addColorStop(.5, '#2f8a25'); gr.addColorStop(1, '#86d64e');
    g.fillStyle = gr; g.beginPath(); g.moveTo(8, 0);
    g.bezierCurveTo(len * .25, -w, len * .7, -w * .9, len, 0);
    g.bezierCurveTo(len * .7, w * .9, len * .25, w, 8, 0); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#b4ee78'; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 0); g.lineTo(len * .95, 0); g.stroke();
    g.restore();
  }

  function petal(L: number, w: number) {
    const gr = g.createLinearGradient(0, 0, 0, -L);
    gr.addColorStop(0, PAL.d); gr.addColorStop(.35, PAL.m); gr.addColorStop(1, PAL.t);
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(w, -L * .2, w * 1.05, -L * .85, 0, -L);
    g.bezierCurveTo(-w * 1.05, -L * .85, -w, -L * .2, 0, 0); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = PAL.st; g.lineWidth = 1.3; g.stroke();
    if (w > 14) { g.globalAlpha = .55; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -L * .1); g.lineTo(0, -L * .8); g.stroke(); g.globalAlpha = 1; }
  }

  function layer(n: number, L: number, w: number, off: number, b: number) {
    for (let i = 0; i < n; i++) {
      g.save(); g.rotate(i / n * 6.2832 + off + (1 - b) * .6);
      g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = SH; g.shadowOffsetY = SH * .35;
      petal(L * b, w * (.35 + .65 * b)); g.restore();
    }
  }

  function leaves(x: number, y: number, sc: number, p: number, sway: number, nl: number, len: number, fade: number) {
    if (p <= 0 || fade >= 1) return;
    g.save(); g.translate(x, y); g.scale(sc, sc);
    if (p < .5) { g.fillStyle = '#7fd34a'; g.beginPath(); g.arc(0, 0, 5 + 4 * ease(clamp(p / .2)), 0, 7); g.fill(); }
    for (let i = 0; i < nl; i++) leaf(i / nl * 6.2832 + .3 + x * .02, len, len * .17, ease(clamp((p - .06 - i * .03) / .4)) * (1 - fade), Math.sin(sway * 20 + i) * .015);
    g.restore();
  }

  function head(x: number, y: number, sc: number, pal: Pal, ty: FlowerType, rot: number, p: number, sway: number, sh: number) {
    if (p <= 0) return;
    PAL = pal; SH = sh; g.save(); g.translate(x, y); g.scale(sc, sc); g.rotate(rot + sway);
    const bp = ease(clamp((p - .4) / .2)), b = ease(clamp((p - .6) / .4));
    if (bp > 0 && b < .2) {
      const r = 10 + 16 * bp * (1 - b * 3);
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8;
      const bg = g.createRadialGradient(-4, -4, 2, 0, 0, r);
      bg.addColorStop(0, '#f6fff0'); bg.addColorStop(.6, '#8fd070'); bg.addColorStop(1, '#256e22');
      g.fillStyle = bg; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    }
    if (b > 0) {
      for (const [n, L, w, off] of ty.L) layer(n, L, w, off, b);
      if (ty.c) {
        const cg = g.createRadialGradient(0, 0, 0, 0, 0, ty.c * b);
        cg.addColorStop(0, pal.c0); cg.addColorStop(1, pal.c1);
        g.fillStyle = cg; g.beginPath(); g.arc(0, 0, ty.c * b, 0, 7); g.fill();
      }
    }
    g.restore();
  }

  // Сердце-«heart» из референса (актуально при morph > 0; в текущей сцене m = 0).
  const hp = (t: number, s: number): [number, number] =>
    [16 * Math.sin(t) ** 3 * 12 * s, (-(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 12 - 30) * s];

  function scene(el: number, sway: number) {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2);
    { const d = Math.max(0, el - 7); g.rotate(d < 2 ? .125 * d * d : .5 + .5 * (d - 2)); }
    const m = 0;
    const pos = (f: Flower): [number, number, number] => [lr(f.x, f.hx, m), lr(f.y, f.hy, m), lr(f.sc, .6, m)];
    for (const f of F) { const [x, y, sc] = pos(f); leaves(x, y, sc, clamp((el - f.st) / f.du), sway, f.nl, f.ll, m); }
    if (m > 0) {
      g.save(); g.globalAlpha = m; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 16;
      const hg = g.createRadialGradient(0, -20, 10, 0, 0, 200); hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#b8b8c8');
      g.fillStyle = hg; g.beginPath();
      for (let i = 0; i <= 64; i++) { const [x, y] = hp(i / 64 * 6.2832, 1); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.fill(); g.restore();
    }
    for (const f of F) { const [x, y, sc] = pos(f); head(x, y, sc, lerpPal(f.pal, WHITE, m), f.ty, f.rot, clamp((el - f.st) / f.du), sway, f.sh); }
    g.restore();
  }

  function toAscii() {
    const d = g.getImageData(0, 0, W, H).data;
    o.fillStyle = '#000'; o.fillRect(0, 0, out.width, out.height);
    o.font = '10px "Courier New",monospace'; o.textBaseline = 'top';
    const n = RAMP.length - 1;
    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
      let r = 0, gg = 0, b = 0;
      for (let y = 0; y < CH; y += 2) for (let x = 0; x < CW; x += 2) {
        const i = ((cy * CH + y) * W + cx * CW + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2];
      }
      r /= 16; gg /= 16; b /= 16;
      const lum = (.3 * r + .59 * gg + .11 * b) / 255;
      if (lum < .025) continue;
      const mx = Math.max(r, gg, b), k = 255 / mx, f = .55 + .45 * clamp(lum * 1.8);
      const ch = RAMP[Math.min(n, Math.floor(Math.pow(lum, .75) * n))];
      const mu = (r + gg + b) / 3;
      const cl = (v: number) => Math.max(0, Math.min(255, (mu + (v - mu) * 1.5) * k * f)) | 0;
      o.fillStyle = 'rgb(' + cl(r) + ',' + cl(gg) + ',' + cl(b) + ')';
      o.fillText(ch, cx * 6, cy * 11);
    }
  }

  const t0 = performance.now();

  if (staticFrame) {
    // prefers-reduced-motion: один статичный распустившийся кадр, без анимации.
    scene(9, 0); toAscii();
    return () => {};
  }

  let raf = 0;
  const frame = (now: number) => {
    const el = (now - t0) / 1000;
    scene(el, Math.sin(el * 1.2) * .02); toAscii();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(raf);
}
