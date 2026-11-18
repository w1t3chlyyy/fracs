"""Маршруты Telegram-поиска для веб-дашборда программы."""
from __future__ import annotations

from .. import tg


def register(app) -> None:
    from flask import jsonify, request

    @app.route('/api/tg/search', methods=['POST'])
    def api_tg_search():
        data = request.get_json(force=True, silent=True) or {}
        phrase = str(data.get('phrase', '')).strip()
        if len(phrase) < 3:
            return jsonify({'ok': False, 'error': 'Опишите, что ищут: например, «нужен сайт»'}), 400
        try:
            days = min(3, max(1, int(data.get('days', 3))))
        except (TypeError, ValueError):
            days = 3
        res = tg.search(phrase[:120], days)
        status = 402 if res.get('error') == 'license' else (200 if res.get('ok') else 502)
        return jsonify(res), status
