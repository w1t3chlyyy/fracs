"""AI-Агент backend: generates a website from a prompt via an LLM, serves a
localhost preview, and after user approval packages the site into a ZIP and a
PNG postcard carrying a QR code that points at the preview.

The agent supports OpenAI-compatible providers (Z.ai / OpenAI / Anthropic-style
chat completions). The user supplies their own API key in the UI; the desktop
app forwards it here.

Endpoints (registered on the Flask app in server.py):
  POST /api/ai/start   {prompt, api_key, model, provider, extra}  → {ok, job_id}
  GET  /api/ai/status/<job_id>     → {ok, status, logs, preview_url, files, error}
  GET  /api/ai/preview/<job_id>    → text/html (the generated site)
  POST /api/ai/approve/<job_id>    → {ok}  (triggers ZIP + PNG build)
  GET  /api/ai/download/<job_id>?type=zip|png  → file download
  POST /api/ai/test   {api_key, model, provider} → {ok, ms}  (ping)
"""
from __future__ import annotations

import io
import json
import os
import secrets
import threading
import time
import zipfile
from dataclasses import dataclass, field
from typing import Any

import requests

# Optional deps for the postcard. qrcode + Pillow are both available in the
# desktop bundle; if missing, the ZIP still ships, the PNG is skipped.
try:
    import qrcode
    from qrcode.image.pil import PilImage
    from PIL import Image, ImageDraw, ImageFont
    _HAVE_QR = True
except Exception:  # pragma: no cover
    _HAVE_QR = False
    # Still try to import PIL alone (for the text-only fallback postcard).
    try:
        from PIL import Image, ImageDraw
    except Exception:
        Image = None
        ImageDraw = None


# ── LLM providers ──────────────────────────────────────────────────────────────

_PROVIDERS = {
    'Z.ai': {
        'url': 'https://api.z.ai/api/paas/v4/chat/completions',
        'auth_header': 'Bearer',
        'body_model_key': 'model',
        'default_model': 'glm-4.6',
    },
    'OpenAI': {
        'url': 'https://api.openai.com/v1/chat/completions',
        'auth_header': 'Bearer',
        'body_model_key': 'model',
        'default_model': 'gpt-4o-mini',
    },
    'Anthropic': {
        # Anthropic's messages API has a different shape; we adapt below.
        'url': 'https://api.anthropic.com/v1/messages',
        'auth_header': 'x-api-key',
        'body_model_key': 'model',
        'default_model': 'claude-3-5-sonnet-20240620',
    },
}

_SYSTEM_PROMPT = (
    'Ты — веб-дизайнер Fracs. Пользователь даёт промт (возможно, с данными о '
    'бизнесе). Собери одностраничный сайт-визитку на чистом HTML+CSS+JS в одном '
    'файле. Тёмная тема, акцент оранжевый (#F26522). Стили inline в <style>, '
    'скрипты inline в <script>. Без внешних зависимостей, без CDN. Адаптивный '
    '(meta viewport, grid/flex, clamp для шрифтов). Секций минимум 4: герой, '
    'услуги/продукты, о нас, контакты с кнопкой WhatsApp/телефоном. '
    'Верни только полный HTML-документ, без пояснений и без markdown-обёртки.'
)


def _call_llm(provider: str, api_key: str, model: str, prompt: str, extra: str = '') -> dict:
    """Call an LLM chat-completions API. Returns {ok, text, error, ms}."""
    started = time.time()
    prov = _PROVIDERS.get(provider) or _PROVIDERS['Z.ai']
    if not model:
        model = prov['default_model']
    api_key = (api_key or '').strip()
    if not api_key:
        return {'ok': False, 'error': 'no_api_key'}
    headers = {'Content-Type': 'application/json'}
    if prov['auth_header'] == 'Bearer':
        headers['Authorization'] = f'Bearer {api_key}'
    else:
        headers[prov['auth_header']] = api_key
        headers.setdefault('anthropic-version', '2023-06-01')

    user_msg = (prompt or '').strip()
    if extra:
        user_msg += '\n\nДополнительно от пользователя:\n' + extra

    if provider == 'Anthropic':
        body = {
            'model': model,
            'max_tokens': 4096,
            'system': _SYSTEM_PROMPT,
            'messages': [{'role': 'user', 'content': user_msg}],
        }
    else:
        body = {
            'model': model,
            'max_tokens': 4096,
            'temperature': 0.7,
            'messages': [
                {'role': 'system', 'content': _SYSTEM_PROMPT},
                {'role': 'user', 'content': user_msg},
            ],
        }

    try:
        r = requests.post(prov['url'], headers=headers, json=body, timeout=90)
    except requests.RequestException as e:
        return {'ok': False, 'error': f'network: {e}', 'ms': int((time.time() - started) * 1000)}
    if r.status_code >= 400:
        try:
            err = r.json()
            msg = err.get('error', {}).get('message') if isinstance(err.get('error'), dict) else str(err)
        except Exception:
            msg = r.text[:200]
        return {'ok': False, 'error': f'http {r.status_code}: {msg}',
                'ms': int((time.time() - started) * 1000)}
    try:
        data = r.json()
    except ValueError:
        return {'ok': False, 'error': 'bad_response', 'ms': int((time.time() - started) * 1000)}
    text = ''
    if provider == 'Anthropic':
        for block in data.get('content', []):
            if block.get('type') == 'text':
                text += block.get('text', '')
    else:
        choices = data.get('choices') or []
        if choices:
            text = choices[0].get('message', {}).get('content', '') or choices[0].get('text', '')
    if not text:
        return {'ok': False, 'error': 'empty_response',
                'ms': int((time.time() - started) * 1000)}
    return {'ok': True, 'text': text, 'ms': int((time.time() - started) * 1000)}


def _extract_html(raw: str) -> str:
    """Pull the HTML document out of an LLM response that may have markdown fences."""
    s = raw.strip()
    # strip ```html / ``` fences
    if s.startswith('```'):
        s = s.split('```', 2)
        if len(s) >= 2:
            s = s[1]
            if s.startswith('html'):
                s = s[4:]
        s = s.strip()
    if '<html' not in s.lower() and '<!doctype' not in s.lower():
        # wrap a fragment
        s = '<!DOCTYPE html>\n<html lang="ru"><head><meta charset="utf-8">' \
            '<meta name="viewport" content="width=device-width, initial-scale=1">' \
            '<title>Сайт</title></head><body>' + s + '</body></html>'
    return s


# ── Job state ─────────────────────────────────────────────────────────────────

@dataclass
class AiJob:
    job_id: str
    prompt: str
    model: str
    provider: str
    status: str = 'queued'  # queued|running|preview|building|done|failed|cancelled
    logs: list[str] = field(default_factory=list)
    html: str = ''
    files: list[dict] = field(default_factory=list)
    error: str = ''
    created_at: float = field(default_factory=time.time)
    approved: threading.Event = field(default_factory=threading.Event)
    zip_path: str = ''
    png_path: str = ''
    preview_url: str = ''

    def to_dict(self, base_url: str = '') -> dict:
        files = []
        if self.zip_path and os.path.exists(self.zip_path):
            files.append({'name': 'site.zip', 'type': 'zip',
                          'url': f'/api/ai/download/{self.job_id}?type=zip'})
        if self.png_path and os.path.exists(self.png_path):
            files.append({'name': 'postcard.png', 'type': 'png',
                          'url': f'/api/ai/download/{self.job_id}?type=png'})
        return {
            'ok': True,
            'status': self.status,
            'logs': self.logs[-20:],
            'preview_url': self.preview_url if self.status in ('preview', 'building', 'done') else '',
            'files': files,
            'error': self.error,
        }


class AiAgentManager:
    """Holds AI-Агент jobs and runs them in background threads."""

    def __init__(self, base_url: str = 'http://127.0.0.1:8666'):
        self.base_url = base_url
        self._jobs: dict[str, AiJob] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> AiJob | None:
        return self._jobs.get(job_id)

    def start(self, prompt: str, api_key: str, model: str, provider: str, extra: str = '') -> dict:
        job_id = secrets.token_urlsafe(12)
        job = AiJob(job_id=job_id, prompt=prompt or '', model=model or '',
                    provider=provider or 'Z.ai')
        with self._lock:
            self._jobs[job_id] = job
        t = threading.Thread(target=self._run, args=(job, api_key, extra), daemon=True)
        t.start()
        return {'ok': True, 'job_id': job_id}

    def approve(self, job_id: str) -> dict:
        job = self.get(job_id)
        if not job:
            return {'ok': False, 'error': 'job_not_found'}
        if job.status not in ('preview', 'done'):
            return {'ok': False, 'error': 'not_in_preview'}
        job.approved.set()
        return {'ok': True}

    def _log(self, job: AiJob, msg: str):
        job.logs.append(msg)

    def _run(self, job: AiJob, api_key: str, extra: str):
        try:
            job.status = 'running'
            self._log(job, f'Агент запущен. Модель: {job.model or "default"} ({job.provider}).')
            self._log(job, 'Отправляю промт в LLM…')
            res = _call_llm(job.provider, api_key, job.model, job.prompt, extra)
            if not res.get('ok'):
                job.status = 'failed'
                job.error = res.get('error', 'llm_error')
                self._log(job, f'Ошибка LLM: {job.error}')
                return
            self._log(job, f'Ответ получен за {res["ms"]} мс. Извлекаю HTML…')
            html = _extract_html(res['text'])
            job.html = html
            job.preview_url = f'/api/ai/preview/{job.job_id}'
            job.status = 'preview'
            self._log(job, 'Превью готово. Откройте /api/ai/preview/' + job.job_id)
            self._log(job, 'Если устраивает — нажмите «Одобрить и собрать».')
            # Wait for approval (up to 1 hour)
            if not job.approved.wait(timeout=3600):
                job.status = 'cancelled'
                self._log(job, 'Превью устарело (прошёл час). Запустите заново.')
                return
            job.status = 'building'
            self._log(job, 'Собираю ZIP со всем сайтом…')
            self._build_zip(job)
            self._log(job, 'Генерирую PNG-открытку с QR-кодом…')
            self._build_postcard(job)
            job.status = 'done'
            self._log(job, 'Готово. ZIP и PNG можно скачать справа.')
        except Exception as e:  # pragma: no cover
            job.status = 'failed'
            job.error = str(e)
            self._log(job, f'Ошибка: {e}')

    def _build_zip(self, job: AiJob):
        import tempfile
        d = tempfile.mkdtemp(prefix='fracs_ai_')
        zip_path = os.path.join(d, 'site.zip')
        site_html = os.path.join(d, 'index.html')
        with open(site_html, 'w', encoding='utf-8') as f:
            f.write(job.html)
        readme = ('# Сайт, собранный AI-Агентом Fracs\n\n'
                  'index.html — одностраничный сайт-визитка. Откройте его в браузере\n'
                  'или выложите на любой статический хостинг (Vercel/Netlify/GitHub Pages).\n\n'
                  'Промт: ' + (job.prompt[:200] or '—') + '\n')
        readme_path = os.path.join(d, 'README.md')
        with open(readme_path, 'w', encoding='utf-8') as f:
            f.write(readme)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(site_html, 'index.html')
            z.write(readme_path, 'README.md')
        job.zip_path = zip_path

    def _build_postcard(self, job: AiJob):
        import tempfile
        d = tempfile.mkdtemp(prefix='fracs_ai_png_')
        png_path = os.path.join(d, 'postcard.png')
        # QR target: the localhost preview URL (works on the same machine / LAN).
        # When the user hosts the site elsewhere, they regenerate or edit the QR.
        target = f'{self.base_url}/api/ai/preview/{job.job_id}'
        if not _HAVE_QR:
            # Fallback: a tiny placeholder PNG with text (Image/ImageDraw already
            # imported at module load when PIL is available; if PIL is missing too,
            # we just write a 1x1 placeholder bytes).
            try:
                img = Image.new('RGB', (640, 400), color=(0, 0, 0))
                draw = ImageDraw.Draw(img)
                draw.text((20, 20), 'Fracs · QR-открытка', fill=(255, 255, 255))
                draw.text((20, 60), f'URL: {target}', fill=(200, 200, 200))
                img.save(png_path)
            except Exception:
                with open(png_path, 'wb') as f:
                    f.write(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4'
                                          '890000000d49444154789c63f8cf0000000100010005ff0a9d0000000049454e44ae426082'))
            job.png_path = png_path
            return
        # Build a 720x1020 postcard: title, QR, subtitle, prompt teaser.
        W, H = 720, 1020
        img = Image.new('RGB', (W, H), color=(0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Try to load a CJK-safe font for the title.
        def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
            for p in ('/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf',
                      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else
                      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
                if os.path.exists(p):
                    try:
                        return ImageFont.truetype(p, size)
                    except Exception:
                        pass
            return ImageFont.load_default()
        title_f = _font(56, bold=True)
        sub_f = _font(22)
        small_f = _font(18)
        # Orange accent bar at the top
        draw.rectangle([0, 0, W, 12], fill=(242, 101, 34))
        draw.text((40, 60), 'Fracs', font=title_f, fill=(255, 255, 255))
        draw.text((40, 140), 'Сайт от AI-Агента', font=sub_f, fill=(200, 200, 200))
        # QR code in the middle
        qr = qrcode.QRCode(box_size=14, border=2)
        qr.add_data(target)
        qr.make(fit=True)
        qr_img = qr.make_image(image_factory=PilImage).convert('RGB')
        # Paste on a white rounded card
        qr_size = 420
        qr_img = qr_img.resize((qr_size, qr_size))
        card_x, card_y = (W - qr_size) // 2, 220
        # white background behind QR for contrast
        draw.rectangle([card_x - 16, card_y - 16, card_x + qr_size + 16, card_y + qr_size + 16],
                       fill=(255, 255, 255))
        img.paste(qr_img, (card_x, card_y))
        # Subtitle and URL
        draw.text((40, card_y + qr_size + 40), 'Отсканируйте QR-код, чтобы открыть сайт',
                  font=sub_f, fill=(255, 255, 255))
        # Wrap the prompt as a teaser at the bottom
        teaser = (job.prompt or '').strip()
        if len(teaser) > 180:
            teaser = teaser[:180] + '…'
        y = card_y + qr_size + 90
        # crude word wrap
        words = teaser.split()
        line = ''
        for w in words:
            test = (line + ' ' + w).strip()
            if draw.textlength(test, font=small_f) > W - 80:
                draw.text((40, y), line, font=small_f, fill=(160, 160, 160))
                y += 26
                line = w
            else:
                line = test
        if line:
            draw.text((40, y), line, font=small_f, fill=(160, 160, 160))
        # Footer
        draw.text((40, H - 40), 'Собрано в Fracs Parser · AI-Агент', font=small_f, fill=(120, 120, 120))
        img.save(png_path, 'PNG')
        job.png_path = png_path


# Singleton — instantiated lazily in server.create_app() so the host/port can be set.
_MANAGER: AiAgentManager | None = None


def get_manager() -> AiAgentManager:
    global _MANAGER
    if _MANAGER is None:
        _MANAGER = AiAgentManager()
    return _MANAGER


def init_manager(base_url: str) -> AiAgentManager:
    global _MANAGER
    _MANAGER = AiAgentManager(base_url=base_url)
    return _MANAGER


def register(app, base_url: str = 'http://127.0.0.1:8666') -> None:
    """Register AI-Агент routes on the Flask app."""
    from flask import jsonify, request, send_file, Response
    mgr = init_manager(base_url)

    @app.route('/api/ai/start', methods=['POST'])
    def ai_start():
        data = request.get_json(force=True, silent=True) or {}
        prompt = str(data.get('prompt', '')).strip()
        api_key = str(data.get('api_key', '')).strip()
        if not api_key:
            return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        if not prompt:
            return jsonify({'ok': False, 'error': 'no_prompt'}), 400
        model = str(data.get('model', '')).strip()
        provider = str(data.get('provider', 'Z.ai')).strip()
        extra = str(data.get('extra', '')).strip()
        return jsonify(mgr.start(prompt, api_key, model, provider, extra))

    @app.route('/api/ai/status/<job_id>')
    def ai_status(job_id: str):
        job = mgr.get(job_id)
        if not job:
            return jsonify({'ok': False, 'error': 'job_not_found'}), 404
        return jsonify(job.to_dict())

    @app.route('/api/ai/preview/<job_id>')
    def ai_preview(job_id: str):
        job = mgr.get(job_id)
        if not job or not job.html:
            return Response('Превью ещё не готово.', status=404, mimetype='text/plain')
        return Response(job.html, mimetype='text/html; charset=utf-8')

    @app.route('/api/ai/approve/<job_id>', methods=['POST'])
    def ai_approve(job_id: str):
        return jsonify(mgr.approve(job_id))

    @app.route('/api/ai/download/<job_id>')
    def ai_download(job_id: str):
        job = mgr.get(job_id)
        if not job:
            return jsonify({'ok': False, 'error': 'job_not_found'}), 404
        kind = request.args.get('type', 'zip')
        if kind == 'zip' and job.zip_path and os.path.exists(job.zip_path):
            return send_file(job.zip_path, as_attachment=True, download_name='site.zip')
        if kind == 'png' and job.png_path and os.path.exists(job.png_path):
            return send_file(job.png_path, as_attachment=True, download_name='postcard.png')
        return jsonify({'ok': False, 'error': 'file_not_ready'}), 404

    @app.route('/api/ai/test', methods=['POST'])
    def ai_test():
        data = request.get_json(force=True, silent=True) or {}
        api_key = str(data.get('api_key', '')).strip()
        if not api_key:
            return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        model = str(data.get('model', '')).strip()
        provider = str(data.get('provider', 'Z.ai')).strip()
        res = _call_llm(provider, api_key, model, 'Проверка связи. Ответь словом: ok.', '')
        if not res.get('ok'):
            return jsonify({'ok': False, 'error': res.get('error', 'unknown'),
                            'ms': res.get('ms', 0)})
        return jsonify({'ok': True, 'ms': res.get('ms', 0)})
