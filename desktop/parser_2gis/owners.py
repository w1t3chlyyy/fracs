"""Поиск владельца (руководитель / ИП), ИНН и контактов в открытых реестрах.

Приоритет источников:
  1. Быстрый HTTP-поиск по сайту компании (извлечение ИНН из реквизитов/контактов)
     + открытый реестр ЕГРЮЛ/ЕГРИП companium.ru по ИНН, юр. названию, телефону,
     e-mail или названию (с транслитерацией латиницы вроде Avtoplus → Автоплюс).
     Работает без запуска Chrome и не блокируется geo-фильтром.
  2. Резервный обход через Chrome (rusprofile.ru с исправленным URL без 404 и
     checko.ru) — запускается лениво только если HTTP-реестр не дал результата.
"""
from __future__ import annotations

import html as html_lib
from html.parser import HTMLParser
import json
import random
import re
import time
from typing import Any, Callable, Optional
from urllib.parse import quote, urljoin, urlparse

import requests

from .chrome.options import ChromeOptions
from .chrome.remote import ChromeRemote
from .logger import logger
from .writer.record import extract_record
from .yandex import address_match, names_match

_COMPANIUM_BASE = 'https://companium.ru'
_COMPANIUM_SEARCH = 'https://companium.ru/search?query='
_SEARCH_URL = 'https://www.rusprofile.ru/search?query='
_BASE = 'https://www.rusprofile.ru'
_CHECKO_SEARCH_URL = 'https://checko.ru/search?query='
_CHECKO_BASE = 'https://checko.ru'

_HTTP_HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
}

# Выполняется на странице поиска rusprofile. Возвращает JSON-строку:
#   {state: 'captcha' | 'card' | 'list' | 'empty' | 'wait', ...}
_JS_SEARCH = r'''
(function(){
  var t=(document.body&&document.body.innerText)||'';
  var head=(document.title||'')+' '+t.slice(0,1500);
  if(/captcha|капч|не робот|Just a moment|Checking your browser|verify you are human/i.test(head))
    return JSON.stringify({state:'captcha', frag:t.slice(0,200)});
  if(/доступ к сайту.*закрыт|ошибка 403|403 forbidden/i.test(head))
    return JSON.stringify({state:'blocked', frag:t.slice(0,200)});
  var h1=document.querySelector('h1');
  if(h1 && /ИНН|ОГРН|ОГРНИП/i.test(t) && t.length>300){
    return JSON.stringify({state:'card', title:document.title||'', h1:h1.innerText, text:t.slice(0,20000), url:location.href});
  }
  var items=[],seen={};
  document.querySelectorAll('a[href]').forEach(function(a){
    var href=a.getAttribute('href')||'';
    var m=href.match(/\/(id|ip)\/\d+/);
    if(!m) return;
    var key=m[0]; if(seen[key])return; seen[key]=1;
    var box=a.closest('.list-element,.company-item,.search-item,.search-result-item,[class*="company"],[class*="list-item"],tr,li,article')
           ||a.parentElement||a;
    var text=((box&&box.innerText)||a.innerText||'').trim().slice(0,600);
    if(text) items.push({href:m[0], text:text});
  });
  if(items.length) return JSON.stringify({state:'list', items:items.slice(0,8)});
  if(/ничего не найдено|не найдено|no results|ничего не удалось/i.test(t.slice(0,3000)))
    return JSON.stringify({state:'empty'});
  return JSON.stringify({state:'wait', frag:t.slice(0,200)});
})()
'''

# То же для checko.ru: серверный рендер, ссылки вида /company/<slug>-<ИНН>.
_JS_CHECKO_SEARCH = r'''
(function(){
  var t=(document.body&&document.body.innerText)||'';
  var head=(document.title||'')+' '+t.slice(0,800);
  if(/доступ к сайту.*закрыт|ошибка 403|403 forbidden/i.test(head))
    return JSON.stringify({state:'blocked', frag:t.slice(0,200)});
  if(/captcha|капч|не робот|подтвердите что вы не робот|Just a moment/i.test(head))
    return JSON.stringify({state:'captcha', frag:t.slice(0,200)});
  var items=[],seen={};
  document.querySelectorAll('a[href*="/company/"]').forEach(function(a){
    var href=a.getAttribute('href')||'';
    var m=href.match(/^\/company\/[a-z0-9\-]+-(\d{10,13})$/);
    if(!m) return;
    var key=m[0]; if(seen[key])return; seen[key]=1;
    var box=a.closest('tr,li,article,[class*="result"],[class*="item"]')||a.parentElement||a;
    var text=((box&&box.innerText)||a.innerText||'').trim().slice(0,600);
    if(text) items.push({href:m[0], text:text});
  });
  if(items.length) return JSON.stringify({state:'list', items:items.slice(0,10)});
  if(/ничего не найдено|ничего не удалось|по запросу ничего не найдено/i.test(t.slice(0,4000)))
    return JSON.stringify({state:'empty'});
  return JSON.stringify({state:'wait', frag:t.slice(0,200)});
})()
'''

# Выполняется на карточке компании. Ждём, пока прогрузится ИНН/ОГРН.
_JS_CARD = r'''
(function(){
  var t=(document.body&&document.body.innerText)||'';
  var head=(document.title||'')+' '+t.slice(0,1500);
  if(/доступ к сайту.*закрыт|ошибка 403|403 forbidden/i.test(head))
    return JSON.stringify({state:'blocked', frag:t.slice(0,200)});
  if(/captcha|капч|не робот|Just a moment|Checking your browser|verify you are human/i.test(head))
    return JSON.stringify({state:'captcha', frag:t.slice(0,200)});
  if(/ИНН|ОГРН|ОГРНИП/.test(t)){
    var h1=document.querySelector('h1');
    return JSON.stringify({state:'card', title:document.title||'', h1:h1?h1.innerText:'', text:t.slice(0,20000), url:location.href});
  }
  return JSON.stringify({state:'wait', frag:t.slice(0,200)});
})()
'''

_FIO = (r'([А-ЯЁ][а-яё]{1,30}(?:-[А-ЯЁ][а-яё]{1,30})?\s+[А-ЯЁ][а-яё]{1,30}\s+'
        r'[А-ЯЁ][а-яё]{1,30}(?:-[А-ЯЁ][а-яё]{1,30})?(?:\s+(?:оглы|кызы|улы|уулу))?)')
# ФИО заглавными (ИП ПЕТРОВ ПЁТР ПЕТРОВИЧ): в реестрах так пишут часть карточек.
_FIO_CAPS = (r'([А-ЯЁ]{2,30}(?:-[А-ЯЁ]{2,30})?\s+[А-ЯЁ]{2,30}\s+'
             r'[А-ЯЁ]{2,30}(?:-[А-ЯЁ]{2,30})?(?:\s+(?:ОГЛЫ|КЫЗЫ|УЛЫ|УУЛУ))?)')
_CAPS_STOP = {'ООО', 'ОАО', 'ЗАО', 'ПАО', 'АО', 'ИП', 'ОГРН', 'ОГРНИП', 'ИНН', 'КПП'}


def _caps_fio(text: str) -> str:
    """Первое ФИО заглавными буквами → «Иванов Иван Иванович»."""
    text = re.sub(r'\b(?:' + '|'.join(_CAPS_STOP) + r')\b', ' ', text or '')
    for m in re.finditer(_FIO_CAPS, text):
        words = m.group(1).split()
        out = ' '.join('-'.join(p.capitalize() for p in w.split('-')) for w in words)
        return re.sub(r'\b(Оглы|Кызы|Улы|Уулу)\b', lambda x: x.group(1).lower(), out)
    return ''
_ROLES = (r'(?:Генеральный\s+директор|Гендиректор|Исполнительный\s+директор|'
          r'Директор|Руководитель|Президент|Управляющий(?:\s+ИП)?|Председатель|Глава|Командир)')
_PHONE = re.compile(r'(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}')
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
_OWN_DOMAINS = ('rusprofile', 'checko', 'kontur', 'sbis', 'companium', 'list-org')
_SKIP_WEB_DOMAINS = ('2gis.', 'yandex.', 'ya.ru', 'vk.com', 't.me', 'telegram.',
                     'instagram.', 'wa.me', 'whatsapp.', 'youtube.', 'ok.ru', 'facebook.')
_FREE_EMAIL_DOMAINS = ('gmail.com', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru',
                       'yandex.ru', 'ya.ru', 'rambler.ru', 'yahoo.com', 'icloud.com', 'hotmail.com')

# Простая фонетическая замена для латинских брендов (Avtoplus29 → Автоплюс, Autostudio → Автостудио).
_LAT_WORDS = (
    ('autostudio', 'автостудио'), ('avtoplus', 'автоплюс'), ('autoplus', 'автоплюс'),
    ('avtoservis', 'автосервис'), ('autoservice', 'автосервис'), ('detailing', 'детейлинг'),
    ('studio', 'студио'), ('service', 'сервис'), ('servis', 'сервис'),
    ('avto', 'авто'), ('auto', 'авто'), ('plus', 'плюс'), ('pro', 'про'),
    ('club', 'клуб'), ('group', 'групп'), ('motors', 'моторс'), ('motor', 'мотор'),
    ('garage', 'гараж'), ('car', 'кар'), ('dent', 'дент'), ('stomat', 'стомат'),
    ('clinic', 'клиник'), ('coffee', 'кофе'), ('cafe', 'кафе'), ('beauty', 'бьюти'),
    ('barber', 'барбер'), ('salon', 'салон'), ('stroy', 'строй'), ('master', 'мастер'),
    ('expert', 'эксперт'), ('express', 'экспресс'), ('market', 'маркет'), ('house', 'хаус'),
    ('center', 'центр'), ('centr', 'центр'), ('lab', 'лаб'), ('city', 'сити'),
)
_LAT_DIGRAPHS = (
    ('shch', 'щ'), ('sch', 'щ'), ('zh', 'ж'), ('kh', 'х'), ('ts', 'ц'),
    ('ch', 'ч'), ('sh', 'ш'), ('yu', 'ю'), ('ya', 'я'), ('yo', 'ё'),
    ('ph', 'ф'), ('ck', 'к'), ('oo', 'у'), ('ee', 'и'), ('ea', 'и'),
    ('th', 'т'), ('qu', 'кв'),
)
_LAT_CHARS = {
    'a': 'а', 'b': 'б', 'c': 'к', 'd': 'д', 'e': 'е', 'f': 'ф', 'g': 'г',
    'h': 'х', 'i': 'и', 'j': 'дж', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
    'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
    'v': 'в', 'w': 'в', 'x': 'кс', 'y': 'и', 'z': 'з',
}


class OwnersCaptcha(Exception):
    pass


def _item(doc: Any) -> Optional[dict]:
    try:
        return doc['result']['items'][0]
    except (KeyError, IndexError, TypeError):
        return None


def _translit_latin_brand(name: str) -> str:
    """Переводит латинский бренд в кириллицу для поиска в российском реестре."""
    s = (name or '').strip()
    if not s or not re.search(r'[A-Za-z]', s):
        return ''
    low = s.lower()
    for lat, cyr in _LAT_WORDS:
        low = low.replace(lat, cyr)
    for lat, cyr in _LAT_DIGRAPHS:
        low = low.replace(lat, cyr)
    out = ''.join(_LAT_CHARS.get(ch, ch) for ch in low)
    # убираем хвостовые регионы/цифры вида "29", чтобы расширить совпадение
    out = re.sub(r'\s+', ' ', out).strip()
    return out


class _CompaniumHTML(HTMLParser):
    """Разбирает SSR-страницу companium.ru без внешних зависимостей."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self._in_title = False
        self._in_h1 = False
        self._in_tr = False
        self._link_href = ''
        self._title_parts: list[str] = []
        self._h1_parts: list[str] = []
        self._text_parts: list[str] = []
        self._tr_parts: list[str] = []
        self._tr_hrefs: list[str] = []
        self.items: list[dict] = []
        self._seen_hrefs: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        t = tag.lower()
        if t in ('script', 'style', 'noscript', 'svg', 'template'):
            self._skip += 1
            return
        if self._skip:
            return
        attr_map = dict(attrs)
        if t == 'title':
            self._in_title = True
        elif t == 'h1':
            self._in_h1 = True
        elif t == 'tr':
            self._in_tr = True
            self._tr_parts = []
            self._tr_hrefs = []
        elif t == 'a':
            href = (attr_map.get('href') or '').strip()
            m = re.match(r'^(/(?:id|people/inn)/[A-Za-z0-9._-]+)', href)
            if m:
                clean_href = m.group(1)
                self._link_href = clean_href
                if self._in_tr:
                    self._tr_hrefs.append(clean_href)
        if t in ('p', 'div', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'br', 'section', 'dt', 'dd'):
            self._text_parts.append('\n')
            if self._in_tr and t in ('td', 'th', 'br', 'div'):
                self._tr_parts.append(' ')

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ('script', 'style', 'noscript', 'svg', 'template'):
            if self._skip:
                self._skip -= 1
            return
        if self._skip:
            return
        if t == 'title':
            self._in_title = False
        elif t == 'h1':
            self._in_h1 = False
        elif t == 'tr' and self._in_tr:
            self._in_tr = False
            row_text = re.sub(r'\s+', ' ', ''.join(self._tr_parts)).strip()
            for href in self._tr_hrefs:
                if href not in self._seen_hrefs and row_text:
                    self._seen_hrefs.add(href)
                    self.items.append({'href': href, 'text': row_text[:600]})
                    break
        elif t == 'a':
            self._link_href = ''

    def handle_data(self, data: str) -> None:
        if self._skip or not data:
            return
        if self._in_title:
            self._title_parts.append(data)
        if self._in_h1:
            self._h1_parts.append(data)
        if self._in_tr:
            self._tr_parts.append(data)
        self._text_parts.append(data)

    def result(self) -> tuple[str, str, str]:
        title = re.sub(r'\s+', ' ', ''.join(self._title_parts)).strip()
        h1 = re.sub(r'\s+', ' ', ''.join(self._h1_parts)).strip()
        raw_text = ''.join(self._text_parts)
        lines = [re.sub(r'[ \t\xa0]+', ' ', ln).strip() for ln in raw_text.splitlines()]
        text = '\n'.join(ln for ln in lines if ln)
        return title, h1, text


def _html_to_card_or_list(raw_html: str, url: str) -> dict:
    parser = _CompaniumHTML()
    try:
        parser.feed(raw_html)
        parser.close()
    except Exception:
        pass
    title, h1, text = parser.result()
    head = (title + ' ' + text[:1000]).lower()
    if any(k in head for k in ('captcha', 'капч', 'не робот', 'доступ к сайту', 'ошибка 403')):
        return {'state': 'captcha', 'frag': text[:200]}
    is_card_url = bool(re.search(r'/(?:id|people/inn)/', url))
    if (is_card_url or ('/search' not in url)) and re.search(r'\b(?:ИНН|ОГРН|ОГРНИП)\b', text):
        return {'state': 'card', 'title': title, 'h1': h1, 'text': text[:24000], 'url': url}
    if parser.items:
        return {'state': 'list', 'items': parser.items[:12]}
    # Попробуем вытащить ссылки из HTML напрямую, если верстка была не табличная
    items, seen = [], set()
    for m in re.finditer(r'href="(/(?:id|people/inn)/[A-Za-z0-9._-]+)"[^>]*>([^<]{2,200})<', raw_html):
        href, label = m.group(1), html_lib.unescape(m.group(2)).strip()
        if href not in seen and label:
            seen.add(href)
            items.append({'href': href, 'text': label})
    if items:
        return {'state': 'list', 'items': items[:12]}
    if re.search(r'ничего не найдено|по вашему запросу ничего|не найдено', text[:3000], re.I):
        return {'state': 'empty'}
    return {'state': 'empty', 'frag': text[:200]}


def parse_card(data: dict) -> dict:
    """Разбирает текст карточки реестра: ФИО руководителя/ИП, ИНН, телефоны, e-mail."""
    text = data.get('text', '') or ''
    h1 = data.get('h1', '') or ''
    title = data.get('title', '') or ''
    out = {'name': '', 'role': '', 'inn': '', 'phone': '', 'email': '', 'source': ''}

    # Отрезаем блок «Связи / По руководителю / По учредителю» внизу карточки companium.ru,
    # чтобы не подхватить директора или телефон смежной организации.
    body = text
    m_rel = re.search(r'\n(?:Связи|Связанные\s+организации|По\s+руководителю)\b', text)
    if m_rel and m_rel.start() > 300:
        body = text[:m_rel.start()]

    m = re.search(r'ИНН[:\s№]*?(\d{10,12})\b', body)
    if m:
        out['inn'] = m.group(1)

    head_ctx = f'{h1}\n{title}\n{body[:500]}'
    is_ip = bool(
        re.match(r'\s*(?:ИП|Индивидуальный\s+предприниматель)\b', h1, re.I)
        or re.search(r'\b(?:ИП|Индивидуальный\s+предприниматель)\b', title, re.I)
        or re.search(r'(?:Действующий|Прекративший\s+деятельность)\s+ИП\b', body[:500], re.I)
    )
    if is_ip:
        f = re.search(_FIO, h1) or re.search(_FIO, title) or re.search(_FIO, body[:800])
        if f:
            out['name'], out['role'] = f.group(1), 'ИП'
        else:
            caps = _caps_fio(h1) or _caps_fio(title) or _caps_fio(body[:800])
            if caps:
                out['name'], out['role'] = caps, 'ИП'
    else:
        # 1. «Генеральный директор: ФИО» / «Генеральный директор\nФИО» (до 24 символов между ролью и ФИО)
        f = re.search(r'((?i:' + _ROLES + r'))[^А-ЯЁа-яё\n]{0,12}\n?' + _FIO, body)
        if f:
            role = re.sub(r'\s+', ' ', f.group(1)).strip()
            out['name'], out['role'] = f.group(2), (role.capitalize() if role.isupper() else role)
        else:
            # 2. Роль и ФИО на соседних строках (формат checko/companium, в т.ч. между ролью и ФИО бывает пояснение)
            for mr in re.finditer(r'^\s*(' + _ROLES + r'[^\n]{0,60})$', body, re.M):
                nxt = re.search(_FIO, body[mr.end():mr.end() + 180])
                if nxt:
                    out['name'], out['role'] = nxt.group(1), mr.group(1).strip()
                    break
        # 2б. ФИО руководителя заглавными буквами.
        if not out['name']:
            fc = re.search(r'((?i:' + _ROLES + r'))[^А-ЯЁа-яё\n]{0,12}\n?' + _FIO_CAPS, body)
            if fc:
                cap = _caps_fio(fc.group(2))
                if cap:
                    out['name'], out['role'] = cap, re.sub(r'\s+', ' ', fc.group(1)).strip().capitalize()
        # 3. Если руководителя не указано — берём учредителя физлицо.
        if not out['name']:
            for mf in re.finditer(r'^\s*Учредител[ьи]\b[^\n]{0,40}$', body, re.M):
                nxt = re.search(_FIO, body[mf.end():mf.end() + 180])
                if nxt:
                    out['name'], out['role'] = nxt.group(1), 'Учредитель'
                    break

    phones = []
    for p in _PHONE.findall(body):
        d = re.sub(r'\D', '', p)
        if len(d) < 10 or d.startswith(('8800', '78800')) or d in phones:
            continue
        phones.append(d)
    out['phone'] = ', '.join('+7' + d[-10:] for d in phones[:2])

    mails = [e for e in dict.fromkeys(_EMAIL.findall(body))
             if not any(x in e.lower() for x in _OWN_DOMAINS)]
    out['email'] = ', '.join(mails[:2])
    return out


def _pick_item(items: list[dict], rec: dict, legal: str,
               strict: bool = False) -> Optional[dict]:
    """Выбирает из списка реестра карточку подходящей организации."""
    best, best_score = None, -999
    brand = (rec.get('name') or '').strip()
    translit = _translit_latin_brand(brand)
    city = (rec.get('city') or '').strip().lower()
    address = (rec.get('address') or '').strip()
    rubrics = [w.lower() for r in (rec.get('rubrics') or [])
               for w in re.findall(r'[А-Яа-яЁёA-Za-z]{4,}', str(r))]

    for x in items:
        text = x.get('text', '') or ''
        low = text.lower()
        s = 0
        if legal and names_match(legal, text):
            s += 5
        if brand and (names_match(brand, text) or (translit and names_match(translit, text))):
            s += 3
        if city and city in low:
            s += 2
        if address and address_match(address, text):
            s += 2
        if rubrics and any(w in low for w in rubrics[:4]):
            s += 1
        if 'действующ' in low:
            s += 1
        elif 'ликвидиров' in low or 'прекратил' in low:
            s -= 3
        if s > best_score:
            best_score, best = s, x

    if strict and best_score < 2:
        return None
    if best is None and items and not strict:
        best = items[0]
    return best


def _extract_phones(doc: Any, rec: dict) -> list[str]:
    """Все уникальные телефоны компании в формате 7XXXXXXXXXX (кроме 8-800)."""
    seen, out = set(), []
    raw_list: list[str] = []
    if (rec.get('contacts') or {}).get('phone'):
        raw_list.append(str(rec['contacts']['phone']))
    try:
        for grp in (doc['result']['items'][0].get('contact_groups') or []):
            for c in (grp.get('contacts') or []):
                if c.get('type') == 'phone':
                    raw_list.append(str(c.get('value') or c.get('text') or ''))
    except Exception:
        pass
    for raw in raw_list:
        d = re.sub(r'\D', '', raw)
        if len(d) == 11 and d.startswith('8'):
            d = '7' + d[1:]
        elif len(d) == 10:
            d = '7' + d
        if len(d) == 11 and d.startswith('7') and not d.startswith('7800') and d not in seen:
            seen.add(d)
            out.append(d)
    return out[:2]


def _extract_inn_from_website(session: requests.Session, website: str) -> str:
    """Пробует достать ИНН организации прямо с её сайта (главная или контакты/политика)."""
    u = (website or '').strip()
    if not u:
        return ''
    if not u.startswith(('http://', 'https://')):
        u = 'https://' + u
    host = (urlparse(u).netloc or '').lower()
    if not host or any(s in host for s in _SKIP_WEB_DOMAINS):
        return ''
    base = f'{urlparse(u).scheme}://{host}'
    candidates = [u] + [urljoin(base, p) for p in ('/contacts', '/rekvizity', '/privacy')]
    for idx, page in enumerate(candidates[:3]):
        try:
            r = session.get(page, timeout=4.5, allow_redirects=True)
            if r.status_code >= 400 or 'html' not in (r.headers.get('content-type') or '').lower():
                if idx == 0:
                    return ''
                continue
            plain = html_lib.unescape(re.sub(r'<[^>]+>', ' ', r.text[:120000]))
            m = re.search(r'(?:ИНН|inn)\D{0,10}(\d{12}|\d{10})\b', plain)
            if m:
                return m.group(1)
        except Exception:
            if idx == 0:
                return ''
    return ''


class Owners:
    def __init__(self, chrome_options: ChromeOptions) -> None:
        self._opts = chrome_options
        self._remote: Optional[ChromeRemote] = None
        self._closed = False
        self._last_probe: dict = {}
        self._diag_done: set[str] = set()
        self._session = requests.Session()
        self._session.headers.update(_HTTP_HEADERS)
        self._companium_blocked = False
        self._chrome_blocked: set[str] = set()
        self._chrome_timeouts = 0

    def close(self) -> None:  # вызывается из ParseJob.stop()
        self._closed = True
        if self._remote is not None:
            try:
                self._remote.stop()
            except Exception:
                pass
            self._remote = None

    def _ensure_remote(self) -> Optional[ChromeRemote]:
        if self._closed or self._chrome_timeouts >= 2:
            return None
        if self._remote is None:
            self._remote = ChromeRemote(self._opts, [])
            self._remote.start()
        return self._remote

    def _probe(self, js: str) -> dict:
        raw = self._remote.execute_script(js)  # type: ignore[union-attr]
        try:
            d = json.loads(raw) if raw else {}
        except (TypeError, ValueError):
            d = {}
        if not isinstance(d, dict):
            d = {}
        self._last_probe = d or {'state': 'wait'}
        return self._last_probe

    def _wait(self, url: str, js: str, want, headless: bool,
              stop: Callable[[], bool], timeout: int = 20) -> Optional[dict]:
        if isinstance(want, str):
            want = (want,)
        remote = self._ensure_remote()
        if not remote:
            return None
        remote.navigate(url, timeout=timeout)
        deadline, captcha_end = time.time() + timeout, None
        while time.time() < deadline:
            if self._closed or stop():
                return None
            time.sleep(0.9)
            d = self._probe(js)
            st = d.get('state')
            if st in want:
                return d
            if st in ('empty', 'blocked'):
                return d if st == 'blocked' else None
            if st == 'captcha':
                if headless:
                    raise OwnersCaptcha('Реестр показал капчу. Снимите «Скрытый браузер» и повторите: капчу можно пройти вручную.')
                captcha_end = captcha_end or time.time() + 180
                if time.time() > captcha_end:
                    raise OwnersCaptcha('Капча не пройдена за 3 минуты.')
                deadline = time.time() + timeout
        return None

    # ── быстрый HTTP-поиск по companium.ru ───────────────────────────────────
    def _http_get(self, url: str) -> Optional[requests.Response]:
        try:
            r = self._session.get(url, timeout=12, allow_redirects=True)
            if r.status_code in (403, 429):
                self._companium_blocked = True
                return None
            if r.status_code >= 400:
                return None
            return r
        except Exception:
            return None

    def _lookup_companium(self, query: str, rec: dict, legal: str,
                          strict: bool = False) -> Optional[dict]:
        if self._companium_blocked or not query:
            return None
        r = self._http_get(_COMPANIUM_SEARCH + quote(query))
        if not r:
            return None
        parsed = _html_to_card_or_list(r.text, str(r.url))
        if parsed.get('state') == 'captcha':
            self._companium_blocked = True
            self._diag('companium', 'реестр временно ограничил автоматические запросы')
            return None
        if parsed.get('state') == 'card':
            owner = parse_card(parsed)
            if owner['name'] or owner['inn'] or owner['phone'] or owner['email']:
                owner['source'] = 'companium'
                return owner
            return None
        if parsed.get('state') == 'list':
            pick = _pick_item(parsed.get('items', []), rec, legal, strict=strict)
            if pick:
                r2 = self._http_get(_COMPANIUM_BASE + pick['href'])
                if r2:
                    card = _html_to_card_or_list(r2.text, str(r2.url))
                    if card.get('state') == 'card':
                        owner = parse_card(card)
                        if owner['name'] or owner['inn'] or owner['phone'] or owner['email']:
                            owner['source'] = 'companium'
                            return owner
        return None

    def _search_companium_multi(self, doc: Any, rec: dict, it: dict, legal: str,
                                stop: Callable[[], bool]) -> Optional[dict]:
        brand = (rec.get('name') or '').strip()
        city = (rec.get('city') or '').strip()
        contacts = rec.get('contacts') or {}

        # 1. ИНН с собственного сайта бизнеса — самый точный идентификатор.
        website = str(contacts.get('website') or '').strip()
        if website and not stop() and not self._closed:
            inn = _extract_inn_from_website(self._session, website)
            if inn:
                owner = self._lookup_companium(inn, rec, legal, strict=False)
                if owner:
                    return owner

        # 2. Юридическое название из 2ГИС (если карточка его содержит).
        if legal and not stop() and not self._closed:
            owner = self._lookup_companium(legal, rec, legal, strict=False)
            if owner:
                return owner

        # 3. Телефоны компании (на companium.ru поиск по 7XXXXXXXXXX находит юрлица/ИП
        #    даже когда название в 2ГИС — англицизм вроде Avtoplus29 или 911 auto).
        for phone in _extract_phones(doc, rec):
            if stop() or self._closed:
                return None
            owner = self._lookup_companium(phone, rec, legal, strict=False)
            if owner:
                return owner

        # 4. Корпоративный e-mail (публичные ящики gmail/mail.ru/yandex не ищем).
        email = str(contacts.get('email') or '').strip().lower()
        if email and '@' in email and not email.endswith(_FREE_EMAIL_DOMAINS):
            if not stop() and not self._closed:
                owner = self._lookup_companium(email, rec, legal, strict=False)
                if owner:
                    return owner

        # 5. Название + город (строгий отбор), затем фонетическая транслитерация.
        queries: list[tuple[str, bool]] = []
        if brand:
            if city:
                queries.append((f'{brand} {city}', True))
            queries.append((brand, True))
            tr = _translit_latin_brand(brand)
            if tr and tr.lower() != brand.lower():
                if city:
                    queries.append((f'{tr} {city}', True))
                tr_no_num = re.sub(r'\d+$', '', tr).strip()
                if tr_no_num and len(tr_no_num) >= 4:
                    queries.append((f'{tr_no_num} {city}'.strip(), True))

        seen_q: set[str] = set()
        for q, strict in queries:
            if stop() or self._closed or self._companium_blocked:
                break
            ql = q.lower()
            if ql in seen_q:
                continue
            seen_q.add(ql)
            owner = self._lookup_companium(q, rec, legal, strict=strict)
            if owner:
                return owner
        return None

    # ── резервные Chrome-источники (если HTTP не помог) ─────────────────────
    def _lookup_rusprofile(self, query: str, rec: dict, legal: str,
                           headless: bool, stop: Callable[[], bool]) -> Optional[dict]:
        if 'rusprofile' in self._chrome_blocked:
            return None
        lst = self._wait(_SEARCH_URL + quote(query), _JS_SEARCH, ('list', 'card'),
                         headless, stop)
        if lst and lst.get('state') == 'blocked':
            self._chrome_blocked.add('rusprofile')
            self._diag('rusprofile', 'доступ ограничен (403)')
            return None
        if lst and lst.get('state') == 'card':
            owner = parse_card(lst)
            owner['source'] = 'rusprofile'
            return owner
        if lst and lst.get('state') == 'list':
            pick = _pick_item(lst.get('items', []), rec, legal, strict=not legal)
            if pick:
                card = self._wait(_BASE + pick['href'], _JS_CARD, ('card',), headless, stop)
                if card and card.get('state') == 'card':
                    owner = parse_card(card)
                    owner['source'] = 'rusprofile'
                    return owner
        return None

    def _lookup_checko(self, query: str, rec: dict, legal: str,
                       headless: bool, stop: Callable[[], bool]) -> Optional[dict]:
        if 'checko' in self._chrome_blocked:
            return None
        lst = self._wait(_CHECKO_SEARCH_URL + quote(query), _JS_CHECKO_SEARCH,
                         ('list', 'card'), headless, stop)
        if lst and lst.get('state') == 'blocked':
            self._chrome_blocked.add('checko')
            self._diag('checko', 'доступ из текущей страны/VPN ограничен (403)')
            return None
        if lst and lst.get('state') == 'card':
            owner = parse_card(lst)
            owner['source'] = 'checko'
            return owner
        if lst and lst.get('state') == 'list':
            pick = _pick_item(lst.get('items', []), rec, legal, strict=not legal)
            if pick:
                card = self._wait(_CHECKO_BASE + pick['href'], _JS_CARD, ('card',), headless, stop)
                if card and card.get('state') == 'card':
                    owner = parse_card(card)
                    owner['source'] = 'checko'
                    return owner
        return None

    def _diag(self, source: str, what: str) -> None:
        if source in self._diag_done:
            return
        self._diag_done.add(source)
        frag = str((self._last_probe or {}).get('frag', '')).replace('\n', ' ')[:160]
        logger.warning('Реестр %s: %s%s', source, what,
                       f' (фрагмент страницы: «{frag}»)' if frag else '')

    def enrich(self, docs: list[Any], only_missing: bool, stop: Callable[[], bool],
               headless: bool) -> dict:
        stats = {'total': 0, 'checked': 0, 'found': 0, 'with_name': 0, 'not_found': 0}
        targets = [(i, d) for i, d in enumerate(docs)
                   if not (only_missing and (d.get('_fracs') or {}).get('owner', {}).get('name'))]
        stats['total'] = len(targets)
        self._diag_done = set()
        try:
            for n, (_, doc) in enumerate(targets, 1):
                if self._closed or stop():
                    break
                rec, it = extract_record(doc), _item(doc)
                if not rec or not it:
                    continue
                legal = ((it.get('name_ex') or {}).get('legal_name')
                         or (it.get('org') or {}).get('name') or '').strip()
                query = legal or f"{rec['name']} {rec.get('city') or ''}".strip()
                stats['checked'] += 1
                owner = None
                try:
                    owner = self._search_companium_multi(doc, rec, it, legal, stop)
                    if not owner and self._chrome_timeouts < 2 and (
                        'rusprofile' not in self._chrome_blocked or 'checko' not in self._chrome_blocked
                    ):
                        if 'rusprofile' not in self._chrome_blocked:
                            owner = self._lookup_rusprofile(query, rec, legal, headless, stop)
                        if not owner and 'checko' not in self._chrome_blocked:
                            owner = self._lookup_checko(query, rec, legal, headless, stop)
                except OwnersCaptcha:
                    raise
                except Exception as e:
                    if self._closed or stop():
                        break
                    msg = f'{type(e).__name__}: {e}'
                    if 'TIMED_OUT' in msg or 'Timeout' in msg:
                        self._chrome_timeouts += 1
                    logger.warning('Владельцы [%d/%d] %s: %s',
                                   n, len(targets), rec['name'], msg)

                if owner and (owner['name'] or owner['phone'] or owner['email'] or owner['inn']):
                    doc.setdefault('_fracs', {})['owner'] = owner
                    stats['found'] += 1
                    if owner.get('name'):
                        stats['with_name'] += 1
                        logger.info('Владельцы [%d/%d] %s — %s %s (%s)', n, len(targets),
                                    rec['name'], owner['name'], owner['phone'] or owner['inn'], owner['source'])
                    else:
                        logger.info('Владельцы [%d/%d] %s — найдены ИНН/контакты %s %s (%s)',
                                    n, len(targets), rec['name'], owner['inn'], owner['phone'], owner['source'])
                else:
                    stats['not_found'] += 1
                    logger.info('Владельцы [%d/%d] %s — не найдено в открытых реестрах',
                                n, len(targets), rec['name'])
                time.sleep(random.uniform(0.6, 1.3))
        finally:
            if self._remote is not None:
                try:
                    self._remote.stop()
                except Exception:
                    pass
                self._remote = None
        return stats
