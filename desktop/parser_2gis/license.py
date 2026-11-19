"""Проверка лицензии Fracs Parser: программа работает, пока в кабинете Fracs активна подписка.

Ключ лицензии пользователь копирует в кабинете (раздел «Карты 2ГИС» → «Программа») и вводит один раз.
При запуске и каждые 60 секунд программа проверяет подписку на сайте. После окончания срока подписки
или её отзыва работа программы немедленно блокируется (в том числе при отсутствии интернета).
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import threading
import time
from typing import Any

import requests

from .paths import user_path

# Подставляется при сборке (см. .github/workflows/build-app.yml); для разработки — переменная окружения.
SITE_URL = os.environ.get('FRACS_SITE_URL') or '__FRACS_SITE_URL__'
OFFLINE_GRACE_S = 3600
RECHECK_S = 60
PARSE_COOLDOWN_S = 6 * 60 * 60

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


def _parse_until(until: Any) -> float | None:
    if not until or not isinstance(until, str):
        return None
    try:
        s = until.strip()
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def _is_until_active(until: Any, now: float) -> bool:
    ts = _parse_until(until)
    return ts is not None and ts > now


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
        cached = _cache['state']
        if not force and cached and now - _cache['at'] < RECHECK_S:
            # Даже в пределах кэша сразу блокируем, если срок подписки истёк.
            if not cached.get('ok') or _is_until_active(cached.get('until'), now):
                return cached

        data = _load()
        key = data.get('key')
        state: dict[str, Any] = {'ok': False, 'reason': 'no_key', 'until': None, 'name': None, 'offline': False, 'site': _site()}
        if not _site():
            state['reason'] = 'not_configured'
        elif key:
            try:
                res = _verify_online(key)
                if res.get('ok') and _is_until_active(res.get('until'), now):
                    data.update(checked_at=now, until=res.get('until'), name=res.get('name'))
                    _save(data)
                    state.update(ok=True, reason='', until=res.get('until'), name=res.get('name'))
                else:
                    reason = res.get('reason') or 'expired'
                    # Сбрасываем кэшированное подтверждение, чтобы оффлайн-режим не обходил блокировку.
                    _save({'key': key} if reason == 'expired' else {})
                    state.update(reason=reason)
            except requests.RequestException:
                checked_at = data.get('checked_at')
                try:
                    checked_ts = float(checked_at) if checked_at is not None else None
                except (TypeError, ValueError):
                    checked_ts = None
                until = data.get('until')
                if not _is_until_active(until, now):
                    state.update(reason='expired' if until else 'offline')
                elif checked_ts is not None and 0 <= now - checked_ts < OFFLINE_GRACE_S:
                    state.update(ok=True, reason='', until=until, name=data.get('name'), offline=True)
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
    now = time.time()
    if not res.get('ok') or not _is_until_active(res.get('until'), now):
        reason = res.get('reason') or ('expired' if res.get('ok') else 'invalid')
        _save({'key': key} if reason == 'expired' else {})
        with _lock:
            _cache.update(at=0.0, state=None)
        return {'ok': False, 'reason': reason}
    _save({'key': key, 'checked_at': now, 'until': res.get('until'), 'name': res.get('name')})
    return check(force=True)


def claim_parse_slot() -> dict:
    """Reserve a subscribed Maps parse slot across the website and desktop app."""
    site = _site()
    key = _load().get('key')
    if not site or not key:
        return {
            'ok': False,
            'error': 'license',
            'message': 'Не удалось проверить подписку. Проверьте подключение и ключ лицензии.',
            'status': 503,
        }
    try:
        response = requests.post(site + '/api/app/parse-start', json={'key': key}, timeout=10)
        try:
            result = response.json()
        except ValueError:
            result = {}
        if not isinstance(result, dict):
            result = {}
        result.setdefault('ok', response.ok)
        result.setdefault('error', 'parse_start_failed' if not response.ok else '')
        result.setdefault('message', 'Не удалось запустить парсинг. Попробуйте позже.' if not response.ok else '')
        result['status'] = response.status_code
        if result.get('ok'):
            data = _load()
            data['last_parse_at'] = time.time()
            _save(data)
        return result
    except requests.RequestException:
        state = check()
        if state.get('ok') and state.get('offline'):
            data = _load()
            try:
                last_parse_at = float(data.get('last_parse_at', 0))
            except (TypeError, ValueError):
                last_parse_at = 0
            now = time.time()
            if now - last_parse_at < PARSE_COOLDOWN_S:
                return {
                    'ok': False,
                    'error': 'cooldown',
                    'message': 'Следующий парсинг будет доступен через 6 часов после предыдущего запуска.',
                    'status': 429,
                }
            data['last_parse_at'] = now
            _save(data)
            return {'ok': True, 'offline': True, 'status': 200}
        return {
            'ok': False,
            'error': 'offline',
            'message': 'Для запуска парсинга требуется подключение к серверу Fracs.',
            'status': 503,
        }


def reset() -> None:
    try:
        _file().unlink()
    except OSError:
        pass
    with _lock:
        _cache.update(at=0.0, state=None)
