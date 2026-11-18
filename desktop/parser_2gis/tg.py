"""Telegram-поиск в программе: запрос идёт на сайт Fracs (по ключу лицензии), парсинг выполняет TG-сервис."""
from __future__ import annotations

from typing import Any

import requests

from . import license as lic


def search(phrase: str, days: int) -> dict[str, Any]:
    site = lic._site()
    key = lic._load().get('key')
    if not site or not key:
        return {'ok': False, 'error': 'Сначала активируйте лицензию'}
    try:
        r = requests.post(site + '/api/app/tg-search', json={'key': key, 'phrase': phrase, 'days': days}, timeout=70)
        data = r.json()
    except requests.RequestException:
        return {'ok': False, 'error': 'Нет связи с сервером Fracs'}
    except ValueError:
        return {'ok': False, 'error': 'Сервер вернул некорректный ответ'}
    if r.status_code == 402:
        return {'ok': False, 'error': 'license'}
    return data
