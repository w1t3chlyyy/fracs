"""Проверка лицензии Fracs Parser: программа работает, пока в кабинете Fracs активна подписка.

Ключ лицензии пользователь копирует в кабинете (раздел «Карты 2ГИС» → «Программа») и вводит один раз.
При запуске программа спрашивает у сайта, активна ли подписка. Нет интернета — работает по
последней успешной проверке до 72 часов.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

import requests

from .paths import user_path

# Подставляется при сборке (см. .github/workflows/build-app.yml); для разработки — переменная окружения.
SITE_URL = os.environ.get('FRACS_SITE_URL') or '__FRACS_SITE_URL__'
OFFLINE_GRACE_S = 72 * 3600
RECHECK_S = 10 * 60

_lock = threading.Lock()
_cache: dict[str, Any] = {'at': 0.0, 'state': None}


def _site() -> str:
    return SITE_URL.rstrip('/') if SITE_URL and not SITE_URL.startswith('__') else ''


def _file():
    d = user_path()
    d.mkdir(parents=True, exist_ok=True)
    return d / 'fracs_license.json'


def _load() -> dict:
    try:
        return json.loads(_file().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    try:
        _file().write_text(json.dumps(data), encoding='utf-8')
    except OSError:
        pass


def _verify_online(key: str) -> dict:
    """Возвращает {'ok': bool, 'until': str|None, 'name': str} или бросает requests.RequestException."""
    r = requests.post(_site() + '/api/app/verify', json={'key': key}, timeout=10)
    if r.status_code >= 500:
        raise requests.RequestException(f'HTTP {r.status_code}')
    try:
        return r.json()
    except ValueError:
        raise requests.RequestException('bad response')


def check(force: bool = False) -> dict:
    """Текущее состояние лицензии: {'ok', 'reason', 'until', 'name', 'offline', 'site'}."""
    with _lock:
        now = time.time()
        if not force and _cache['state'] and now - _cache['at'] < RECHECK_S:
            return _cache['state']

        data = _load()
        key = data.get('key')
        state: dict[str, Any] = {'ok': False, 'reason': 'no_key', 'until': None, 'name': None, 'offline': False, 'site': _site()}
        if not _site():
            state['reason'] = 'not_configured'
        elif key:
            try:
                res = _verify_online(key)
                if res.get('ok'):
                    data.update(checked_at=now, until=res.get('until'), name=res.get('name'))
                    _save(data)
                    state.update(ok=True, reason='', until=res.get('until'), name=res.get('name'))
                else:
                    state.update(reason=res.get('reason') or 'expired')
            except requests.RequestException:
                if data.get('checked_at') and now - float(data['checked_at']) < OFFLINE_GRACE_S:
                    state.update(ok=True, reason='', until=data.get('until'), name=data.get('name'), offline=True)
                else:
                    state.update(reason='offline')
        _cache.update(at=now, state=state)
        return state


def activate(key: str) -> dict:
    key = (key or '').strip()
    if not key:
        return {'ok': False, 'reason': 'no_key'}
    if not _site():
        return {'ok': False, 'reason': 'not_configured'}
    try:
        res = _verify_online(key)
    except requests.RequestException:
        return {'ok': False, 'reason': 'offline'}
    if not res.get('ok'):
        return {'ok': False, 'reason': res.get('reason') or 'invalid'}
    _save({'key': key, 'checked_at': time.time(), 'until': res.get('until'), 'name': res.get('name')})
    return check(force=True)


def reset() -> None:
    try:
        _file().unlink()
    except OSError:
        pass
    _cache.update(at=0.0, state=None)
