from __future__ import annotations

import json
import hmac
import os
import secrets
import tempfile
import threading
import webbrowser
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit

from ..config import Configuration
from ..logger import logger
from ..paths import data_path
from ..writer import WriterOptions, get_writer
from ..writer.writers import write_multisheet_xlsx
from .. import license as fracs_license
from .history import History
from .job import ParseJob
from . import tg_routes

# Sheet name for documents that carry no district label (manual URLs, etc.).
_DEFAULT_SHEET = 'Прочее'

# Download file names per format.
_DOWNLOAD_NAMES = {'csv': '2gis.csv', 'xlsx': '2gis.xlsx',
                   'json': '2gis.json', 'html': '2gis.html'}
_MAPS_DOMAINS = {
    'ru', 'kz', 'by', 'az', 'kg', 'uz', 'cz', 'eg', 'it', 'sa',
    'com.cy', 'ae', 'cl', 'qa', 'om', 'bh', 'kw', 'iq',
}

# Country code -> human name (for the link generator).
COUNTRIES = {
    'ru': 'Россия', 'kz': 'Казахстан', 'by': 'Беларусь', 'az': 'Азербайджан',
    'kg': 'Киргизия', 'uz': 'Узбекистан', 'cz': 'Чехия', 'eg': 'Египет',
    'it': 'Италия', 'sa': 'Саудовская Аравия', 'cy': 'Кипр', 'ae': 'ОАЭ',
    'cl': 'Чили', 'qa': 'Катар', 'om': 'Оман', 'bh': 'Бахрейн',
    'kw': 'Кувейт', 'iq': 'Ирак',
}


@lru_cache(maxsize=1)
def _load_cities() -> list[dict[str, Any]]:
    with open(data_path() / 'cities.json', 'r', encoding='utf-8') as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _load_districts() -> dict[str, list[str]]:
    """District names keyed by city code (for the generator picker)."""
    try:
        with open(data_path() / 'districts.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


@lru_cache(maxsize=1)
def _load_rubrics() -> list[dict[str, Any]]:
    """Flat list of rubrics for the web generator picker."""
    with open(data_path() / 'rubrics.json', 'r', encoding='utf-8') as f:
        rubrics = json.load(f)
    out = []
    for node in rubrics.values():
        # Skip the synthetic root and group headers without a usable label.
        if node.get('code') in (None, '0') or not node.get('label'):
            continue
        out.append({
            'code': node['code'],
            'label': node['label'],
            'is_russian': bool(node.get('isRussian', True)),
            'is_non_russian': bool(node.get('isNonRussian', True)),
        })
    out.sort(key=lambda r: r['label'].lower())
    return out


def _group_by_label(docs: list[Any], labels: Any) -> list[tuple[str, list[Any]]]:
    """Group documents by their district label, preserving first-seen order.

    Documents without a label fall into a single default sheet. Returns a list
    of (sheet_name, docs) pairs.
    """
    labels = list(labels or [])
    labels += [None] * (len(docs) - len(labels))  # tolerate missing/short labels
    order: list[str] = []
    groups: dict[str, list[Any]] = {}
    for doc, label in zip(docs, labels):
        key = label if label else _DEFAULT_SHEET
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(doc)
    return [(k, groups[k]) for k in order]


def _labels_from_request(data: dict[str, Any]) -> dict[str, str]:
    """URL -> district label map from the request's `directions` payload."""
    out: dict[str, str] = {}
    for d in (data.get('directions') or []):
        try:
            url = str(d.get('url', '')).strip()
            label = str(d.get('label', '')).strip()
        except (AttributeError, TypeError):
            continue
        if url and label:
            out[url] = label
    return out


def _build_config(data: dict[str, Any]) -> Configuration:
    """Build a Configuration from the web request payload."""
    config = Configuration()
    config.chrome.headless = bool(data.get('headless', True))
    config.parser.max_records = max(1, int(data.get('max_records', 100)))
    config.writer.csv.clean = bool(data.get('clean', True))

    adv = data.get('advanced', {}) or {}
    if adv:
        config.chrome.disable_images = bool(adv.get('disable_images', config.chrome.disable_images))
        config.chrome.start_maximized = bool(adv.get('start_maximized', config.chrome.start_maximized))
        if adv.get('memory_limit'):
            config.chrome.memory_limit = max(1, int(adv['memory_limit']))
        config.parser.skip_404_response = bool(adv.get('skip_404_response', config.parser.skip_404_response))
        config.parser.delay_between_clicks = max(0, int(adv.get('delay_between_clicks', 0) or 0))
        config.writer.csv.add_rubrics = bool(adv.get('add_rubrics', config.writer.csv.add_rubrics))
        config.writer.csv.add_comments = bool(adv.get('add_comments', config.writer.csv.add_comments))
        config.writer.csv.remove_empty_columns = bool(adv.get('remove_empty_columns', config.writer.csv.remove_empty_columns))
        config.writer.csv.remove_duplicates = bool(adv.get('remove_duplicates', config.writer.csv.remove_duplicates))
        if adv.get('columns_per_entity'):
            config.writer.csv.columns_per_entity = min(5, max(1, int(adv['columns_per_entity'])))
        if adv.get('encoding'):
            config.writer.encoding = str(adv['encoding'])

    f = data.get('filters', {}) or {}
    config.filters.dedup_franchises = bool(f.get('dedup_franchises'))
    config.filters.dedup_across_niches = bool(f.get('dedup_across_niches', True))
    config.filters.require_phone = bool(f.get('require_phone'))
    config.filters.require_whatsapp = bool(f.get('require_whatsapp'))
    config.filters.require_social = bool(f.get('require_social'))
    config.filters.require_email = bool(f.get('require_email'))
    config.filters.require_website = bool(f.get('require_website'))
    config.filters.require_no_website = bool(f.get('require_no_website')) and not config.filters.require_website
    config.filters.min_rating = float(f.get('min_rating', 0) or 0)
    config.filters.min_reviews = int(f.get('min_reviews', 0) or 0)
    return config


def create_app():
    """Create the Flask app for the dashboard. Requires the `web` extra."""
    try:
        from flask import Flask, jsonify, request, send_file, send_from_directory
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            'Для веб-интерфейса нужен Flask. Установите: pip install "parser-2gis[web]"'
        ) from e

    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    app = Flask(__name__, static_folder=static_dir, static_url_path='/static')
    job = ParseJob()
    trial_jobs: dict[str, ParseJob] = {}
    trial_jobs_lock = threading.Lock()
    history = History()

    def _worker_authorized() -> bool:
        token = os.environ.get('MAPS_WORKER_TOKEN', '')
        supplied = request.headers.get('Authorization', '')
        # Сравниваем байты: не-ASCII в заголовке Authorization иначе даёт TypeError.
        return bool(token and hmac.compare_digest(supplied.encode(), f'Bearer {token}'.encode()))

    def _city_keys(urls: list[str]) -> set[str] | None:
        keys = set()
        for value in urls:
            try:
                parsed = urlsplit(value)
                host = (parsed.hostname or '').lower()
                parts = [part for part in parsed.path.split('/') if part]
            except ValueError:
                return None
            domain = host[len('2gis.'):] if host.startswith('2gis.') else ''
            if domain not in _MAPS_DOMAINS or len(parts) < 3 or parts[1] != 'search':
                return None
            keys.add(f'{host}:{parts[0].lower()}')
        return keys

    def _export_send(docs, writer_opts: WriterOptions, fmt: str, labels=None):
        """Write `docs` to a temp file in `fmt` and send it as a download.

        When district `labels` split the documents into two or more groups, XLSX
        exports place each district on its own worksheet.
        """
        tmp_dir = tempfile.mkdtemp(prefix='p2gis_web_')
        out_path = os.path.join(tmp_dir, _DOWNLOAD_NAMES[fmt])

        groups = _group_by_label(docs, labels)
        # Split into per-district sheets whenever any district label is present,
        # even for a single district (so a partial run still names its sheet).
        has_district = any(name != _DEFAULT_SHEET for name, _ in groups)
        if fmt == 'xlsx' and has_district:
            write_multisheet_xlsx(out_path, groups, writer_opts)
        else:
            with get_writer(out_path, fmt, writer_opts) as writer:
                for doc in docs:
                    writer.write(doc)
        return send_file(out_path, as_attachment=True, download_name=_DOWNLOAD_NAMES[fmt])

    @app.before_request
    def _local_guard():
        # Локальный дашборд открыт только с 127.0.0.1/localhost; /api/internal/trial/*
        # обращается воркер за reverse proxy со своим Bearer-токеном — их не трогаем.
        if request.path.startswith('/api/internal/trial/'):
            return None
        host = (request.host or '').rsplit(':', 1)[0].lower()
        if host not in ('127.0.0.1', 'localhost'):
            return jsonify({'ok': False, 'error': 'bad_host'}), 403   # DNS-rebinding
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('Origin')
            if origin and urlsplit(origin).netloc != request.host:
                return jsonify({'ok': False, 'error': 'bad_origin'}), 403   # CSRF
            if request.headers.get('Sec-Fetch-Site') == 'cross-site':
                return jsonify({'ok': False, 'error': 'bad_origin'}), 403
        return None

    # ── Лицензия Fracs: без активной подписки API дашборда закрыт ──
    @app.before_request
    def _license_gate():
        path = request.path
        if path.startswith('/api/internal/trial/'):
            return None
        if path.startswith('/api/') and not path.startswith('/api/license'):
            if not fracs_license.check().get('ok'):
                return jsonify({'ok': False, 'error': 'license'}), 402
        return None

    @app.after_request
    def _headers(resp):
        resp.headers['X-Content-Type-Options'] = 'nosniff'
        resp.headers['X-Frame-Options'] = 'DENY'
        resp.headers['Referrer-Policy'] = 'no-referrer'
        return resp

    @app.route('/api/license', methods=['GET'])
    def license_status():
        return jsonify(fracs_license.check())

    @app.route('/api/license', methods=['POST'])
    def license_activate():
        data = request.get_json(force=True, silent=True) or {}
        return jsonify(fracs_license.activate(str(data.get('key', ''))))

    @app.route('/api/license', methods=['DELETE'])
    def license_reset():
        fracs_license.reset()
        return jsonify({'ok': True})

    @app.route('/')
    def index():
        return send_from_directory(static_dir, 'index.html')

    @app.route('/api/start', methods=['POST'])
    def api_start():
        if not fracs_license.check(force=True).get('ok'):
            return jsonify({'ok': False, 'error': 'license'}), 402
        data = request.get_json(force=True, silent=True) or {}
        urls = [u.strip() for u in (data.get('urls') or []) if u and u.strip()]
        if not urls:
            return jsonify({'ok': False, 'error': 'Не указаны ссылки'}), 400
        city_keys = _city_keys(urls)
        if city_keys is None:
            return jsonify({'ok': False, 'error': 'Укажите корректные ссылки поиска 2ГИС'}), 400
        if len(city_keys) > 3:
            return jsonify({'ok': False, 'error': 'За один запуск можно выбрать не более 3 городов'}), 400
        if job.running:
            return jsonify({'ok': False, 'error': 'Парсинг уже запущен'}), 409
        try:
            config = _build_config(data)
        except Exception as e:
            logger.error('Не удалось подготовить парсинг: %s', e)
            return jsonify({'ok': False, 'error': str(e)}), 400
        cooldown = fracs_license.claim_parse_slot()
        if not cooldown.get('ok'):
            return jsonify({
                'ok': False,
                'error': cooldown.get('error', 'cooldown'),
                'message': cooldown.get('message', 'Повторный парсинг доступен через 6 часов.'),
            }), int(cooldown.get('status', 429))
        try:
            job.start(config, urls, _labels_from_request(data))
        except RuntimeError as e:
            return jsonify({'ok': False, 'error': str(e)}), 409
        except Exception as e:
            logger.error('Не удалось запустить парсинг: %s', e)
            return jsonify({'ok': False, 'error': str(e)}), 400
        return jsonify({'ok': True})

    @app.route('/api/yandex', methods=['POST'])
    def api_yandex():
        """Second pass: enrich collected records from Yandex Maps (no API)."""
        if not fracs_license.check(force=True).get('ok'):
            return jsonify({'ok': False, 'error': 'license'}), 402
        data = request.get_json(force=True, silent=True) or {}
        try:
            config = _build_config(data)
            only_missing = bool(data.get('only_missing', True))
            remove_with_site = bool(data.get('remove_with_website', True))
            remove_nf = bool(data.get('remove_not_found', False))
            hid = data.get('history_id')
            if hid:
                docs = history.docs(str(hid))
                if not docs:
                    return jsonify({'ok': False, 'error': 'Запись истории не найдена'}), 404
                try:
                    config.writer = WriterOptions(**history.writer_options(str(hid)))
                except Exception:
                    pass
                job.start_yandex(config, only_missing, remove_with_site, remove_nf, docs=docs,
                                 labels=history.labels(str(hid)), urls=[])
            else:
                job.start_yandex(config, only_missing, remove_with_site, remove_nf)
        except RuntimeError as e:
            return jsonify({'ok': False, 'error': str(e)}), 409
        except Exception as e:
            logger.error('Не удалось запустить Яндекс Карты: %s', e)
            return jsonify({'ok': False, 'error': str(e)}), 400
        return jsonify({'ok': True})

    @app.route('/api/stop', methods=['POST'])
    def api_stop():
        job.stop()
        return jsonify({'ok': True})

    @app.route('/api/clear', methods=['POST'])
    def api_clear():
        return jsonify({'ok': job.clear()})

    @app.route('/api/status')
    def api_status():
        cursor = request.args.get('cursor', default=0, type=int)
        logs = job.logs[cursor:]
        return jsonify({
            'status': job.status,
            'running': job.running,
            'count': job.count,
            'error': job.error,
            'logs': logs,
            'cursor': cursor + len(logs),
        })

    @app.route('/api/results')
    def api_results():
        return jsonify({'records': job.results()})

    @app.route('/api/internal/trial/health')
    def api_trial_health():
        if not _worker_authorized():
            return jsonify({'ok': False, 'error': 'unauthorized'}), 401
        return jsonify({'ok': True})

    @app.route('/api/internal/trial/jobs', methods=['POST'])
    def api_trial_start():
        if not _worker_authorized():
            return jsonify({'ok': False, 'error': 'unauthorized'}), 401
        data = request.get_json(force=True, silent=True) or {}
        urls = [str(u).strip() for u in (data.get('urls') or []) if str(u).strip()]
        if not urls:
            return jsonify({'ok': False, 'error': 'Не указаны ссылки'}), 400
        if len(urls) > 30:
            return jsonify({'ok': False, 'error': 'За один пробный запуск можно передать не более 30 ссылок'}), 400
        city_keys = _city_keys(urls)
        if city_keys is None:
            return jsonify({'ok': False, 'error': 'Укажите корректные ссылки поиска 2ГИС'}), 400
        if len(city_keys) > 3:
            return jsonify({'ok': False, 'error': 'За один запуск можно выбрать не более 3 городов'}), 400
        with trial_jobs_lock:
            if any(existing.running for existing in trial_jobs.values()):
                return jsonify({'ok': False, 'error': 'Парсер уже занят другим заданием'}), 409
            try:
                max_records = min(60, max(1, int(data.get('max_records', 20))))
                config = _build_config({**data, 'max_records': max_records, 'headless': True})
                config.filters.require_website = False
                config.filters.require_no_website = True
                trial_job = ParseJob()
                job_id = secrets.token_urlsafe(24)
                trial_job.start(config, urls, _labels_from_request(data), require_license=False, save_history=False)
                trial_jobs[job_id] = trial_job
                completed = [key for key, existing in trial_jobs.items() if not existing.running and key != job_id]
                for key in completed[:-9]:
                    del trial_jobs[key]
            except RuntimeError as e:
                return jsonify({'ok': False, 'error': str(e)}), 409
            except Exception as e:
                logger.error('Не удалось запустить внутренний пробный парсинг: %s', e)
                return jsonify({'ok': False, 'error': str(e)}), 400
        return jsonify({'ok': True, 'jobId': job_id})

    @app.route('/api/internal/trial/jobs/<job_id>')
    def api_trial_status(job_id: str):
        if not _worker_authorized():
            return jsonify({'ok': False, 'error': 'unauthorized'}), 401
        with trial_jobs_lock:
            trial_job = trial_jobs.get(job_id)
        if not trial_job:
            return jsonify({'ok': False, 'error': 'Задание не найдено'}), 404
        payload = {
            'ok': True,
            'status': trial_job.status,
            'running': trial_job.running,
            'count': trial_job.count,
            'error': trial_job.error,
            'logs': trial_job.logs[-100:],
        }
        if trial_job.status in ('done', 'stopped'):
            payload['records'] = trial_job.results()
        return jsonify(payload)

    @app.route('/api/generator')
    def api_generator():
        """Data for the link generator: countries, cities, rubrics."""
        cities = [
            {'name': c['name'], 'code': c['code'], 'domain': c['domain'],
             'country_code': c['country_code']}
            for c in _load_cities()
        ]
        countries = [{'code': k, 'name': v} for k, v in COUNTRIES.items()]
        countries.sort(key=lambda c: c['name'])
        return jsonify({'countries': countries, 'cities': cities,
                        'rubrics': _load_rubrics(), 'districts': _load_districts()})

    @app.route('/api/download')
    def api_download():
        if not fracs_license.check(force=True).get('ok'):
            return jsonify({'ok': False, 'error': 'license'}), 402
        fmt = request.args.get('format', 'csv')
        if fmt not in _DOWNLOAD_NAMES:
            return jsonify({'ok': False, 'error': 'Неизвестный формат'}), 400
        if not job.count:
            return jsonify({'ok': False, 'error': 'Нет данных'}), 400

        try:
            assert job.collector is not None
            return _export_send(job.collector.docs, job.collector._options, fmt,
                                job.collector.labels)
        except Exception as e:
            logger.error('Ошибка экспорта: %s', e)
            return jsonify({'ok': False, 'error': str(e)}), 500

    @app.route('/api/history')
    def api_history():
        return jsonify({'items': history.list()})

    @app.route('/api/history/<hid>/results')
    def api_history_results(hid):
        docs = history.docs(hid)
        if docs is None:
            return jsonify({'ok': False, 'error': 'Запись не найдена'}), 404
        return jsonify({'records': history.records(hid)})

    @app.route('/api/history/<hid>/download')
    def api_history_download(hid):
        if not fracs_license.check(force=True).get('ok'):
            return jsonify({'ok': False, 'error': 'license'}), 402
        fmt = request.args.get('format', 'csv')
        if fmt not in _DOWNLOAD_NAMES:
            return jsonify({'ok': False, 'error': 'Неизвестный формат'}), 400
        docs = history.docs(hid)
        if not docs:
            return jsonify({'ok': False, 'error': 'Запись не найдена'}), 404
        try:
            opts = WriterOptions(**history.writer_options(hid))
        except Exception:
            opts = WriterOptions()
        try:
            return _export_send(docs, opts, fmt, history.labels(hid))
        except Exception as e:
            logger.error('Ошибка экспорта истории: %s', e)
            return jsonify({'ok': False, 'error': str(e)}), 500

    @app.route('/api/history/merge', methods=['POST'])
    def api_history_merge():
        data = request.get_json(force=True, silent=True) or {}
        ids = [str(i) for i in (data.get('ids') or [])]
        if not ids:
            return jsonify({'ok': False, 'error': 'Не выбраны записи'}), 400
        result = history.merge_and_save(ids)
        if not result:
            return jsonify({'ok': False, 'error': 'Нет данных для объединения'}), 400
        new_id, count = result
        return jsonify({'ok': True, 'id': new_id, 'count': count})

    @app.route('/api/history/<hid>', methods=['DELETE'])
    def api_history_delete(hid):
        return jsonify({'ok': history.delete(hid)})

    tg_routes.register(app)
    return app


def run_server(host: str = '127.0.0.1', port: int = 8666, open_browser: bool = True) -> None:
    """Run the dashboard server (blocking)."""
    app = create_app()
    url = f'http://{host}:{port}/'
    logger.info('Веб-интерфейс запущен: %s', url)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    app.run(host=host, port=port, threaded=True, debug=False, use_reloader=False)
