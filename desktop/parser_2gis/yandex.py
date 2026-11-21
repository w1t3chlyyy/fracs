"""Второй проход: поиск контактов организаций на Яндекс Картах (без API).

Для каждой записи, собранной из 2GIS, открывается поиск Яндекс Карт по
«название + город + адрес», берётся найденная карточка организации и из неё
достаются сайт и телефон. Найденное дописывается прямо в документ 2GIS
(`contact_groups`), поэтому оно автоматически попадает в карточки, фильтры
и все форматы экспорта (CSV/XLSX/JSON/HTML).

Селекторы Яндекс Карт могут меняться — все они собраны в JS-константе ниже.
"""
from __future__ import annotations

import json
import random
import re
import time
from difflib import SequenceMatcher
from typing import Any, Callable, Optional
from urllib.parse import quote, urlparse

from .chrome.options import ChromeOptions
from .chrome.remote import ChromeRemote
from .logger import logger
from .writer.record import extract_record

SOURCE_COMMENT = 'Яндекс Карты'

# Выполняется на странице Яндекс Карт. Возвращает JSON-строку:
#   {state: 'captcha' | 'card' | 'clicked' | 'wait', ...данные карточки}
_JS_PROBE = r'''
(function () {
  function txt(el) { return el ? (el.textContent || '').trim() : ''; }
  function q(root, sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = root.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }
  var href = location.href;
  if (/showcaptcha|\/captcha/i.test(href) ||
      document.querySelector('.CheckboxCaptcha, .AdvancedCaptcha, .captcha, form[action*="captcha"]')) {
    return JSON.stringify({state: 'captcha'});
  }

  var card = document.querySelector('.business-card-view, .orgpage-header-view');
  if (card) {
    var root = document.querySelector('.business-card-view') || document;

    var nameEl = q(document, ['.orgpage-header-view__header', 'h1.card-title-view__title', 'h1']);
    var ratingEl = q(root, ['.business-rating-badge-view__rating-text', '.business-summary-rating-badge-view__rating-text']);
    var addrEl = q(root, ['.business-contacts-view__address-link', '.business-contacts-view__address',
                          '[class*="business-contacts-view__address"]']);

    // Все внешние ссылки карточки: сайт может быть и в блоке контактов,
    // и в кнопке с глобусом («Сайт») рядом с «Маршрут». Рекламу и «похожие места» пропускаем.
    var links = [];
    var anchors = root.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i], h = a.href || '';
      if (!/^https?:/i.test(h)) continue;
      if (a.closest('[class*="advert"], [class*="-ad-"], [class*="related"], [class*="similar"], [class*="carousel"], [class*="review"]')) continue;
      var label = ((a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('title') || '') + ' ' +
                   (a.getAttribute('data-tooltip') || '') + ' ' + (a.textContent || '')).trim().slice(0, 80);
      var par = a.closest('[class*="action-button"], [class*="urls-view"], [class*="business-contacts-view"], [class*="card-feature"], [class*="link-button"]');
      links.push({href: h, label: label, cls: ((a.className && a.className.toString()) || '').slice(0, 120),
                  inKnown: !!par});
    }
    // Бейджи/кнопки с подписью «Сайт» без явного <a> (на случай другой вёрстки).
    var tips = root.querySelectorAll('[aria-label="Сайт"], [title="Сайт"], [data-tooltip="Сайт"]');
    for (var j = 0; j < tips.length; j++) {
      var t = tips[j], link = t.tagName === 'A' ? t : (t.closest('a[href]') || t.querySelector('a[href]'));
      if (link && /^https?:/i.test(link.href || '')) {
        links.push({href: link.href, label: 'Сайт', cls: 'tooltip', inKnown: true});
      }
    }

    var bodyText = (root.innerText || '').slice(0, 4000);
    var closed = /закрыт[оа]?\s+навсегда|постоянно\s+закрыт|больше\s+не\s+работает|перестал[аи]?\s+работать|организация\s+закрыта/i.test(bodyText);

    return JSON.stringify({
      state: 'card',
      url: href,
      name: txt(nameEl),
      links: links,
      rating: txt(ratingEl),
      address: txt(addrEl),
      closed: closed
    });
  }

  // Список результатов -> открыть первый.
  var first = q(document, ['.search-snippet-view a.link-overlay',
                           '.search-business-snippet-view a.link-overlay',
                           'a.search-snippet-view__link-overlay',
                           '.search-snippet-view__body a']);
  if (first) { try { first.click(); } catch (e) {} return JSON.stringify({state: 'clicked'}); }

  return JSON.stringify({state: 'wait'});
})()
'''


class YandexCaptcha(Exception):
    """Яндекс показал капчу, а автоматически (в скрытом режиме) её не пройти."""


_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i',
    'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's',
    'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ъ': '',
    'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'u', 'я': 'a',
}

# Слова, по которым организации не различаются.
_STOP_WORDS = {
    'ооо', 'ип', 'зао', 'оао', 'пао', 'ао', 'кафе', 'бар', 'ресторан', 'магазин', 'салон', 'студия',
    'центр', 'компания', 'группа', 'сеть', 'кондитерская', 'пекарня', 'пиццерия', 'столовая',
    'cafe', 'bar', 'shop', 'store', 'studio', 'center', 'group', 'the',
}


def _tokens(s: str) -> list[str]:
    """Слова названия в едином (латинском) алфавите, без служебных слов."""
    s = (s or '').lower().replace('ё', 'е')
    out = []
    for w in re.findall(r'[0-9a-zа-я]+', s):
        if w in _STOP_WORDS:
            continue
        out.append(''.join(_TRANSLIT.get(ch, ch) for ch in w))
    return out


def _similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < 3:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.8


def names_match(ours: str, theirs: str) -> bool:
    """Проверка, что карточка Яндекса — та же организация.

    Названия сравниваются без учёта регистра, служебных слов (ООО, кафе, ...)
    и алфавита: «Dolce Vita» == «Дольче вита».
    """
    ta, tb = _tokens(ours), _tokens(theirs)
    if not ta or not tb:
        return False
    joined_a, joined_b = ''.join(ta), ''.join(tb)
    if _similar(joined_a, joined_b):
        return True
    # Совпало хотя бы одно значимое слово (>= 4 букв) целиком или почти.
    for x in ta:
        for y in tb:
            if min(len(x), len(y)) >= 4 and _similar(x, y):
                return True
    return False


def address_match(ours: str, theirs: str) -> bool:
    """Адрес совпадает: тот же номер дома и хотя бы одно общее слово (улица)."""
    def parts(s: str):
        s = (s or '').lower().replace('ё', 'е')
        nums = set(re.findall(r'\d+', s))
        words = {''.join(_TRANSLIT.get(ch, ch) for ch in w)
                 for w in re.findall(r'[a-zа-я]{4,}', s)}
        words -= {''.join(_TRANSLIT.get(ch, ch) for ch in w) for w in ('улица', 'проспект', 'переулок', 'площадь')}
        return nums, words
    na, wa = parts(ours)
    nb, wb = parts(theirs)
    if not na or not nb or not (na & nb):
        return False
    return any(_similar(x, y) for x in wa for y in wb)


_NOT_A_SITE = (
    'vk.com', 'vk.ru', 'instagram.com', 'facebook.com', 'fb.com', 'ok.ru', 'youtube.com', 'youtu.be',
    't.me', 'telegram.me', 'wa.me', 'whatsapp.com', 'twitter.com', 'x.com', 'tiktok.com', 'viber.com',
    'zen.yandex.ru', 'dzen.ru', 'linkedin.com', 'pinterest.com',
)


def pick_website(data: dict) -> Optional[str]:
    """Выбрать сайт организации из ссылок карточки Яндекс Карт."""
    candidates = []
    for link in data.get('links') or []:
        site = clean_website(link.get('href', ''))
        if not site:
            continue
        label = (link.get('label') or '').lower()
        score = 0
        if re.search(r'сайт|website|site', label):
            score += 2
        if link.get('inKnown'):
            score += 1
        if score:
            candidates.append((score, site))
    if candidates:
        candidates.sort(key=lambda x: -x[0])
        return candidates[0][1]
    return None


def clean_website(url: str) -> Optional[str]:
    """Нормализовать сайт; отбросить ссылки на сам Яндекс/2GIS и мусор."""
    url = (url or '').strip()
    if not url:
        return None
    if not re.match(r'^https?://', url, re.I):
        url = 'http://' + url
    host = (urlparse(url).netloc or '').lower()
    if not host or '.' not in host:
        return None
    if any(x in host for x in ('yandex.', 'ya.ru', '2gis.', 'yandexadexchange')):
        return None
    # Соцсети и мессенджеры — это не сайт организации.
    if any(host == d or host.endswith('.' + d) for d in _NOT_A_SITE):
        return None
    return url.split('#')[0]


def _doc_item(doc: Any) -> Optional[dict]:
    try:
        return doc['result']['items'][0]
    except (KeyError, IndexError, TypeError):
        return None


def doc_has(doc: Any, contact_type: str) -> bool:
    item = _doc_item(doc)
    if not item:
        return False
    for group in item.get('contact_groups') or []:
        for c in group.get('contacts') or []:
            if c.get('type') == contact_type:
                return True
    return False


def add_contacts(doc: Any, website: Optional[str], phone: Optional[str]) -> bool:
    """Дописать найденные контакты в документ 2GIS. Возвращает, было ли что-то добавлено."""
    item = _doc_item(doc)
    if item is None:
        return False
    contacts = []
    if website:
        host = urlparse(website).netloc
        contacts.append({'type': 'website', 'value': website, 'text': host,
                         'url': website, 'comment': SOURCE_COMMENT})
    if phone:
        digits = re.sub(r'\D', '', phone)
        if digits:
            contacts.append({'type': 'phone', 'value': '+' + digits if not phone.strip().startswith('+') else phone.strip(),
                             'text': phone.strip(), 'comment': SOURCE_COMMENT})
    if not contacts:
        return False
    groups = item.get('contact_groups')
    if not isinstance(groups, list):
        groups = []
        item['contact_groups'] = groups
    groups.append({'contacts': contacts, 'comment': SOURCE_COMMENT})
    return True


class YandexMaps:
    """Обогащение собранных записей контактами с Яндекс Карт (без API)."""

    def __init__(self, chrome_options: ChromeOptions) -> None:
        self._chrome_options = chrome_options
        self._remote: Optional[ChromeRemote] = None
        self._closed = False

    # Для совместимости с ParseJob.stop(), который вызывает `.close()`.
    def close(self) -> None:
        self._closed = True
        remote = self._remote
        if remote is not None:
            try:
                remote.stop()
            except Exception:
                pass

    def _probe(self) -> dict:
        assert self._remote is not None
        raw = self._remote.execute_script(_JS_PROBE)
        try:
            return json.loads(raw) if raw else {'state': 'wait'}
        except (TypeError, ValueError):
            return {'state': 'wait'}

    def _lookup(self, query: str, headless: bool, should_stop: Callable[[], bool]) -> Optional[dict]:
        """Найти карточку организации по тексту. `None` — ничего не найдено."""
        assert self._remote is not None
        self._remote.navigate('https://yandex.ru/maps/?text=' + quote(query), timeout=30)

        deadline = time.time() + 25
        captcha_end: Optional[float] = None
        while time.time() < deadline:
            if self._closed or should_stop():
                return None
            time.sleep(1.0)
            data = self._probe()
            state = data.get('state')
            if state == 'card' and data.get('name'):
                return data
            if state == 'captcha':
                if headless:
                    raise YandexCaptcha('Яндекс показал капчу. Снимите галочку «Скрытый браузер» '
                                        'и запустите второй проход ещё раз: капчу можно пройти вручную.')
                if captcha_end is None:
                    logger.warning('Яндекс показал капчу — пройдите её в окне браузера (жду до 3 минут).')
                    captcha_end = time.time() + 180
                elif time.time() > captcha_end:
                    raise YandexCaptcha('Капча не пройдена за 3 минуты.')
                deadline = time.time() + 25  # пока ждём капчу, таймаут поиска не тикает
            elif captcha_end is not None:
                captcha_end = None  # капча пройдена — продолжаем поиск карточки
                deadline = time.time() + 25
        return None

    def enrich(self, docs: list[Any], only_missing_website: bool,
               should_stop: Callable[[], bool], headless: bool,
               add_site_to_record: bool = False) -> dict[str, Any]:
        """Проверить на Яндекс Картах, есть ли у организаций сайт.

        Телефоны не собираются. Индексы записей, у которых Яндекс нашёл сайт,
        возвращаются в `stats['with_site']` (вызывающий код решает, убирать их
        из выдачи или нет). Если `add_site_to_record=True`, найденный сайт ещё и
        дописывается в запись.
        """
        stats: dict[str, Any] = {'total': 0, 'checked': 0, 'found_site': 0, 'found_phone': 0,
                                 'not_found': 0, 'mismatch': 0, 'closed': 0,
                                 'with_site': [], 'closed_idx': [], 'not_found_idx': []}

        targets = []
        for idx, doc in enumerate(docs):
            if only_missing_website and doc_has(doc, 'website'):
                continue
            targets.append((idx, doc))
        stats['total'] = len(targets)
        if not targets:
            logger.info('Яндекс Карты: нет записей для проверки.')
            return stats

        logger.info('Яндекс Карты: проверяю %d записей (без API, через браузер).', len(targets))

        with ChromeRemote(self._chrome_options, []) as remote:
            self._remote = remote
            try:
                for i, (doc_idx, doc) in enumerate(targets, 1):
                    if self._closed or should_stop():
                        break
                    record = extract_record(doc)
                    if not record:
                        continue
                    parts = [record['name'], record.get('city') or '', record.get('address') or '']
                    query = ' '.join(p for p in parts if p)
                    stats['checked'] += 1
                    try:
                        data = self._lookup(query, headless, should_stop)
                    except YandexCaptcha:
                        raise
                    except Exception as e:
                        if self._closed or should_stop():
                            break
                        logger.warning('Яндекс [%d/%d] %s: ошибка %s: %s', i, len(targets),
                                       record['name'], type(e).__name__, e)
                        continue

                    if not data:
                        doc.setdefault('_fracs', {})['ymaps'] = 'https://yandex.ru/maps/?text=' + quote(query)
                        stats['not_found'] += 1
                        stats['not_found_idx'].append(doc_idx)
                        logger.info('Яндекс [%d/%d] %s — не найдено', i, len(targets), record['name'])
                    elif not (names_match(record['name'], data.get('name', ''))
                              or address_match(record.get('address') or '', data.get('address', ''))):
                        stats['mismatch'] += 1
                        logger.info('Яндекс [%d/%d] %s — найдена другая организация («%s», %s), пропуск',
                                    i, len(targets), record['name'], data.get('name'),
                                    data.get('address') or 'адрес не считан')
                    else:
                        doc.setdefault('_fracs', {})['ymaps'] = (data.get('url') or '').split('#')[0]
                        if data.get('closed'):
                            stats['closed'] += 1
                            stats['closed_idx'].append(doc_idx)
                            logger.info('Яндекс [%d/%d] %s — ЗАКРЫТО по данным Яндекса', i, len(targets),
                                        record['name'])
                            time.sleep(random.uniform(1.5, 3.5))
                            continue
                        website = pick_website(data)
                        logger.debug('Яндекс ссылки карточки: %s', data.get('links'))
                        if website and not doc_has(doc, 'website'):
                            stats['found_site'] += 1
                            stats['with_site'].append(doc_idx)
                            if add_site_to_record:
                                add_contacts(doc, website, None)
                            logger.info('Яндекс [%d/%d] %s — САЙТ ЕСТЬ: %s', i, len(targets),
                                        record['name'], website)
                        else:
                            logger.info('Яндекс [%d/%d] %s — карточка найдена («%s», %s), сайта нет', i, len(targets),
                                        record['name'], data.get('name'), data.get('address') or 'адрес не считан')

                    # Небольшая случайная пауза: меньше шанс капчи.
                    time.sleep(random.uniform(1.5, 3.5))
            finally:
                self._remote = None

        return stats
