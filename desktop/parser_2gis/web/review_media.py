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

_GREETING_RE = re.compile(
    r'^(привет(ству[ею]м|ствую)?|здравствуй(те)?|добрый\s+(день|вечер|утро)|'
    r'доброго\s+времени\s+суток|hi|hello|hey|здаров)\b[!,.\s]*$',
    re.I,
)
_CMD_LEAD_RE = re.compile(
    r'^(?:нужно\s+|хочу\s+|можно\s+)?'
    r'(?:сделай(?:те)?|создай(?:те)?|собери(?:те)?|напиши(?:те)?|сверстай(?:те)?|'
    r'разработай(?:те)?|сгенерируй(?:те)?|нужен|нужна|нужно|пожалуйста)'
    r'(?:[\s,:-]+(?:мне|нам|пожалуйста))*[\s,:-]*',
    re.I,
)
_SITE_NOUN_RE = re.compile(
    r'^(?:(?:одностраничный|современный|стильный|красивый|простой|лаконичный|'
    r'продающий|премиальный|минималистичный|лёгкий|легкий|быстрый|крутой|хороший|'
    r'адаптивный|небольшой)\s+)*'
    r'(?:сайт-визитку|сайт-визитка|сайт-лендинг|одностраничник|веб-сайт|'
    r'сайт|лендинг|страницу|страничку|визитку|макет|промо-сайт)\b[\s,:-]*',
    re.I,
)
_PREP_LEAD_RE = re.compile(
    r'^(?:для|про|об?|по|под|на\s+тему|бизнеса|компании|фирмы|проекта)\b[\s,:-]*',
    re.I,
)
_CITY_IN_RE = re.compile(
    r'\b(?:в|г\.?)\s+([А-ЯЁ][а-яё-]+(?:-[А-ЯЁ]?[а-яё]+)?)\b'
)
_GENITIVE_CATS: tuple[tuple[str, tuple[str, str]], ...] = (
    ('автосервис', ('Автосервис', 'ремонт и обслуживание')),
    ('детейлинг', ('Детейлинг', 'уход за авто')),
    ('шиномонтаж', ('Шиномонтаж', 'автоуслуги')),
    ('автомойк', ('Автомойка', 'уход за авто')),
    ('стоматолог', ('Стоматология', 'клиника и запись')),
    ('ветклиник', ('Ветклиника', 'ветеринария')),
    ('ветеринар', ('Ветклиника', 'ветеринария')),
    ('медцентр', ('Медцентр', 'медицинские услуги')),
    ('клиник', ('Клиника', 'медицина')),
    ('косметолог', ('Косметология', 'эстетика и уход')),
    ('кофейн', ('Кофейня', 'кофе и выпечка')),
    ('пекарн', ('Пекарня', 'свежая выпечка')),
    ('кондитерск', ('Кондитерская', 'десерты на заказ')),
    ('ресторан', ('Ресторан', 'кухня и бронь')),
    ('пиццери', ('Пиццерия', 'доставка и зал')),
    ('суши', ('Суши-бар', 'доставка и зал')),
    ('кафе', ('Кафе', 'меню и бронь')),
    ('барбершоп', ('Барбершоп', 'стрижки и бритьё')),
    ('салон красоты', ('Салон красоты', 'уход и запись')),
    ('парикмахерск', ('Парикмахерская', 'стрижки и укладка')),
    ('маникюр', ('Студия маникюра', 'ногтевой сервис')),
    ('ногтев', ('Ногтевая студия', 'маникюр и уход')),
    ('массаж', ('Студия массажа', 'оздоровление')),
    ('спа', ('SPA-салон', 'отдых и уход')),
    ('фитнес', ('Фитнес-клуб', 'тренировки')),
    ('строительств', ('Строительство', 'проекты и смета')),
    ('строительн', ('Стройкомпания', 'проекты и ремонт')),
    ('ремонт', ('Ремонт', 'услуги и расчёт')),
    ('мебел', ('Мебель', 'на заказ')),
    ('недвижимост', ('Недвижимость', 'подбор и сделки')),
    ('юридическ', ('Юридические услуги', 'консультации')),
    ('юрист', ('Юридические услуги', 'консультации')),
    ('адвокат', ('Адвокат', 'правовая помощь')),
    ('фотостуди', ('Фотостудия', 'съёмка и аренда')),
    ('типограф', ('Типография', 'печать и тиражи')),
    ('химчистк', ('Химчистка', 'уход за вещами')),
    ('ателье', ('Ателье', 'пошив и ремонт')),
    ('доставк', ('Доставка', 'быстрый заказ')),
    ('отел', ('Отель', 'бронирование')),
    ('гостиниц', ('Гостиница', 'бронирование')),
    ('школ', ('Школа', 'обучение')),
    ('курс', ('Курсы', 'обучение')),
    ('магазин', ('Магазин', 'каталог товаров')),
    ('студи', ('Студия', 'услуги')),
    ('салон', ('Салон', 'услуги и запись')),
)
_GENERIC_TITLES = {'сайт', 'главная', 'лендинг', 'демо', 'демо-макет', 'untitled', 'document'}


def _strip_prompt_lead(text: str) -> str:
    s = re.sub(r'\s+', ' ', (text or '')).strip()
    for _ in range(4):
        prev = s
        s = _CMD_LEAD_RE.sub('', s)
        s = _SITE_NOUN_RE.sub('', s)
        s = _PREP_LEAD_RE.sub('', s)
        if s == prev:
            break
    return s.strip(' .«»"\':,-')


def _normalize_category_phrase(text: str) -> tuple[str, str]:
    low = (text or '').lower()
    for stem, pair in _GENITIVE_CATS:
        if stem in low:
            return pair
    return '', ''


def _clean_brand_from_html(html: str) -> str:
    if not html:
        return ''
    m = re.search(r'<title[^>]*>([^<]{2,120})</title>', html, re.I)
    if not m:
        return ''
    raw = re.sub(r'\s+', ' ', m.group(1)).strip()
    qm = re.search(r'[«"]([^«"]{2,36})[»"]', raw)
    if qm:
        cand = qm.group(1).strip()
        if cand.lower() not in _GENERIC_TITLES:
            return cand
    head = re.split(r'\s+[—–|-]\s+', raw, maxsplit=1)[0].strip(' «»"\'')
    if head and head.lower() not in _GENERIC_TITLES and len(head) <= 36:
        return head
    return ''


_EDIT_COMPLAINT_RE = re.compile(
    r'\b(?:не\s+прогружа|не\s+загружа|не\s+работа|сломал|биты[ей]|ошибк|исправ|поправ|измен|передел|замен|обнов|убер|удал|добав|сделай\s+(?:шире|уже|светлее|темнее|крупнее|мельче))',
    re.I,
)

_CITY_PREP_MAP = {
    'москве': 'Москва', 'санкт-петербурге': 'Санкт-Петербург', 'петербурге': 'Петербург',
    'питере': 'Санкт-Петербург', 'казани': 'Казань', 'екатеринбурге': 'Екатеринбург',
    'новосибирске': 'Новосибирск', 'краснодаре': 'Краснодар', 'сочи': 'Сочи',
    'нижнем новгороде': 'Нижний Новгород', 'ростове-на-дону': 'Ростов-на-Дону',
    'самаре': 'Самара', 'уфе': 'Уфа', 'перми': 'Пермь', 'воронеже': 'Воронеж',
    'волгограде': 'Волгоград', 'челябинске': 'Челябинск', 'омске': 'Омск',
    'тюмени': 'Тюмень', 'калининграде': 'Калининград', 'владивостоке': 'Владивосток',
    'иркутске': 'Иркутск', 'томске': 'Томск', 'туле': 'Тула', 'рязани': 'Рязань',
    'ярославле': 'Ярославль', 'саратове': 'Саратов', 'барнауле': 'Барнаул',
    'хабаровске': 'Хабаровск', 'кемерове': 'Кемерово', 'астрахани': 'Астрахань',
    'ставрополе': 'Ставрополь', 'белгороде': 'Белгород', 'калуге': 'Калуга',
    'твери': 'Тверь', 'пензе': 'Пенза', 'кирове': 'Киров', 'липецке': 'Липецк',
    'курске': 'Курск', 'красноярске': 'Красноярск', 'ижевске': 'Ижевск',
    'ульяновске': 'Ульяновск', 'оренбурге': 'Оренбург', 'тольятти': 'Тольятти',
}


def _norm_city_name(raw_city: str) -> str:
    c = (raw_city or '').strip()
    if not c:
        return ''
    mapped = _CITY_PREP_MAP.get(c.lower())
    if mapped:
        return mapped
    return c


def business_parts(prompt: str, html: str = '', brief: dict | None = None) -> tuple[str, str]:
    """(название, рубрика) для открытки и видеообзора."""
    prompt = prompt or ''
    m = re.search(r'^Название:\s*(.+)$', prompt, re.M)
    card_name = m.group(1).strip(' «»"\'') if m else ''
    r = re.search(r'^Рубрики:\s*(.+)$', prompt, re.M)
    rub = r.group(1).split(',')[0].strip().lower() if r else ''
    city_m = re.search(r'^Город:\s*(.+)$', prompt, re.M)
    city = _norm_city_name(city_m.group(1).strip() if city_m else '')

    if card_name:
        name = card_name
        if not rub and city:
            rub = city
        elif not rub and len(name) > 26 and len(name.split()) > 1:
            words = name.split()
            name, rub = words[0], ' '.join(words[1:]).lower()
        if name and name[0].islower():
            name = name[0].upper() + name[1:]
        return name[:40], rub[:36]

    lines = [ln.strip() for ln in prompt.splitlines() if ln.strip()]
    first = ''
    for ln in lines:
        if _GREETING_RE.match(ln):
            continue
        first = ln
        break

    cleaned = _strip_prompt_lead(first)
    is_complaint = bool(_EDIT_COMPLAINT_RE.search(first))
    quoted_m = re.search(r'[«"]([^«"]{2,36})[»"]', first)
    cat_title, cat_sub = _normalize_category_phrase(cleaned or first)

    if not city:
        cm = _CITY_IN_RE.search(first)
        if cm and cm.group(1).lower() not in ('стиле', 'тему', 'формате', 'цветах', 'тонах', 'редакции'):
            city = _norm_city_name(cm.group(1))

    if quoted_m and not is_complaint:
        name = quoted_m.group(1).strip()
        if not rub:
            rub = (cat_title.lower() if cat_title else '') or city
    elif cat_title:
        html_brand = _clean_brand_from_html(html)
        if html_brand and cat_title.lower() not in html_brand.lower() and len(html_brand) <= 26:
            name = html_brand
            rub = f'{city} · {cat_title.lower()}' if city else cat_title.lower()
        else:
            name = cat_title
            if city:
                rub = f'{city} · {cat_sub}' if cat_sub and len(city) + len(cat_sub) <= 30 else city
            elif 'прайс' in first.lower():
                rub = 'прайс-лист и услуги'
            else:
                rub = cat_sub
    else:
        html_brand = _clean_brand_from_html(html)
        if is_complaint:
            name = html_brand or 'Сайт'
            rub = city or ''
        else:
            core = re.split(
                r'[,;]|\s+(?:с|со|без|в\s+стиле|под\s+ключ|чтобы|где|как|и\s+блоком|и\s+формой|и\s+прайсом)\b',
                cleaned,
                maxsplit=1,
                flags=re.I,
            )[0].strip(' .«»"\':,-')
            words = core.split()
            if html_brand:
                name = html_brand
                rub = city or (' '.join(words[:3]).lower() if words else '')
            elif len(words) > 3:
                name = ' '.join(words[:2])
                rub = city or ' '.join(words[2:5]).lower()
            else:
                name = core or 'Сайт'
                rub = city or ''

    if not rub and isinstance(brief, dict):
        eyebrow = str((brief.get('hero') or {}).get('eyebrow') or '').strip()
        if eyebrow and len(eyebrow) <= 32 and eyebrow.lower() != name.lower():
            rub = eyebrow.lower()
        elif not rub:
            cat_b, sub_b = _normalize_category_phrase(str(brief.get('positioning') or ''))
            if sub_b:
                rub = sub_b
            elif cat_b and cat_b.lower() != name.lower():
                rub = cat_b.lower()

    if not rub and is_complaint:
        probe = name
        if html:
            h1_m = re.search(r'<h1[^>]*>([^<]{3,60})</h1>', html, re.I)
            if h1_m:
                probe += ' ' + re.sub(r'\s+', ' ', h1_m.group(1)).strip()
        cat_h, sub_h = _normalize_category_phrase(probe)
        if sub_h:
            rub = sub_h

    if name and name[0].islower():
        name = name[0].upper() + name[1:]
    return name[:40], rub[:36]


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
        fade_top = max(0.0, 1.0 - t * 2.0)              # плавно сходит в 0 к середине без полосы
        for x in range(sw):
            xr = x / sw
            px[x, y] = (
                int(120 * k) + int(22 * xr * fade_top),
                int(52 * k) + int(9 * xr * fade_top),
                int(22 * k) + int(4 * xr * fade_top),
            )
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
                # Затемняем в 0.42, чтобы контраст к белому оставался высоким и считывался любой камерой.
                br, bgc, bb = bg.getpixel((x0 + mod // 2, y0 + mod // 2))
                col = (int(br * 0.42), int(bgc * 0.42), int(bb * 0.42))
                d.rectangle([x0, y0, x0 + mod - 1, y0 + mod - 1], fill=col)

    # ── текст справа ──
    d = ImageDraw.Draw(img)
    tx = 780
    max_w = W - tx - 90

    def _wrap_fit(text: str, start_sz: int, min_sz: int, kind: str, max_lines: int = 2) -> tuple[list[str], object, int]:
        sz = start_sz
        f = load_font(sz, kind)
        while d.textlength(text, font=f) > max_w and sz > min_sz:
            sz -= 4
            f = load_font(sz, kind)
        if d.textlength(text, font=f) <= max_w:
            return [text], f, sz
        wrapped, cur = [], ''
        for w in text.split():
            cand = (cur + ' ' + w).strip()
            if d.textlength(cand, font=f) > max_w and cur:
                wrapped.append(cur)
                cur = w
            else:
                cur = cand
        if cur:
            wrapped.append(cur)
        if len(wrapped) > max_lines:
            wrapped = wrapped[:max_lines]
            last = wrapped[-1]
            while len(last) > 3 and d.textlength(last + '…', font=f) > max_w:
                last = last[:-1].rstrip()
            wrapped[-1] = last + '…'
        return wrapped, f, sz

    t = _quoted(title or 'Сайт')
    t_lines, f1, size = _wrap_fit(t, 124, 48, 'display', max_lines=2)
    t_step = int(size * 1.12)

    sub_lines, sub_f, sub_sz = ([], None, 0)
    if subtitle:
        sub_lines, sub_f, sub_sz = _wrap_fit(subtitle, max(40, min(58, int(size * 0.50))), 28, 'display', max_lines=2)
    sub_step = int(sub_sz * 1.18) if sub_lines else 0

    cy = 442                                           # центр блока = центр QR
    desc_f = load_font(36, 'regular')
    desc = 'Чтобы посмотреть демо-макет сайта — отсканируйте QR-код'
    lines, line = [], ''
    for w in desc.split():
        cand = (line + ' ' + w).strip()
        if d.textlength(cand, font=desc_f) > max_w - 80 and line:
            lines.append(line)
            line = w
        else:
            line = cand
    if line:
        lines.append(line)

    block_h = len(t_lines) * t_step + 16 + (len(sub_lines) * sub_step + 24 if sub_lines else 14) + len(lines) * 44
    y = cy - block_h // 2
    for ln in t_lines:
        d.text((tx, y), ln, font=f1, fill=WHITE)
        y += t_step
    y += 16
    if sub_lines and sub_f is not None:
        for ln in sub_lines:
            d.text((tx + 3, y), ln, font=sub_f, fill=ORANGE)
            y += sub_step
        y += 24
    else:
        y += 14
    for ln in lines[:3]:
        d.text((tx + 3, y), ln, font=desc_f, fill=DESC)
        y += 44
    img.save(png_path, 'PNG', optimize=True)


# ── Видеообзор: анимированная страница ────────────────────────────────────────

_FALLBACK_REVIEW_SITE_CSS = (
    '<style data-fracs-review-fallback="1">'
    ':root{--bg:#f7f4ee;--surface:#fffdf9;--line:rgba(28,24,20,.12);--text:#1c1814;--muted:#685f56;--accent:#b4481e;--accent-contrast:#fff}'
    '*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font:400 16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-x:hidden}'
    'a{color:inherit;text-decoration:none}img,svg{max-width:100%;height:auto}'
    'header,.topbar{border-bottom:1px solid var(--line);padding:16px 24px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}'
    'nav,.nav-links{display:flex;flex-wrap:wrap;gap:18px;align-items:center}'
    'section{padding:clamp(48px,6vw,84px) clamp(18px,4vw,32px)}'
    '.container,.wrap{width:100%;max-width:1180px;margin:0 auto;padding:0 clamp(18px,4vw,32px)}'
    'h1,h2,h3{margin:0 0 12px;line-height:1.08;letter-spacing:-.02em}h1{font-size:clamp(2rem,4.8vw,3.6rem)}h2{font-size:clamp(1.5rem,3vw,2.3rem)}'
    'p{margin:0 0 14px;color:var(--muted)}'
    '.btn,button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:11px 22px;border-radius:8px;background:var(--accent);color:var(--accent-contrast);border:1px solid transparent;font:600 15px/1 inherit;cursor:pointer}'
    '.hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px;align-items:center}'
    '.rowp{display:flex;align-items:baseline;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.rowp i{flex:1;border-bottom:1px dotted var(--line)}'
    'footer,.footer{border-top:1px solid var(--line);padding:32px 24px;color:var(--muted);font-size:14px}'
    '</style>'
)

_VISIBLE_GUARD_CSS = (
    '<style data-fracs-review-vis="1">'
    '.js .r,.r,.reveal,[data-reveal],[data-aos]{opacity:1!important;transform:none!important}'
    '</style>'
)


def _has_usable_site_css(html: str) -> bool:
    styles = re.findall(r'<style(?![^>]*data-fracs-(?:base|review-vis))[^>]*>([\s\S]*?)</style>', html or '', re.I)
    if not styles:
        return False
    cleaned = re.sub(r'/\*[\s\S]*?\*/', '', '\n'.join(styles))
    cleaned = re.sub(r'\s+', '', cleaned)
    return len(cleaned) >= 60 and '{' in cleaned and '}' in cleaned


def _heal_review_site_html(site_html: str) -> str:
    out = site_html or ''
    if re.search(r'<style\b', out, re.I) and not re.search(r'</style>', out, re.I):
        if re.search(r'<body\b', out, re.I):
            out = re.sub(r'(<body\b)', '</style>\n</head>\n\\1', out, count=1, flags=re.I)
        else:
            out += '\n</style>'
    out = re.sub(r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*href=["\'](?!https?://)[^"\']+["\'][^>]*>', '', out, flags=re.I)
    if not _has_usable_site_css(out):
        if re.search(r'</head>', out, re.I):
            out = re.sub(r'</head>', _FALLBACK_REVIEW_SITE_CSS + '\n</head>', out, count=1, flags=re.I)
        elif re.search(r'<head[^>]*>', out, re.I):
            out = re.sub(r'(<head[^>]*>)', r'\1\n' + _FALLBACK_REVIEW_SITE_CSS, out, count=1, flags=re.I)
        else:
            out = _FALLBACK_REVIEW_SITE_CSS + out
    if 'data-fracs-review-vis' not in out:
        if re.search(r'</head>', out, re.I):
            out = re.sub(r'</head>', _VISIBLE_GUARD_CSS + '\n</head>', out, count=1, flags=re.I)
        else:
            out = _VISIBLE_GUARD_CSS + out
    return out


def render_review_html(title: str, subtitle: str, site_html: str, date_str: str = '') -> str:
    """Самодостаточная HTML-страница видеообзора. Сайт встраивается через srcdoc,
    поэтому страница работает и локально, и на любом статическом хостинге."""
    site_html = _inject_scroll_hook(_heal_review_site_html(site_html or ''))
    payload = (
        json.dumps(site_html, ensure_ascii=False)
        .replace('<', '\\u003c')
        .replace('>', '\\u003e')
        .replace('&', '\\u0026')
        .replace('\u2028', '\\u2028')
        .replace('\u2029', '\\u2029')
    )
    page = _REVIEW_TEMPLATE
    for k, v in (('__TITLE__', _html_esc(_quoted(title or 'Сайт'))),
                 ('__SUB__', _html_esc(subtitle or '')),
                 ('__DATE__', _html_esc(date_str or time.strftime('%d.%m.%Y'))),
                 ('__SITE_JSON__', payload)):
        page = page.replace(k, v)
    return page


_SAFE_STORAGE_SHIM = (
    '<script>(function(){'
    'function mk(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},'
    'setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}};}'
    'try{var x=window.localStorage;if(x)x.getItem("_");}catch(e){try{Object.defineProperty(window,"localStorage",{value:mk()})}catch(_){}}'
    'try{var y=window.sessionStorage;if(y)y.getItem("_");}catch(e){try{Object.defineProperty(window,"sessionStorage",{value:mk()})}catch(_){}}'
    '})();</script>'
)

_SCROLL_HOOK = (
    '<script>(function(){'
    'function H(){var d=document;return Math.max(d.documentElement.scrollHeight,d.body?d.body.scrollHeight:0)}'
    'addEventListener("message",function(e){var m=e.data;'
    'if(m&&m.fracs==="scroll"){var y=Math.max(0,H()-innerHeight)*m.p;'
    'window.scrollTo({top:y,behavior:"instant"});}});'
    'function showAll(){document.querySelectorAll(".r,.reveal,[data-reveal],[data-aos],section,main,.hero").forEach(function(el){'
    'if(getComputedStyle(el).opacity==="0"){el.classList.add("in","visible","is-visible","aos-animate");el.style.opacity="1";el.style.transform="none";}});}'
    'showAll();setTimeout(showAll,200);setTimeout(showAll,850);'
    '})();</script>'
)


def _inject_scroll_hook(html: str) -> str:
    """Сайт показывается в iframe БЕЗ allow-same-origin (сгенерированный нейросетью JS
    не должен достать до программы), поэтому прокруткой управляем через postMessage,
    а в <head> кладём мягкий полифилл storage от SecurityError в sandbox."""
    out = html or ''
    hm = re.search(r'<head[^>]*>', out, flags=re.I)
    if hm:
        pos = hm.end()
        out = out[:pos] + _SAFE_STORAGE_SHIM + out[pos:]
    else:
        out = _SAFE_STORAGE_SHIM + out
    m = list(re.finditer(r'</body\s*>', out, flags=re.I))
    if m:
        i = m[-1].start()
        return out[:i] + _SCROLL_HOOK + out[i:]
    return out + _SCROLL_HOOK


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
#stage{position:relative;flex:none;overflow:hidden;background:#000;transform-origin:center center;width:100%;height:100%}
.land #stage{width:1920px;height:1080px}.port #stage{width:1080px;height:1920px}
/* фолбэк без JS: интро видно крупным шрифтом по всему экрану */
.hero .name{font-size:clamp(44px,9vw,96px)}.hero .rub{font-size:clamp(26px,5vw,44px)}
.hero .cap{font-size:clamp(16px,3vw,24px)}.hero .line{width:200px}
.glow{position:absolute;inset:-12%;background:
 radial-gradient(70% 62% at 8% 100%,rgba(214,112,70,.95),transparent 72%),
 radial-gradient(75% 66% at 92% 104%,rgba(226,128,92,.95),transparent 74%),
 radial-gradient(55% 40% at 50% 112%,rgba(190,90,50,.85),transparent 72%),
 linear-gradient(#000 30%,#140703 62%,#2a1207);will-change:transform}
.scene{position:absolute;inset:0;opacity:0;pointer-events:none;will-change:opacity,transform}
/* интро и финал */
.hero{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 8%}
.hero .name{font-weight:500;letter-spacing:-.02em;line-height:1.04;max-width:100%;word-break:break-word;will-change:transform,opacity}
.land .hero .name{font-size:150px}.port .hero .name{font-size:112px}
.hero .rub{color:var(--o);font-weight:500;margin-top:.22em;max-width:100%;will-change:transform,opacity}
.land .hero .rub{font-size:74px}.port .hero .rub{font-size:58px}
.hero .cap{color:#c3ada3;margin-top:44px;font-weight:400;letter-spacing:.01em}
.land .hero .cap{font-size:38px}.port .hero .cap{font-size:34px}
.hero .line{height:5px;background:var(--o);border-radius:3px;margin-bottom:46px;width:0}
.hero .date{position:absolute;bottom:70px;left:0;right:0;font-size:26px;color:#8a7468}
.port .hero .date{bottom:260px}
/* окно браузера и телефон */
.dev{position:absolute;left:50%;top:50%;will-change:transform,opacity}
.browser{background:#15110f;border-radius:26px;box-shadow:0 60px 140px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.08);overflow:hidden}
.land .browser{width:1440px;height:810px;margin:-500px 0 0 -720px}
.port .browser{width:980px;height:660px;margin:-510px 0 0 -490px}
.bar{height:56px;display:flex;align-items:center;gap:10px;padding:0 22px;background:#211a16}
.bar i{width:14px;height:14px;border-radius:50%;background:#4a3d36}.bar i:nth-child(1){background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
.bar b{margin-left:18px;flex:1;max-width:560px;height:30px;border-radius:15px;background:#0f0b09;color:#9b8579;font:500 15px/30px inherit;font-family:inherit;text-align:center}
.view{position:relative;overflow:hidden;background:#fff}
.land .view{height:754px}.port .view{height:604px}
.view iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;background:#fff}
.phone{background:#0d0a09;border-radius:78px;padding:20px;box-shadow:0 60px 140px rgba(0,0,0,.7),0 0 0 3px #3a2f29,inset 0 0 0 2px #1d1612}
.land .phone{width:390px;height:810px;margin:-500px 0 0 -195px}
.port .phone{width:520px;height:1020px;margin:-630px 0 0 -260px}
.phone .view{width:100%;height:100%;border-radius:58px}
.phone .notch{position:absolute;top:30px;left:50%;width:150px;height:34px;margin-left:-75px;background:#0d0a09;border-radius:20px;z-index:3}
.tag{position:absolute;left:0;right:0;text-align:center;color:#d8c3b8;font-weight:500;letter-spacing:.02em;padding:0 48px;line-height:1.25}
.land .tag{bottom:64px;font-size:34px}
.port #s2 .tag{top:1180px;bottom:auto;font-size:40px}
.port #s3 .tag{top:1410px;bottom:auto;font-size:40px}
.tag span{color:var(--o)}
/* управление и интерактивный просмотр */
#ui{position:fixed;left:0;right:0;bottom:0;z-index:10;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));display:flex;gap:12px;align-items:center;opacity:1;transition:opacity .4s;background:linear-gradient(transparent,rgba(0,0,0,.82) 32%);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#ui.hide{opacity:0;pointer-events:none}
#pb{width:42px;height:42px;flex:none;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:#fff;font-size:15px;cursor:pointer}
#track{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.22);overflow:hidden}#fill{height:100%;width:0;background:var(--o)}
#open-site{flex:none;height:38px;padding:0 15px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:var(--o);color:#fff;font:600 13px/1 inherit;cursor:pointer;white-space:nowrap}
#live{position:fixed;inset:0;z-index:30;display:none;flex-direction:column;background:#fff}
#live.open{display:flex}
#live-bar{min-height:calc(48px + env(safe-area-inset-top,0px));flex:none;display:flex;align-items:center;justify-content:space-between;padding:env(safe-area-inset-top,0px) 14px 0;background:#171311;border-bottom:1px solid rgba(255,255,255,.1);font-size:13px;color:#d8c3b8}
#live-close{height:32px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;font:500 13px/1 inherit;cursor:pointer}
#f-live{flex:1;width:100%;border:0;background:#fff}
.rec #ui,.rec #live{display:none!important}
#s1{opacity:1}/* фолбэк: без JS интро видно статикой */
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
    <div class="name" id="o-name">Ваш сайт готов</div>
    <div class="cap" id="o-cap">__TITLE__ __SUB__</div>
  </section>
</div></div>
<div id="ui"><button id="pb" aria-label="Пауза">❚❚</button><div id="track"><div id="fill"></div></div><button id="open-site" type="button">Открыть сайт</button></div>
<div id="live" aria-hidden="true"><div id="live-bar"><span>Интерактивный просмотр макета</span><button id="live-close" type="button">← К видеообзору</button></div><iframe id="f-live" title="Интерактивный сайт"></iframe></div>
<script id="site-data" type="application/json">__SITE_JSON__</script>
<script>
(function(){
var q=new URLSearchParams(location.search), REC=q.has('record');
var $=function(i){return document.getElementById(i)};
var SITE="<div style='min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px;background:#140d09;font:500 32px/1.3 sans-serif;color:#fff'>Демо-макет сайта</div>";
try{
  var parsed=JSON.parse($('site-data').textContent);
  if(typeof parsed==='string'&&parsed.trim())SITE=parsed;
}catch(e){}
var wrap=$('wrap'),stage=$('stage');
if(REC)document.documentElement.classList.add('rec');
var port=false;
function fit(){
  try{
    port=(innerHeight>innerWidth*1.1)&&!REC;
    wrap.className=port?'port':'land';
    var w=port?1080:1920,h=port?1920:1080;
    stage.style.transform='scale('+Math.min(innerWidth/w,innerHeight/h)+')';
    layout();
  }catch(e){}
}
// длительности сцен, сек
var D=[3.4,12,9.5,3.8],X=.6, TOTAL=D.reduce(function(a,b){return a+b},0);
var starts=[0,D[0],D[0]+D[1],D[0]+D[1]+D[2]];
function cl(x,a,b){return Math.max(a===undefined?0:a,Math.min(b===undefined?1:b,x))}
function eo(t){return 1-Math.pow(1-t,3)}           // easeOutCubic
function sine(t){return .5-.5*Math.cos(Math.PI*t)}
var fd=$('f-desk'),fp=$('f-phone'),fl=$('f-live'),loaded=0,liveInit=false;
function setup(f){
  f.setAttribute('sandbox','allow-scripts allow-forms allow-popups');
  f.addEventListener('load',function(){loaded++;layout();});
  f.srcdoc=SITE;
}
function layout(){
  // виртуальные вьюпорты: десктоп 1366 px шириной, телефон 390 px
  try{
    var vd=$('v-desk'),vp=$('v-phone');
    if(vd&&vd.clientWidth>0){
      var kd=vd.clientWidth/1366;
      fd.style.width='1366px';
      fd.style.height=Math.max(600,vd.clientHeight/kd)+'px';
      fd.style.transform='scale('+kd+')';
    }
    if(vp&&vp.clientWidth>0){
      var kp=vp.clientWidth/390;
      fp.style.width='390px';
      fp.style.height=Math.max(500,vp.clientHeight/kp)+'px';
      fp.style.transform='scale('+kp+')';
    }
  }catch(e){}
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
    if(k===i){
      var fin=(k===0&&lt<X)?1:cl(lt/X);
      var fout=(k===3?1:cl((D[k]-lt)/X));
      a=fin*fout;
    }
    s.style.opacity=a; s.style.visibility=a>0?'visible':'hidden';
  }
  var gl=$('glow'); gl.style.transform='translate3d('+(Math.sin(t*.35)*40)+'px,'+(Math.cos(t*.28)*24)+'px,0) scale('+(1.04+Math.sin(t*.2)*.02)+')';
  if(i===0){        // интро: линия, имя, рубрика, подпись по очереди
    $('i-line').style.width=(eo(cl(lt/.9))*(port?260:360))+'px';
    var n=$('i-name');n.style.opacity=eo(cl((lt-.1)/.65));n.style.transform='translateY('+(36*(1-eo(cl((lt-.1)/.65))))+'px)';
    var r=$('i-rub');r.style.opacity=eo(cl((lt-.45)/.7));r.style.transform='translateY('+(28*(1-eo(cl((lt-.45)/.7))))+'px)';
    var c=$('i-cap');c.style.opacity=eo(cl((lt-.95)/.7));
  }
  if(i===1){        // окно браузера: плавный 2D-наезд без 3D-разрывов на мобильном WebKit
    var e=eo(cl(lt/1.1)), b=$('d-browser'), z=.92+.08*e+p*.02;
    if(!fd.style.width)layout();
    b.style.transform='translateY('+(48*(1-e))+'px) scale('+z+')';
    b.style.opacity=e;
    var tg=$('t-desk');tg.style.opacity=eo(cl((lt-.8)/.8));
    scrollTo(fd,cl((lt-.9)/(D[1]-1.6)));
  }
  if(i===2){        // телефон: въезжает снизу и скроллит
    var e2=eo(cl(lt/1.0)), ph=$('d-phone');
    if(!fp.style.width)layout();
    ph.style.transform='translateY('+(90*(1-e2))+'px) scale('+(.95+.05*e2+p*.015)+')';
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
var t=Math.max(0,parseFloat(q.get('t'))||0),playing=true,last=0,done=false;
function loop(now){
  if(!last)last=now;
  var dt=Math.min(.1,(now-last)/1000); last=now;
  // не стартуем прокрутку, пока сайт не загрузился в оба окна (таймаут 2.5с на случай медленных webview)
  if(playing&&(loaded>=2||t<D[0]||now>2500))t+=dt;
  if(t>=TOTAL){ t=TOTAL; if(!done){done=true;window.__done=true;} if(!REC){ playing=false;$('pb').textContent='↻'; } }
  render(t); requestAnimationFrame(loop);
}
$('pb').addEventListener('click',function(ev){ev.stopPropagation();
  if(t>=TOTAL){t=0;done=false;playing=true;$('pb').textContent='❚❚';return;}
  playing=!playing;$('pb').textContent=playing?'❚❚':'▶';});
$('open-site').addEventListener('click',function(ev){
  ev.stopPropagation();
  if(!liveInit){
    fl.setAttribute('sandbox','allow-scripts allow-forms allow-popups');
    fl.srcdoc=SITE;
    liveInit=true;
  }
  playing=false;$('pb').textContent='▶';
  $('live').classList.add('open');
  $('live').setAttribute('aria-hidden','false');
});
$('live-close').addEventListener('click',function(){
  $('live').classList.remove('open');
  $('live').setAttribute('aria-hidden','true');
});
stage.addEventListener('click',function(){ $('ui').classList.toggle('hide'); });
addEventListener('keydown',function(e){if(e.code==='Space'){e.preventDefault();$('pb').click();}});
addEventListener('resize',fit);
addEventListener('orientationchange',function(){setTimeout(fit,120);});
if(window.visualViewport)window.visualViewport.addEventListener('resize',fit);
try{setup(fd);setup(fp);fit();}catch(e){}
setTimeout(function(){$('ui').classList.add('hide')},7000);
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
