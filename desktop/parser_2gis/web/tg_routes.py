"""Маршруты Telegram-поиска для веб-дашборда программы."""
from __future__ import annotations

import os

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


def register_send(app) -> None:
    """Рассылка открыток из привязанных Telegram-аккаунтов (тариф Ultra, см. tg_send.py)."""
    from flask import jsonify, request

    from .. import tg_send

    def _gate():
        a = tg_send.access()
        if not a['allowed']:
            return jsonify({'ok': False, 'error': a['reason'], 'ultra_required': True}), 403
        return None

    def _postcards():
        from . import ai_agent
        out = []
        for job in list(ai_agent.get_manager()._jobs.values()):
            if job.png_path and os.path.exists(job.png_path):
                out.append({'job_id': job.job_id, 'title': ai_agent.business_parts(job.prompt)[0],
                            'created': job.created_at})
        return sorted(out, key=lambda x: -x['created'])[:20]

    @app.route('/api/tgsend/state')
    def tgsend_state():
        a = tg_send.access()
        return jsonify({'ok': True, 'allowed': a['allowed'], 'reason': a['reason'],
                        'accounts': tg_send.list_accounts() if a['allowed'] else [],
                        'postcards': _postcards() if a['allowed'] else [],
                        'limits': {'daily_default': tg_send.DEFAULT_DAILY, 'daily_max': tg_send.MAX_DAILY,
                                   'hourly': tg_send.MAX_HOURLY, 'delay': list(tg_send.DELAY_RANGE),
                                   'max_recipients': tg_send.MAX_RECIPIENTS_PER_TASK}})

    @app.route('/api/tgsend/login/start', methods=['POST'])
    def tgsend_login_start():
        g = _gate()
        if g:
            return g
        d = request.get_json(force=True, silent=True) or {}
        return jsonify(tg_send.login_start(d.get('api_id'), str(d.get('api_hash', '')), str(d.get('phone', ''))))

    @app.route('/api/tgsend/login/confirm', methods=['POST'])
    def tgsend_login_confirm():
        g = _gate()
        if g:
            return g
        d = request.get_json(force=True, silent=True) or {}
        return jsonify(tg_send.login_confirm(str(d.get('login_id', '')), str(d.get('code', '')),
                                             str(d.get('password', ''))))

    @app.route('/api/tgsend/accounts/<acc_id>', methods=['DELETE', 'PATCH'])
    def tgsend_account(acc_id):
        g = _gate()
        if g:
            return g
        if request.method == 'PATCH':
            d = request.get_json(force=True, silent=True) or {}
            try:
                tg_send.set_daily_cap(acc_id, int(d.get('daily_cap', tg_send.DEFAULT_DAILY)))
            except (TypeError, ValueError):
                return jsonify({'ok': False, 'error': 'bad_cap'}), 400
            return jsonify({'ok': True, 'accounts': tg_send.list_accounts()})
        return jsonify({'ok': tg_send.delete_account(acc_id), 'accounts': tg_send.list_accounts()})

    @app.route('/api/tgsend/send', methods=['POST'])
    def tgsend_send():
        g = _gate()
        if g:
            return g
        d = request.get_json(force=True, silent=True) or {}
        from . import ai_agent
        job = ai_agent.get_manager().get(str(d.get('job_id', '')))
        png = job.png_path if job else ''
        res = tg_send.start_send(str(d.get('account_id', '')), png,
                                 [str(x) for x in (d.get('recipients') or [])][:500],
                                 [str(x) for x in (d.get('texts') or [])][:10])
        return jsonify(res), (200 if res.get('ok') else 400)

    @app.route('/api/tgsend/status/<task_id>')
    def tgsend_status(task_id):
        g = _gate()
        if g:
            return g
        st = tg_send.task_state(task_id)
        return (jsonify({'ok': True, **st}) if st else (jsonify({'ok': False, 'error': 'not_found'}), 404))

    @app.route('/api/tgsend/cancel/<task_id>', methods=['POST'])
    def tgsend_cancel(task_id):
        g = _gate()
        if g:
            return g
        return jsonify({'ok': tg_send.cancel(task_id)})
