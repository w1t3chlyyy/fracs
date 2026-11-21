"""Поиск владельца (руководитель / ИП), ИНН и контактов в открытых реестрах через Chrome."""
from __future__ import annotations

import json
import random
import re
import time
from typing import Any, Callable, Optional
from urllib.parse import quote

from .chrome.options import ChromeOptions
from .chrome.remote import ChromeRemote
from .logger import logger
from .writer.record import extract_record
from .yandex import address_match, names_match

_SEARCH_URL = 'https://www.rusprofile.ru/search?search_inactive=2&query='
_BASE = 'https://www.rusprofile.ru'

_JS_SEARCH = r'''
(function(){
  var t=(document.body&&document.body.innerText)||'';
  if(/captcha|капч|не робот|Just a moment/i.test(t.slice(0,1500)+document.title))
    return JSON.stringify({state:'captcha'});
  var items=[],seen={};
  document.querySelectorAll('a[href^="/id/"],a[href^="/ip/"]').forEach(function(a){
    var h=a.getAttribute('href').split('?')[0]; if(seen[h])return; seen[h]=1;
    var box=a.closest('.list-element,.company-item,li,article')||a.parentElement;
    items.push({href:h,text:((box&&box.innerText)||a.innerText||'').trim().slice(0,500)});
  });
  if(items.length) return JSON.stringify({state:'list',items:items.slice(0,5)});
  if(/ничего не найдено|не найдено/i.test(t.slice(0,3000))) return JSON.stringify({state:'empty'});
  return JSON.stringify({state:'wait'});
})()
'''

_JS_CARD = r'''
(function(){
  var t=(document.body&&document.body.innerText)||'';
  if(/captcha|капч|не робот|Just a moment/i.test(t.slice(0,1500)+document.title))
    return JSON.stringify({state:'captcha'});
  if(t.indexOf('ИНН')<0) return JSON.stringify({state:'wait'});
  var h1=document.querySelector('h1');
  return JSON.stringify({state:'card',h1:h1?h1.innerText:'',text:t.slice(0,15000)});
})()
'''

_FIO = r'([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)'
_ROLES = r'(?:Генеральный директор|Директор|Руководитель|Президент|Управляющий|Председатель)'
_PHONE = re.compile(r'(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}')
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
_OWN_DOMAINS = ('rusprofile', 'checko', 'kontur', 'sbis')


class OwnersCaptcha(Exception):
    pass


def _item(doc: Any) -> Optional[dict]:
    try:
        return doc['result']['items'][0]
    except (KeyError, IndexError, TypeError):
        return None


def parse_card(data: dict) -> dict:
    text, h1 = data.get('text', ''), data.get('h1', '')
    out = {'name': '', 'role': '', 'inn': '', 'phone': '', 'email': '', 'source': ''}
    m = re.search(r'ИНН[:\s]*(\d{10,12})', text)
    if m:
        out['inn'] = m.group(1)
    if re.match(r'\s*(ИП|Индивидуальный предприниматель)', h1, re.I):
        f = re.search(_FIO, h1)
        if f:
            out['name'], out['role'] = f.group(1), 'ИП'
    else:
        f = re.search(r'(' + _ROLES + r')\s*[:\-]?\s*' + _FIO, text)
        if f:
            out['name'], out['role'] = f.group(2), f.group(1)
    phones = []
    for p in _PHONE.findall(text):
        d = re.sub(r'\D', '', p)
        if d.startswith(('8800', '78800')) or d in phones:
            continue
        phones.append(d)
    out['phone'] = ', '.join('+7' + d[-10:] for d in phones[:2])
    mails = [e for e in dict.fromkeys(_EMAIL.findall(text)) if not any(x in e.lower() for x in _OWN_DOMAINS)]
    out['email'] = ', '.join(mails[:2])
    return out


class Owners:
    def __init__(self, chrome_options: ChromeOptions) -> None:
        self._opts = chrome_options
        self._remote: Optional[ChromeRemote] = None
        self._closed = False

    def close(self) -> None:  # вызывается из ParseJob.stop()
        self._closed = True
        if self._remote is not None:
            try:
                self._remote.stop()
            except Exception:
                pass

    def _probe(self, js: str) -> dict:
        raw = self._remote.execute_script(js)  # type: ignore[union-attr]
        try:
            return json.loads(raw) if raw else {'state': 'wait'}
        except (TypeError, ValueError):
            return {'state': 'wait'}

    def _wait(self, url: str, js: str, want: str, headless: bool, stop: Callable[[], bool]) -> Optional[dict]:
        self._remote.navigate(url, timeout=30)  # type: ignore[union-attr]
        deadline, captcha_end = time.time() + 20, None
        while time.time() < deadline:
            if self._closed or stop():
                return None
            time.sleep(1.0)
            d = self._probe(js)
            if d.get('state') == want:
                return d
            if d.get('state') == 'empty':
                return None
            if d.get('state') == 'captcha':
                if headless:
                    raise OwnersCaptcha('Реестр показал капчу. Снимите «Скрытый браузер» и повторите: капчу можно пройти вручную.')
                captcha_end = captcha_end or time.time() + 180
                if time.time() > captcha_end:
                    raise OwnersCaptcha('Капча не пройдена за 3 минуты.')
                deadline = time.time() + 20
        return None

    def enrich(self, docs: list[Any], only_missing: bool, stop: Callable[[], bool], headless: bool) -> dict:
        stats = {'total': 0, 'checked': 0, 'found': 0, 'not_found': 0}
        targets = [(i, d) for i, d in enumerate(docs)
                   if not (only_missing and (d.get('_fracs') or {}).get('owner', {}).get('name'))]
        stats['total'] = len(targets)
        with ChromeRemote(self._opts, []) as remote:
            self._remote = remote
            try:
                for n, (_, doc) in enumerate(targets, 1):
                    if self._closed or stop():
                        break
                    rec, it = extract_record(doc), _item(doc)
                    if not rec or not it:
                        continue
                    legal = ((it.get('name_ex') or {}).get('legal_name') or '').strip()
                    query = legal or f"{rec['name']} {rec.get('city') or ''}".strip()
                    stats['checked'] += 1
                    owner = None
                    try:
                        lst = self._wait(_SEARCH_URL + quote(query), _JS_SEARCH, 'list', headless, stop)
                        pick = None
                        for x in (lst or {}).get('items', []):
                            if names_match(rec['name'], x['text']) or (legal and names_match(legal, x['text'])):
                                if (rec.get('city') and rec['city'].lower() in x['text'].lower()) \
                                        or address_match(rec.get('address') or '', x['text']):
                                    pick = x
                                    break
                                pick = pick or x
                        if pick:
                            card = self._wait(_BASE + pick['href'], _JS_CARD, 'card', headless, stop)
                            if card:
                                owner = parse_card(card)
                                owner['source'] = _BASE + pick['href']
                    except OwnersCaptcha:
                        raise
                    except Exception as e:
                        if self._closed or stop():
                            break
                        logger.warning('Владельцы [%d/%d] %s: %s: %s', n, len(targets), rec['name'], type(e).__name__, e)
                    if owner and (owner['name'] or owner['phone'] or owner['email']):
                        doc.setdefault('_fracs', {})['owner'] = owner
                        stats['found'] += 1
                        logger.info('Владельцы [%d/%d] %s — %s %s', n, len(targets), rec['name'], owner['name'], owner['phone'])
                    else:
                        stats['not_found'] += 1
                        logger.info('Владельцы [%d/%d] %s — не найдено', n, len(targets), rec['name'])
                    time.sleep(random.uniform(2.0, 4.5))
            finally:
                self._remote = None
        return stats
