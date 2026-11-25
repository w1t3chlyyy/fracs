"""Открытка с QR (дизайн из Figma, 1600×900), анимированный видеообзор сайта и запись mp4.

Что здесь:
  draw_postcard()      — PNG-открытка: тёмный фон с тёплым свечением снизу, QR в «стеклянной»
                         рамке, справа название «…», рубрика оранжевым и подпись.
  render_review_html() — самодостаточная страница-видеообзор (review.html): интро → сайт в
                         окне браузера с плавной прокруткой → мобильная версия → финал.
                         Работает без ffmpeg/playwright, открывается с телефона по QR.
  record_review_mp4()  — (необязательно) записывает ту же страницу в mp4 через playwright+ffmpeg.
  business_parts()     — «Название» и рубрика из промта-карточки.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
except Exception:  # pragma: no cover
    Image = None

try:
    import qrcode
    _HAVE_QR = True
except Exception:  # pragma: no cover
    _HAVE_QR = False

ORANGE = (255, 107, 44)          # #FF6B2C — оранжевый макета
WHITE = (255, 255, 255)
DESC = (195, 173, 163)           # тёплый серо-бежевый текст-подсказка

_HERE = os.path.dirname(os.path.abspath(__file__))
_FONT_DIRS = [os.path.join(_HERE, 'static', 'fonts')]


# ── Шрифты ────────────────────────────────────────────────────────────────────
# Сначала шрифты из static/fonts (Inter, кириллица есть), затем системные пути
# Windows/macOS/Linux. Раньше были только Linux-пути, и на Windows текст открытки
# рисовался встроенным шрифтом без кириллицы.

_FONT_FILES = {
    'display': ['InterDisplay-Medium.otf', 'InterDisplay-SemiBold.otf'],
    'bold': ['InterDisplay-SemiBold.otf'],
    'regular': ['Inter-Regular.otf'],
}
_SYSTEM_FONTS = {
    'display': ['C:/Windows/Fonts/segoeuisl.ttf', 'C:/Windows/Fonts/segoeui.ttf',
                '/System/Library/Fonts/Supplemental/Arial.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
    'bold': ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf',
             '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
             '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
    'regular': ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf',
                '/System/Library/Fonts/Supplemental/Arial.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
}


def load_font(size: int, kind: str = 'display'):
    cands = [os.path.join(d, f) for d in _FONT_DIRS for f in _FONT_FILES.get(kind, [])]
    cands += _SYSTEM_FONTS.get(kind, [])
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ── Название и рубрика ────────────────────────────────────────────────────────

def business_parts(prompt: str) -> tuple[str, str]:
    """(название, рубрика) для открытки. Из карточки 2ГИС: «Название: …» и первая
    рубрика из «Рубрики: …». Если рубрики нет, а название из нескольких слов —
    первое слово становится названием, остальное — подписью (как раньше)."""
    prompt = prompt or ''
    m = re.search(r'^Название:\s*(.+)$', prompt, re.M)
    name = m.group(1).strip() if m else ''
    if not name:
        first = prompt.strip().splitlines()[0] if prompt.strip() else ''
        first = re.sub(r'^(сделай|сделайте|создай|создайте|нужен|нужно|сгенерируй|пожалуйста)'
                       r'[\s,]+(мне\s+)?(сайт|лендинг|страницу|визитку)?[\s,]*', '', first, flags=re.I)
        first = re.sub(r'^(сайт|лендинг|страница)\s+(для|про)\s+', '', first, flags=re.I)
        name = first.strip(' .«»"\'') or 'Сайт'
    name = name.strip(' «»"\'')
    rub = ''
    r = re.search(r'^Рубрики:\s*(.+)$', prompt, re.M)
    if r:
        rub = r.group(1).split(',')[0].strip().lower()
    if not rub and len(name.split()) > 1:
        words = name.split()
        name, rub = words[0], ' '.join(words[1:]).lower()
    if name and name[0].islower():
        name = name[0].upper() + name[1:]
    return name[:40], rub[:40]


def _quoted(name: str) -> str:
    return name if name.startswith('«') else f'«{name}»'


# ── Рисование ─────────────────────────────────────────────────────────────────

def _aa_mask(size, box, radius, scale=4):
    """Сглаженная маска скруглённого прямоугольника (рисуем в 4× и уменьшаем)."""
    w, h = size
    m = Image.new('L', (w * scale, h * scale), 0)
    ImageDraw.Draw(m).rounded_rectangle([v * scale for v in box], radius=radius * scale, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def _background(W, H):
    """Как на макете: сверху почти чёрный, снизу тёплое медное свечение."""
    sw, sh = W // 4, H // 4
    base = Image.new('RGB', (sw, sh), (0, 0, 0))
    px = base.load()
    for y in range(sh):
        t = y / sh
        k = max(0.0, (t - 0.38) / 0.62) ** 1.7          # свечение начинается ниже середины
        for x in range(sw):
            px[x, y] = (int(120 * k) + (int(26 * (x / sw) * (1 - t)) if t < 0.5 else 0), int(52 * k) + (int(11 * (x / sw) * (1 - t)) if t < 0.5 else 0), int(22 * k) + (int(4 * (x / sw) * (1 - t)) if t < 0.5 else 0))
    glow = Image.new('L', (sw, sh), 0)
    gd = ImageDraw.Draw(glow)
    # нижнее левое и нижнее правое «солнце», как на референсе
    gd.ellipse([-sw * 0.25, sh * 0.78, sw * 0.55, sh * 1.55], fill=215)
    gd.ellipse([sw * 0.45, sh * 0.80, sw * 1.2, sh * 1.6], fill=235)
    gd.ellipse([sw * 0.30, sh * 0.92, sw * 0.80, sh * 1.45], fill=150)
    # боковые языки свечения: слева высоко, справа ниже (как на макете)
    gd.ellipse([-sw * 0.38, sh * 0.22, sw * 0.16, sh * 1.0], fill=170)
    gd.ellipse([sw * 0.84, sh * 0.34, sw * 1.34, sh * 1.05], fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(sw * 0.075))
    warm = Image.new('RGB', (sw, sh), (222, 122, 82))
    img = Image.composite(warm, base, glow)
    return img.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2))


def _qr_matrix(target: str):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=1, border=0)
    qr.add_data(target)
    qr.make(fit=True)
    return qr.get_matrix()


def draw_postcard(png_path: str, target: str, title: str, subtitle: str = '') -> None:
    """Открытка 1600×900 по макету Figma (Frame 119)."""
    W, H = 1600, 900
    bg = _background(W, H)
    img = bg.copy()

    # ── QR-блок слева: стеклянная рамка + белая карточка (590 / 536 px) ──
    frame = (98, 155, 688, 745)
    card = (125, 182, 661, 718)
    outer = _aa_mask((W, H), frame, 62)
    inner = _aa_mask((W, H), (frame[0] + 2, frame[1] + 2, frame[2] - 2, frame[3] - 2), 60)
    ring = ImageChops.subtract(outer, inner)
    # рамка прозрачна сверху и становится медно-оранжевой к низу
    grad = Image.new('L', (W, H), 0)
    gp = grad.load()
    for y in range(frame[1], frame[3] + 1):
        a = int(255 * (0.10 + 0.9 * ((y - frame[1]) / (frame[3] - frame[1])) ** 1.4))
        for x in range(frame[0], frame[2] + 1):
            gp[x, y] = a
    ring = ImageChops.multiply(ring, grad)
    img = Image.composite(Image.new('RGB', (W, H), (232, 140, 92)), img, ring)
    # лёгкая «стеклянная» подложка внутри рамки
    tint = _aa_mask((W, H), frame, 62).point(lambda v: int(v * 0.07))
    img = Image.composite(Image.new('RGB', (W, H), (255, 220, 200)), img, tint)
    # белая карточка
    img = Image.composite(Image.new('RGB', (W, H), WHITE), img, _aa_mask((W, H), card, 56))

    if _HAVE_QR:
        mx = _qr_matrix(target)
        n = len(mx)
        mod = max(4, 440 // n)                       # тихая зона вокруг QR ≥ 4 модулей
        side = mod * n
        ox = card[0] + (card[2] - card[0] - side) // 2
        oy = card[1] + (card[3] - card[1] - side) // 2
        d = ImageDraw.Draw(img)
        for r, row in enumerate(mx):
            for c, dark in enumerate(row):
                if not dark:
                    continue
                x0, y0 = ox + c * mod, oy + r * mod
                # «вырезанный» QR: модули берут цвет фона макета (тёмный → медный).
                # Затемняем в 0.55, чтобы контраст к белому остался ≥ 7:1 — сканируется.
                br, bgc, bb = bg.getpixel((x0 + mod // 2, y0 + mod // 2))
                col = (int(br * 0.55), int(bgc * 0.55), int(bb * 0.55))
                d.rectangle([x0, y0, x0 + mod - 1, y0 + mod - 1], fill=col)

    # ── текст справа ──
    d = ImageDraw.Draw(img)
    tx = 780
    max_w = W - tx - 90
    t = _quoted(title or 'Сайт')
    size = 124
    f1 = load_font(size, 'display')
    while d.textlength(t, font=f1) > max_w and size > 46:
        size -= 4
        f1 = load_font(size, 'display')
    cy = 442                                           # центр блока = центр QR
    desc_f = load_font(36, 'regular')
    sub_f = load_font(max(44, int(size * 0.52)), 'display')
    desc = 'Чтобы посмотреть демо-макет сайта - отсканируйте QR-Код'
    lines, line = [], ''
    for w in desc.split():
        cand = (line + ' ' + w).strip()
        if d.textlength(cand, font=desc_f) > max_w - 120 and line:
            lines.append(line)
            line = w
        else:
            line = cand
    if line:
        lines.append(line)
    block_h = size + 18 + (sub_f.size + 26 if subtitle else 14) + len(lines) * 44
    y = cy - block_h // 2
    d.text((tx, y), t, font=f1, fill=WHITE)
    y += size + 18
    if subtitle:
        d.text((tx + 3, y), subtitle, font=sub_f, fill=ORANGE)
        y += sub_f.size + 26
    else:
        y += 14
    for ln in lines[:3]:
        d.text((tx + 3, y), ln, font=desc_f, fill=DESC)
        y += 44
    img.save(png_path, 'PNG', optimize=True)


# ── Видеообзор: анимированная страница ────────────────────────────────────────

def render_review_html(title: str, subtitle: str, site_html: str, date_str: str = '') -> str:
    """Самодостаточная HTML-страница видеообзора. Сайт встраивается через srcdoc,
    поэтому страница работает и локально, и на любом статическом хостинге."""
    site_html = _inject_scroll_hook(site_html or '')
    payload = json.dumps(site_html, ensure_ascii=False).replace('</', '<\\/').replace('<!--', '<\\!--')
    page = _REVIEW_TEMPLATE
    for k, v in (('__TITLE__', _html_esc(_quoted(title or 'Сайт'))),
                 ('__SUB__', _html_esc(subtitle or '')),
                 ('__DATE__', _html_esc(date_str or time.strftime('%d.%m.%Y'))),
                 ('__SITE_JSON__', payload)):
        page = page.replace(k, v)
    return page


_SCROLL_HOOK = ('<script>(function(){function H(){var d=document;return Math.max('
                'd.documentElement.scrollHeight,d.body?d.body.scrollHeight:0)}'
                'addEventListener("message",function(e){var m=e.data;'
                'if(m&&m.fracs==="scroll"){var y=Math.max(0,H()-innerHeight)*m.p;'
                'window.scrollTo({top:y,behavior:"instant"});}});})();</script>')


def _inject_scroll_hook(html: str) -> str:
    """Сайт показывается в iframe БЕЗ allow-same-origin (сгенерированный нейросетью JS
    не должен достать до программы), поэтому прокруткой управляем через postMessage:
    в сайт добавляется крошечный слушатель, который только скроллит окно."""
    m = list(re.finditer(r'</body\s*>', html, flags=re.I))
    if m:
        i = m[-1].start()
        return html[:i] + _SCROLL_HOOK + html[i:]
    return html + _SCROLL_HOOK


def _html_esc(s: str) -> str:
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


_REVIEW_TEMPLATE = r'''<!DOCTYPE html>
<html lang="ru" data-fracs-review="1"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Демо-макет сайта — видеообзор</title>
<style>
:root{--o:#ff6b2c;--bg:#000}
*{box-sizing:border-box;margin:0}
html,body{height:100%;background:var(--bg);overflow:hidden;font-family:"Inter","Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#fff;-webkit-tap-highlight-color:transparent}
#wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
/* сцена в фиксированной системе координат: 1920×1080 (альбом) или 1080×1920 (портрет), масштабируется под экран */
#stage{position:relative;flex:none;overflow:hidden;background:#000;transform-origin:center center}
.land #stage{width:1920px;height:1080px}.port #stage{width:1080px;height:1920px}
.glow{position:absolute;inset:-12%;background:
 radial-gradient(70% 62% at 8% 100%,rgba(214,112,70,.95),transparent 72%),
 radial-gradient(75% 66% at 92% 104%,rgba(226,128,92,.95),transparent 74%),
 radial-gradient(55% 40% at 50% 112%,rgba(190,90,50,.85),transparent 72%),
 linear-gradient(#000 30%,#140703 62%,#2a1207);will-change:transform}
.scene{position:absolute;inset:0;opacity:0;pointer-events:none;will-change:opacity,transform}
/* интро и финал */
.hero{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 8%}
.hero .name{font-weight:500;letter-spacing:-.02em;line-height:1.02;will-change:transform,opacity}
.land .hero .name{font-size:170px}.port .hero .name{font-size:128px}
.hero .rub{color:var(--o);font-weight:500;margin-top:.2em;will-change:transform,opacity}
.land .hero .rub{font-size:84px}.port .hero .rub{font-size:70px}
.hero .cap{color:#c3ada3;margin-top:44px;font-weight:400;letter-spacing:.01em}
.land .hero .cap{font-size:38px}.port .hero .cap{font-size:34px}
.hero .line{height:5px;background:var(--o);border-radius:3px;margin-bottom:46px;width:0}
.hero .date{position:absolute;bottom:70px;left:0;right:0;font-size:26px;color:#8a7468}
/* окно браузера и телефон */
.dev{position:absolute;left:50%;top:50%;will-change:transform,opacity}
.browser{background:#15110f;border-radius:26px;box-shadow:0 60px 140px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.08);overflow:hidden}
.land .browser{width:1440px;height:810px;margin:-500px 0 0 -720px}
.port .browser{width:980px;height:640px;margin:-420px 0 0 -490px}
.bar{height:56px;display:flex;align-items:center;gap:10px;padding:0 22px;background:#211a16}
.bar i{width:14px;height:14px;border-radius:50%;background:#4a3d36}.bar i:nth-child(1){background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
.bar b{margin-left:18px;flex:1;max-width:560px;height:30px;border-radius:15px;background:#0f0b09;color:#9b8579;font:500 15px/30px inherit;font-family:inherit;text-align:center}
.view{position:relative;overflow:hidden;background:#fff}
.land .view{height:754px}.port .view{height:584px}
.view iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;background:#fff}
.phone{background:#0d0a09;border-radius:78px;padding:20px;box-shadow:0 60px 140px rgba(0,0,0,.7),0 0 0 3px #3a2f29,inset 0 0 0 2px #1d1612}
.land .phone{width:390px;height:810px;margin:-500px 0 0 -195px}
.port .phone{width:520px;height:1060px;margin:-560px 0 0 -260px}
.phone .view{width:100%;height:100%;border-radius:58px}
.phone .notch{position:absolute;top:30px;left:50%;width:150px;height:34px;margin-left:-75px;background:#0d0a09;border-radius:20px;z-index:3}
.tag{position:absolute;left:0;right:0;text-align:center;color:#d8c3b8;font-weight:500;letter-spacing:.02em}
.land .tag{bottom:64px;font-size:34px}.port .tag{bottom:90px;font-size:38px}
.tag span{color:var(--o)}
/* управление */
#ui{position:fixed;left:0;right:0;bottom:0;padding:14px 18px calc(14px + env(safe-area-inset-bottom,0px));display:flex;gap:14px;align-items:center;opacity:1;transition:opacity .4s;background:linear-gradient(transparent,rgba(0,0,0,.55))}
#ui.hide{opacity:0}
#pb{width:46px;height:46px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:18px;cursor:pointer}
#track{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.2);overflow:hidden}#fill{height:100%;width:0;background:var(--o)}
.rec #ui{display:none}
</style></head>
<body>
<div id="wrap"><div id="stage">
  <div class="glow" id="glow"></div>
  <section class="scene hero" id="s1">
    <div class="line" id="i-line"></div>
    <div class="name" id="i-name">__TITLE__</div>
    <div class="rub" id="i-rub">__SUB__</div>
    <div class="cap" id="i-cap">Демо-макет сайта</div>
    <div class="date">__DATE__</div>
  </section>
  <section class="scene" id="s2">
    <div class="dev browser" id="d-browser"><div class="bar"><i></i><i></i><i></i><b>ваш-сайт.ru</b></div><div class="view" id="v-desk"><iframe id="f-desk" title="Версия для компьютера"></iframe></div></div>
    <div class="tag" id="t-desk">Так выглядит сайт <span>на компьютере</span></div>
  </section>
  <section class="scene" id="s3">
    <div class="dev phone" id="d-phone"><div class="notch"></div><div class="view" id="v-phone"><iframe id="f-phone" title="Мобильная версия"></iframe></div></div>
    <div class="tag" id="t-phone">И <span>на телефоне</span> — адаптивно</div>
  </section>
  <section class="scene hero" id="s4">
    <div class="line" id="o-line"></div>
    <div class="name" id="o-name" style="font-size:150px">Ваш сайт готов</div>
    <div class="cap" id="o-cap">__TITLE__ __SUB__</div>
  </section>
</div></div>
<div id="ui"><button id="pb" aria-label="Пауза">❚❚</button><div id="track"><div id="fill"></div></div></div>
<script id="site-data" type="application/json">__SITE_JSON__</script>
<script>
(function(){
var q=new URLSearchParams(location.search), REC=q.has('record');
var $=function(i){return document.getElementById(i)};
var SITE=JSON.parse($('site-data').textContent);
var wrap=$('wrap'),stage=$('stage');
if(REC)document.documentElement.classList.add('rec');
var port=false;
function fit(){
  port=(innerHeight>innerWidth*1.1)&&!REC;
  wrap.className=port?'port':'land';
  var w=port?1080:1920,h=port?1920:1080;
  stage.style.transform='scale('+Math.min(innerWidth/w,innerHeight/h)+')';
  layout();
}
// длительности сцен, сек
var D=[3.4,12,9.5,3.8],X=.6, TOTAL=D.reduce(function(a,b){return a+b},0);
var starts=[0,D[0],D[0]+D[1],D[0]+D[1]+D[2]];
function cl(x,a,b){return Math.max(a===undefined?0:a,Math.min(b===undefined?1:b,x))}
function eo(t){return 1-Math.pow(1-t,3)}           // easeOutCubic
function eio(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2}
function sine(t){return .5-.5*Math.cos(Math.PI*t)}
var fd=$('f-desk'),fp=$('f-phone'),loaded=0;
function setup(f,w){f.setAttribute('sandbox','allow-scripts');f.srcdoc=SITE;f.addEventListener('load',function(){loaded++;layout();});}
function layout(){
  // виртуальные вьюпорты: десктоп 1366 px шириной, телефон 390 px
  var vd=$('v-desk'),vp=$('v-phone');
  var kd=vd.clientWidth/1366; fd.style.width='1366px'; fd.style.height=(vd.clientHeight/kd)+'px'; fd.style.transform='scale('+kd+')';
  var kp=vp.clientWidth/390;  fp.style.width='390px';  fp.style.height=(vp.clientHeight/kp)+'px'; fp.style.transform='scale('+kp+')';
}
function scrollTo(f,p){            // p 0..1 → плавная прокрутка с паузой в начале и конце
  try{ f.contentWindow.postMessage({fracs:'scroll',p:sine(cl((p-.07)/.86))},'*'); }catch(e){}
}
var scenes=[$('s1'),$('s2'),$('s3'),$('s4')];
function render(t){
  var i=0; for(var k=0;k<4;k++) if(t>=starts[k]) i=k;
  var lt=t-starts[i], p=lt/D[i];
  for(var k=0;k<4;k++){
    var s=scenes[k], a=0;
    if(k===i){ a=cl(lt/X)*(k===3?1:cl((D[k]-lt)/X)); }
    else if(k===i-1){ a=0; }
    s.style.opacity=a; s.style.visibility=a>0?'visible':'hidden';
  }
  var gl=$('glow'); gl.style.transform='translate3d('+(Math.sin(t*.35)*40)+'px,'+(Math.cos(t*.28)*24)+'px,0) scale('+(1.04+Math.sin(t*.2)*.02)+')';
  if(i===0){        // интро: линия, имя, рубрика, подпись по очереди
    $('i-line').style.width=(eo(cl(lt/.9))*(port?260:360))+'px';
    var n=$('i-name');n.style.opacity=eo(cl((lt-.25)/.8));n.style.transform='translateY('+(50*(1-eo(cl((lt-.25)/.8))))+'px)';
    var r=$('i-rub');r.style.opacity=eo(cl((lt-.7)/.8));r.style.transform='translateY('+(40*(1-eo(cl((lt-.7)/.8))))+'px)';
    var c=$('i-cap');c.style.opacity=eo(cl((lt-1.3)/.8));
  }
  if(i===1){        // окно браузера: наезд с лёгким 3D-наклоном
    var e=eo(cl(lt/1.1)), b=$('d-browser'), z=.88+.12*e+p*.03;
    b.style.transform='perspective(2200px) rotateX('+(9*(1-e))+'deg) translateY('+(70*(1-e))+'px) scale('+z+')';
    b.style.opacity=e;
    var tg=$('t-desk');tg.style.opacity=eo(cl((lt-.8)/.8));
    scrollTo(fd,cl((lt-.9)/(D[1]-1.6)));
  }
  if(i===2){        // телефон: въезжает снизу и скроллит
    var e2=eo(cl(lt/1.0)), ph=$('d-phone');
    ph.style.transform='translateY('+(140*(1-e2))+'px) rotate('+(-3*(1-e2))+'deg) scale('+(.94+.06*e2+p*.02)+')';
    ph.style.opacity=e2;
    $('t-phone').style.opacity=eo(cl((lt-.7)/.8));
    scrollTo(fp,cl((lt-.8)/(D[2]-1.5)));
  }
  if(i===3){
    $('o-line').style.width=(eo(cl(lt/.8))*(port?260:360))+'px';
    var o=$('o-name');o.style.opacity=eo(cl((lt-.2)/.8));o.style.transform='translateY('+(40*(1-eo(cl((lt-.2)/.8))))+'px)';
    $('o-cap').style.opacity=eo(cl((lt-.8)/.8));
  }
  $('fill').style.width=(t/TOTAL*100)+'%';
}
var t=Math.max(0,parseFloat(q.get('t'))||0),playing=true,last=0,done=false,hideT=0;
function loop(now){
  if(!last)last=now;
  var dt=Math.min(.1,(now-last)/1000); last=now;
  // не стартуем прокрутку, пока сайт не загрузился в оба окна
  if(playing&&(loaded>=2||t<D[0]||now>8000))t+=dt;
  if(t>=TOTAL){ t=TOTAL; if(!done){done=true;window.__done=true;} if(!REC){ playing=false;$('pb').textContent='↻'; } }
  render(t); requestAnimationFrame(loop);
}
$('pb').addEventListener('click',function(ev){ev.stopPropagation();
  if(t>=TOTAL){t=0;done=false;playing=true;$('pb').textContent='❚❚';return;}
  playing=!playing;$('pb').textContent=playing?'❚❚':'▶';});
stage.addEventListener('click',function(){ $('ui').classList.toggle('hide'); });
addEventListener('keydown',function(e){if(e.code==='Space'){e.preventDefault();$('pb').click();}});
addEventListener('resize',fit);
setup(fd);setup(fp);fit();
setTimeout(function(){$('ui').classList.add('hide')},6000);
requestAnimationFrame(loop);
window.__total=TOTAL;
})();
</script></body></html>
'''


# ── Запись mp4 (необязательно: нужны playwright + ffmpeg) ─────────────────────

def record_review_mp4(review_url: str, out_mp4: str, total_s: float = 30.0) -> bool:
    """Записывает страницу видеообзора в mp4 1920×1080. Возвращает True при успехе.
    Бросает исключение, если нет playwright/браузера."""
    from playwright.sync_api import sync_playwright
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        return False
    tmp = tempfile.mkdtemp(prefix='fracs_rec_')
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(args=['--no-sandbox', '--disable-gpu'])
            try:
                ctx = br.new_context(viewport={'width': 1920, 'height': 1080},
                                     record_video_dir=tmp,
                                     record_video_size={'width': 1920, 'height': 1080})
                page = ctx.new_page()
                t0 = time.time()
                page.goto(review_url + ('&' if '?' in review_url else '?') + 'record=1',
                          wait_until='load', timeout=30000)
                lead = time.time() - t0
                page.wait_for_function('window.__done===true', timeout=int((total_s + 40) * 1000))
                page.wait_for_timeout(400)
                webm = page.video.path()
                ctx.close()
            finally:
                br.close()
        subprocess.run([ffmpeg, '-y', '-ss', f'{max(0.0, lead - 0.3):.2f}', '-i', webm,
                        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
                        '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out_mp4],
                       check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return os.path.exists(out_mp4) and os.path.getsize(out_mp4) > 100_000
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
