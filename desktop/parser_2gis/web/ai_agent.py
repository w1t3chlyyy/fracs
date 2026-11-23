"""AI-Агент backend: генерирует сайт по промту через LLM, отдаёт localhost-превью
и после одобрения пользователя пакует результат в ZIP и PNG-открытку с QR-кодом.

Провайдеры: Fracs AI (OpenRouter+Bazaar, только PRO), Z.ai, OpenAI, Anthropic,
Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Ollama и любой
OpenAI-совместимый endpoint (Custom). Списки моделей подтягиваются автоматически
из API провайдера, при недоступности — встроенный fallback-список.

Общий системный промт (Fracs Anti-Slop) применяется к любой подключённой
нейросети; поверх него пользователь может добавить свой ExtraПромт.

Файлы: пользователь прикрепляет свои файлы прямо в чате (скрепка), они уходят
в контекст LLM (текст — инлайном, картинки — vision-сообщением). Файлы агента
(site.zip, postcard.png) показываются справа и скачиваются.

Endpoints (регистрируются в server.py):
  GET  /api/ai/providers                    → список провайдеров (+ кто на Pro)
  GET  /api/ai/models?provider=&api_key=&base_url= → {ok, models[], auto}
  POST /api/ai/start    {prompt, api_key, model, provider, extra, session_id, prev_job}
  GET  /api/ai/status/<job_id>
  GET  /api/ai/preview/<job_id>
  POST /api/ai/approve/<job_id>
  GET  /api/ai/download/<job_id>?type=zip|png
  POST /api/ai/upload   multipart(session_id, files[])  → скрепка в чате
  GET  /api/ai/uploads/<session_id>                    → список вложений
  DELETE /api/ai/uploads/<session_id>                   → очистить вложения
  POST /api/ai/test     {api_key, model, provider}
"""
from __future__ import annotations

import base64
import io
import json
import mimetypes
import os
import secrets
import shutil
import tempfile
import threading
import time
import zipfile
from dataclasses import dataclass, field
from typing import Any

import requests

# Опциональные зависимости для открытки. qrcode + Pillow есть в бандле;
# если их нет — ZIP всё равно собирается, PNG пропускается.
try:
    import qrcode
    from qrcode.image.pil import PilImage
    from PIL import Image, ImageDraw, ImageFont
    _HAVE_QR = True
except Exception:  # pragma: no cover
    _HAVE_QR = False
    try:
        from PIL import Image, ImageDraw
    except Exception:
        Image = None
        ImageDraw = None


# ── Провайдеры ────────────────────────────────────────────────────────────────
# shape: 'openai' — chat/completions, 'anthropic' — messages API.
# models_url — откуда автоматически тянуть список моделей (None → только fallback).
# needs_key=False → провайдер работает на ключе Fracs (Fracs AI).

_OPENROUTER_URL = 'https://openrouter.ai/api/v1'
_FRACS_AI_KEY = (os.environ.get('FRACS_AI_API_KEY')
                 or os.environ.get('OPENROUTER_API_KEY') or '').strip()

_PROVIDERS: dict[str, dict] = {
    'Fracs AI': {
        'shape': 'openai',
        'chat_url': _OPENROUTER_URL + '/chat/completions',
        'models_url': _OPENROUTER_URL + '/models',
        'needs_key': False,
        'pro_only': True,
        'vision': True,
        'desc': 'Встроенный ИИ Fracs (OpenRouter + каталог Bazaar). Не нужен свой ключ.',
        'default_models': [
            'openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku',
            'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct',
            'deepseek/deepseek-chat', 'qwen/qwen-2.5-72b-instruct',
        ],
    },
    'Z.ai': {
        'shape': 'openai',
        'chat_url': 'https://api.z.ai/api/paas/v4/chat/completions',
        'models_url': 'https://api.z.ai/api/paas/v4/models',
        'needs_key': True,
        'vision': True,
        'desc': 'GLM от Z.ai',
        'default_models': ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5v', 'glm-4-32b-0414-128k'],
    },
    'OpenAI': {
        'shape': 'openai',
        'chat_url': 'https://api.openai.com/v1/chat/completions',
        'models_url': 'https://api.openai.com/v1/models',
        'needs_key': True,
        'vision': True,
        'desc': 'GPT от OpenAI',
        'default_models': ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    },
    'Anthropic': {
        'shape': 'anthropic',
        'chat_url': 'https://api.anthropic.com/v1/messages',
        'models_url': 'https://api.anthropic.com/v1/models',
        'needs_key': True,
        'vision': True,
        'desc': 'Claude от Anthropic',
        'default_models': ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219',
                           'claude-3-5-haiku-20241022'],
    },
    'Google Gemini': {
        'shape': 'openai',
        'chat_url': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        'models_url': 'https://generativelanguage.googleapis.com/v1beta/openai/models',
        'needs_key': True,
        'vision': True,
        'desc': 'Gemini от Google (OpenAI-совместимый режим)',
        'default_models': ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    },
    'OpenRouter': {
        'shape': 'openai',
        'chat_url': _OPENROUTER_URL + '/chat/completions',
        'models_url': _OPENROUTER_URL + '/models',
        'needs_key': True,
        'vision': True,
        'desc': '400+ моделей одним ключом',
        'default_models': ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku',
                           'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'],
    },
    'Groq': {
        'shape': 'openai',
        'chat_url': 'https://api.groq.com/openai/v1/chat/completions',
        'models_url': 'https://api.groq.com/openai/v1/models',
        'needs_key': True,
        'vision': False,
        'desc': 'Очень быстрые open-source модели',
        'default_models': ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant',
                           'qwen-2.5-32b', 'mixtral-8x7b-32768'],
    },
    'DeepSeek': {
        'shape': 'openai',
        'chat_url': 'https://api.deepseek.com/chat/completions',
        'models_url': 'https://api.deepseek.com/models',
        'needs_key': True,
        'vision': False,
        'desc': 'DeepSeek V3 / R1',
        'default_models': ['deepseek-chat', 'deepseek-reasoner'],
    },
    'Mistral': {
        'shape': 'openai',
        'chat_url': 'https://api.mistral.ai/v1/chat/completions',
        'models_url': 'https://api.mistral.ai/v1/models',
        'needs_key': True,
        'vision': True,
        'desc': 'Mistral Large / Codestral',
        'default_models': ['mistral-large-latest', 'mistral-medium-latest',
                           'codestral-latest', 'mistral-small-latest'],
    },
    'xAI': {
        'shape': 'openai',
        'chat_url': 'https://api.x.ai/v1/chat/completions',
        'models_url': 'https://api.x.ai/v1/models',
        'needs_key': True,
        'vision': True,
        'desc': 'Grok от xAI',
        'default_models': ['grok-3', 'grok-3-mini', 'grok-2-vision-1212'],
    },
    'Ollama': {
        'shape': 'openai',
        'chat_url': 'http://127.0.0.1:11434/v1/chat/completions',
        'models_url': 'http://127.0.0.1:11434/v1/models',
        'needs_key': False,
        'vision': False,
        'desc': 'Локальные модели Ollama (ключ не нужен)',
        'default_models': ['qwen2.5:7b', 'llama3.1:8b', 'gemma2:9b'],
    },
    'Custom': {
        'shape': 'openai',
        'chat_url': '',  # пользователь вводит base_url
        'models_url': '',
        'needs_key': True,
        'vision': True,
        'desc': 'Любой OpenAI-совместимый endpoint (vLLM, LM Studio, прокси…)',
        'default_models': [],
    },
}

_TEXT_EXTS = {'.txt', '.md', '.markdown', '.html', '.htm', '.css', '.js', '.mjs',
              '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.py', '.php',
              '.sql', '.ini', '.cfg', '.log', '.svg'}
_IMAGE_MIMES = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
                'image/gif': 'gif'}
_MAX_TEXT_CHARS = 12000          # на файл в промт
_MAX_IMAGE_BYTES = 5 * 1024 * 1024

# ── Общий системный промт (Fracs Anti-Slop) ───────────────────────────────────
# Один общий промт для ЛЮБОЙ подключённой нейросети. ExtraПромт пользователя
# добавляется поверх и имеет приоритет.

_SYSTEM_PROMPT = (
    'Ты — senior веб-дизайнер и копирайтер Fracs. Задача: собрать одностраничный '
    'сайт-визитку на чистом HTML+CSS+JS в ОДНОМ файле.\n'
    '\n'
    'ТЕХНИЧЕСКИЕ ПРАВИЛА:\n'
    '— Тёмная тема, акцент оранжевый #F26522, фон #0a0a0a–#141414, поверхности #161616/#1f1f1f.\n'
    '— Всё inline: стили в <style>, скрипты в <script>. Никаких CDN, шрифтов снаружи и внешних зависимостей.\n'
    '— Адаптив обязательно: meta viewport, grid/flex, clamp() для шрифтов, брейкпоинт на 640px.\n'
    '— Секции минимум: герой, услуги/продукты, о компании, контакты (телефон/WhatsApp/мессенджер).\n'
    '— Верни ТОЛЬКО полный HTML-документ, без пояснений и без markdown-обёртки.\n'
    '\n'
    'АНТИ-НЕЙРОСЛОП (главное):\n'
    '— Никакого шаблонного бюллетень-языка: «инновационный», «динамично развивающаяся», '
    '«мы рады представить», «индивидуальный подход», «высокое качество по доступным ценам», '
    '«ваш надёжный партнёр» — запрещены. Это маркеры генерации.\n'
    '— Пиши конкретно: реальные цифры, сроки, гарантии, материалы, бренды, районы города — '
    'всё, что есть в задании пользователя. Нет данных — пиши нейтрально и по делу, не выдумывай факты.\n'
    '— Разные по длине предложения. Ритм живого текста, а не рекламного лозунга на каждой строке.\n'
    '— Заголовки говорящие, не «Наши услуги», а «Что мы делаем» / «Ремонт за 2 дня, а не за 2 недели».\n'
    '— Не более 1 эмодзи на секцию и только если он реально уместен. Без рядов одинаковых карточек '
    'с одинаковым объёмом текста.\n'
    '— Текста должно быть столько, сколько нужно для решения клиента, без воды ради объёма.\n'
    '— Цены/сроки/контакты, которых нет в задании, помечай заметно для правки, например [ЦЕНА УТОЧНЯЕТСЯ], '
    'чтобы владелец бизнеса сразу их увидел.'
)

_EXTRA_PREFIX = (
    '\n\nДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ ПОЛЬЗОВАТЕЛЯ '
    '(имеют приоритет над правилами выше, если прямо противоречат):'
)


# ── LLM ───────────────────────────────────────────────────────────────────────

def _provider_cfg(provider: str) -> dict:
    return _PROVIDERS.get(provider) or _PROVIDERS['Z.ai']


def _resolve_chat_url(provider: str, base_url: str) -> str:
    prov = _provider_cfg(provider)
    if provider == 'Custom':
        base = (base_url or '').strip().rstrip('/')
        return (base + '/chat/completions') if base else ''
    return prov['chat_url']


def _auth_headers(provider: str, cfg: dict, api_key: str) -> dict:
    headers = {'Content-Type': 'application/json'}
    if cfg['shape'] == 'anthropic':
        if api_key:
            headers['x-api-key'] = api_key
        headers.setdefault('anthropic-version', '2023-06-01')
        return headers
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    return headers


def _image_parts_openai(att: dict) -> dict:
    return {'type': 'image_url',
            'image_url': {'url': f"data:{att['mime']};base64,{att['b64']}"}}


def _image_part_anthropic(att: dict) -> dict:
    return {'type': 'image',
            'source': {'type': 'base64', 'media_type': att['mime'], 'data': att['b64']}}


def _build_user_content(provider: str, cfg: dict, prompt: str,
                        uploads: list[dict], vision_ok: bool) -> Any:
    """user-сообщение: текст промта + текстовые вложения инлайном + картинки vision'ом."""
    text_chunks = []
    for att in uploads:
        if att['kind'] == 'text':
            body = att.get('content') or ''
            text_chunks.append(f'Файл «{att["name"]}» от пользователя:\n```\n{body}\n```')
    if text_chunks:
        prompt = prompt + '\n\n' + '\n\n'.join(text_chunks)

    images = [a for a in uploads if a['kind'] == 'image'] if vision_ok else []
    if not images:
        return prompt
    if cfg['shape'] == 'anthropic':
        content: list[dict] = [{'type': 'text', 'text': prompt or 'Используй приложенные материалы.'}]
        for att in images:
            content.append(_image_part_anthropic(att))
        return content
    content = [{'type': 'text', 'text': prompt or 'Используй приложенные материалы.'}]
    for att in images:
        content.append(_image_parts_openai(att))
    return content


def _call_llm(provider: str, api_key: str, model: str, prompt: str, extra: str = '',
              base_url: str = '', uploads: list[dict] | None = None,
              temperature: float = 0.7, max_tokens: int = 4096) -> dict:
    """Вызов LLM. Возвращает {ok, text, error, ms}."""
    started = time.time()
    cfg = _provider_cfg(provider)
    # Fracs AI работает на встроенном ключе, свой не нужен.
    if provider == 'Fracs AI':
        api_key = _FRACS_AI_KEY
        if not api_key:
            return {'ok': False, 'error': 'Fracs AI не настроен на этой сборке (нет ключа FRACS_AI_API_KEY). '
                                          'Выберите другого провайдера и вставьте свой ключ.'}
    else:
        api_key = (api_key or '').strip()
        if cfg['needs_key'] and not api_key:
            return {'ok': False, 'error': 'no_api_key'}

    url = _resolve_chat_url(provider, base_url)
    if not url:
        return {'ok': False, 'error': 'no_base_url'}

    uploads = uploads or []
    vision_ok = bool(cfg.get('vision'))
    skipped = [a['name'] for a in uploads if a['kind'] == 'image' and not vision_ok]
    system = _SYSTEM_PROMPT
    if extra:
        system += _EXTRA_PREFIX + '\n' + extra.strip()
    user_content = _build_user_content(provider, cfg, prompt, uploads, vision_ok)

    if cfg['shape'] == 'anthropic':
        body = {'model': model, 'max_tokens': int(max_tokens or 4096),
                'system': system, 'messages': [{'role': 'user', 'content': user_content}]}
    else:
        body = {'model': model, 'max_tokens': int(max_tokens or 4096),
                'temperature': float(temperature if temperature is not None else 0.7),
                'messages': [{'role': 'system', 'content': system},
                             {'role': 'user', 'content': user_content}]}

    headers = _auth_headers(provider, cfg, api_key)
    try:
        r = requests.post(url, headers=headers, json=body, timeout=180)
    except requests.RequestException as e:
        return {'ok': False, 'error': f'network: {e}', 'ms': _ms(started), 'skipped_images': skipped}
    if r.status_code >= 400:
        try:
            err = r.json()
            msg = err.get('error', {}).get('message') if isinstance(err.get('error'), dict) else str(err)
        except Exception:
            msg = r.text[:200]
        return {'ok': False, 'error': f'http {r.status_code}: {msg}', 'ms': _ms(started),
                'skipped_images': skipped}
    try:
        data = r.json()
    except ValueError:
        return {'ok': False, 'error': 'bad_response', 'ms': _ms(started), 'skipped_images': skipped}

    text = ''
    if cfg['shape'] == 'anthropic':
        for block in data.get('content', []):
            if isinstance(block, dict) and block.get('type') == 'text':
                text += block.get('text', '')
    else:
        choices = data.get('choices') or []
        if choices:
            msg_obj = choices[0].get('message') or {}
            content = msg_obj.get('content')
            if isinstance(content, list):  # некоторые провайдеры отдают список блоков
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'text':
                        text += block.get('text', '')
            elif isinstance(content, str):
                text = content
            else:
                text = choices[0].get('text', '') or ''
    if not text:
        return {'ok': False, 'error': 'empty_response', 'ms': _ms(started), 'skipped_images': skipped}
    return {'ok': True, 'text': text, 'ms': _ms(started), 'skipped_images': skipped}


def _ms(started: float) -> int:
    return int((time.time() - started) * 1000)


def _extract_html(raw: str) -> str:
    """Достаёт HTML-документ из ответа LLM (снимает markdown-ограждения)."""
    s = (raw or '').strip()
    if s.startswith('```'):
        parts = s.split('```', 2)
        if len(parts) >= 2:
            s = parts[1]
            if s.startswith('html'):
                s = s[4:]
        s = s.strip()
    if '<html' not in s.lower() and '<!doctype' not in s.lower():
        s = ('<!DOCTYPE html>\n<html lang="ru"><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width, initial-scale=1">'
             '<title>Сайт</title></head><body>' + s + '</body></html>')
    return s


def fetch_models(provider: str, api_key: str, base_url: str = '') -> dict:
    """Автосписок моделей провайдера. OpenRouter/Bazaar отдаёт каталог без ключа.
    При недоступности сети — встроенный fallback."""
    cfg = _provider_cfg(provider)
    fallback = list(cfg.get('default_models') or [])
    if provider == 'Custom':
        base = (base_url or '').strip().rstrip('/')
        if not base:
            return {'ok': False, 'error': 'no_base_url', 'models': fallback, 'auto': False}
        models_url = base + '/models'
        key = (api_key or '').strip()
    elif provider == 'Fracs AI':
        models_url = cfg['models_url']
        key = _FRACS_AI_KEY
    else:
        models_url = cfg.get('models_url') or ''
        key = (api_key or '').strip()

    if models_url:
        headers = {'Accept': 'application/json'}
        if key:
            headers['Authorization'] = f'Bearer {key}'
        if cfg['shape'] == 'anthropic':
            headers['anthropic-version'] = '2023-06-01'
        try:
            r = requests.get(models_url, headers=headers, timeout=15)
            if r.ok:
                data = r.json()
                items = data.get('data') or data.get('models') or []
                models = []
                for it in items:
                    if isinstance(it, dict):
                        mid = it.get('id') or it.get('name') or ''
                        if mid:
                            models.append(mid)
                    elif isinstance(it, str):
                        models.append(it)
                models = sorted(set(models))
                if models:
                    if provider == 'Fracs AI':
                        models = _curate_fracs_ai(models)
                    return {'ok': True, 'models': models, 'auto': True}
        except Exception:
            pass
    return {'ok': True, 'models': fallback, 'auto': False}


def _curate_fracs_ai(all_models: list[str]) -> list[str]:
    """Каталог Fracs AI (Bazaar): сначала бесплатные, дальше популярные, без редких экспериментов."""
    free, popular = [], []
    popular_prefixes = ('openai/gpt', 'anthropic/claude', 'google/gemini',
                        'meta-llama/llama', 'deepseek/deepseek', 'qwen/qwen',
                        'mistralai/mistral', 'x-ai/grok')
    for mid in all_models:
        if mid.endswith(':free') or mid.endswith('-free'):
            free.append(mid)
        elif mid.startswith(popular_prefixes):
            popular.append(mid)
    out = sorted(set(free)) + sorted(set(popular))
    return out[:120] or all_models[:120]


# ── Состояние задачи ──────────────────────────────────────────────────────────

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
    uploads: list[dict] = field(default_factory=list)
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
            'logs': self.logs[-30:],
            'preview_url': self.preview_url if self.status in ('preview', 'building', 'done') else '',
            'files': files,
            'uploads': [{'name': a['name'], 'kind': a['kind'], 'size': a['size']}
                        for a in self.uploads],
            'model': self.model, 'provider': self.provider,
            'error': self.error,
        }


def _file_kind(path: str) -> tuple[str, str]:
    """(kind, mime) по имени файла: text | image | other."""
    ext = os.path.splitext(path)[1].lower()
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if ext in _TEXT_EXTS:
        return 'text', mime
    if mime in _IMAGE_MIMES:
        return 'image', mime
    return 'other', mime


class AiAgentManager:
    """Хранит задачи AI-Агента и сессии вложений, запускает их в фоне."""

    def __init__(self, base_url: str = 'http://127.0.0.1:8666'):
        self.base_url = base_url
        self._jobs: dict[str, AiJob] = {}
        self._sessions: dict[str, list[dict]] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> AiJob | None:
        return self._jobs.get(job_id)

    # ── вложения (скрепка в чате) ──
    def add_uploads(self, session_id: str, files: list[tuple[str, str]]) -> list[dict]:
        """files: [(name, tmp_path)] — сохраняет вложения сессии."""
        out = []
        for name, src in files:
            kind, mime = _file_kind(name)
            att = {'id': secrets.token_urlsafe(6), 'name': name, 'kind': kind,
                   'mime': mime, 'size': os.path.getsize(src), 'content': '', 'b64': ''}
            if kind == 'text':
                try:
                    with open(src, 'r', encoding='utf-8', errors='replace') as f:
                        att['content'] = f.read(_MAX_TEXT_CHARS)
                except Exception:
                    att['kind'] = 'other'
            elif kind == 'image':
                try:
                    if att['size'] <= _MAX_IMAGE_BYTES:
                        with open(src, 'rb') as f:
                            att['b64'] = base64.b64encode(f.read()).decode('ascii')
                    else:
                        att['kind'] = 'other'
                except Exception:
                    att['kind'] = 'other'
            out.append(att)
        with self._lock:
            bucket = self._sessions.setdefault(session_id, [])
            bucket.extend(out)
        return out

    def pop_uploads(self, session_id: str) -> list[dict]:
        """Забрать вложения сессии (они переходят в задачу и очищаются)."""
        with self._lock:
            return self._sessions.pop(session_id, []) if session_id else []

    def list_uploads(self, session_id: str) -> list[dict]:
        with self._lock:
            return list(self._sessions.get(session_id, []))

    def clear_uploads(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    # ── запуск ──
    def start(self, prompt: str, api_key: str, model: str, provider: str, extra: str = '',
              session_id: str = '', prev_job: str = '', base_url: str = '',
              temperature: float = 0.7, max_tokens: int = 4096) -> dict:
        if provider == 'Fracs AI':
            gate = fracs_ai_allowed()
            if not gate.get('allowed'):
                return {'ok': False, 'error': gate.get('reason', 'pro_required'), 'pro_required': True}
        job_id = secrets.token_urlsafe(12)
        job = AiJob(job_id=job_id, prompt=prompt or '', model=model or '',
                    provider=provider or 'Z.ai')
        uploads = self.pop_uploads(session_id)
        if prev_job:
            prev = self.get(prev_job)
            if prev and prev.html:
                uploads = list(uploads) + [{
                    'id': 'prev', 'name': 'текущая-версия-сайта.html', 'kind': 'text',
                    'mime': 'text/html', 'size': len(prev.html),
                    'content': prev.html[:_MAX_TEXT_CHARS], 'b64': ''}]
                self._log(job, 'Учитываю предыдущую версию сайта — правки будут поверх неё.')
        job.uploads = uploads
        if uploads:
            names = ', '.join(a['name'] for a in uploads[:6])
            self._log(job, f'К задаче приложено файлов: {len(uploads)} ({names})')
        with self._lock:
            self._jobs[job_id] = job
        t = threading.Thread(target=self._run,
                             args=(job, api_key, extra, base_url, temperature, max_tokens),
                             daemon=True)
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

    def _run(self, job: AiJob, api_key: str, extra: str, base_url: str,
             temperature: float, max_tokens: int):
        try:
            job.status = 'running'
            self._log(job, f'Агент запущен. Модель: {job.model or "default"} ({job.provider}).')
            self._log(job, 'Отправляю промт в нейросеть…')
            res = _call_llm(job.provider, api_key, job.model, job.prompt, extra,
                            base_url=base_url, uploads=job.uploads,
                            temperature=temperature, max_tokens=max_tokens)
            if res.get('skipped_images'):
                self._log(job, 'Картинки пропущены (провайдер без vision): '
                           + ', '.join(res['skipped_images']))
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
            self._log(job, 'Превью готово — откройте его и посмотрите.')
            self._log(job, 'Если устраивает — нажмите «Одобрить и собрать». '
                           'Если нет — напишите правки в чат, агент учтёт текущую версию.')
            if not job.approved.wait(timeout=3600):
                job.status = 'cancelled'
                self._log(job, 'Превью устарело (прошёл час). Запустите заново.')
                return
            job.status = 'building'
            self._log(job, 'Собираю ZIP со всем сайтом…')
            self._build_zip(job)
            self._log(job, 'Рисую открытку с QR-кодом…')
            self._build_postcard(job)
            job.status = 'done'
            self._log(job, 'Готово. ZIP и открытка — справа в «Передача файлов».')
        except Exception as e:  # pragma: no cover
            job.status = 'failed'
            job.error = str(e)
            self._log(job, f'Ошибка: {e}')

    def _build_zip(self, job: AiJob):
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

    # ── открытка ──
    def _build_postcard(self, job: AiJob):
        d = tempfile.mkdtemp(prefix='fracs_ai_png_')
        png_path = os.path.join(d, 'postcard.png')
        target = f'{self.base_url}/api/ai/preview/{job.job_id}'
        if not _HAVE_QR:
            try:
                img = Image.new('RGB', (720, 400), color=(0, 0, 0))
                draw = ImageDraw.Draw(img)
                draw.text((20, 20), 'Fracs · QR-открытка', fill=(255, 255, 255))
                draw.text((20, 60), f'URL: {target}', fill=(200, 200, 200))
                img.save(png_path)
            except Exception:
                with open(png_path, 'wb') as f:
                    f.write(bytes.fromhex(
                        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4'
                        '890000000d49444154789c63f8cf0000000100010005ff0a9d0000000049454e44ae426082'))
            job.png_path = png_path
            return
        _draw_postcard(png_path, target, job.prompt or '')
        job.png_path = png_path


# ── Дизайн открытки ───────────────────────────────────────────────────────────

_ORANGE = (242, 101, 34)
_WHITE = (245, 245, 245)
_GREY = (140, 140, 140)


def _load_font(size: int, bold: bool = False, mono: bool = False):
    base = '/usr/share/fonts/truetype/dejavu/'
    if mono:
        path = base + ('DejaVuSansMono-Bold.ttf' if bold else 'DejaVuSansMono.ttf')
    else:
        path = base + ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')
    for p in (path,
              '/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def _draw_postcard(png_path: str, target: str, prompt: str):
    """Открытка 1080×1528: тёмный фон с градиентом и халфтоном, оранжевый акцент,
    QR на белой карточке с уголками-скобками, цитата-промт, подвал с адресом."""
    W, H = 1080, 1528
    img = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(img)

    # вертикальный градиент фона
    top, bottom = (24, 24, 24), (5, 5, 5)
    for y in range(H):
        t = y / H
        draw.line([(0, y), (W, y)],
                  fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))

    # тёплое оранжевое свечение из правого верхнего угла
    glow = Image.new('L', (W, H), 0)
    gdraw = ImageDraw.Draw(glow)
    for i in range(420, 0, -4):
        a = int(46 * (1 - i / 420))
        gdraw.ellipse([W - i * 1.35, -i * 0.55, W + i * 0.7, i * 1.1], fill=a)
    orange_layer = Image.new('RGB', (W, H), _ORANGE)
    img = Image.composite(orange_layer, img, glow)
    draw = ImageDraw.Draw(img)

    # халфтон: сетка точек с убывающим радиусом в левом нижнем углу
    dot_rows = 22
    dot_y0 = H - 620
    for gy in range(dot_rows):
        for gx in range(20):
            t = (gx / 20) * 0.55 + (1 - gy / dot_rows) * 0.45
            r = max(0.6, 7.5 * (1 - t) * (1 - t))
            if r < 1.0:
                continue
            x = 40 + gx * 30
            y = dot_y0 + gy * 26
            if y > H - 185:  # не заезжаем на подвал
                continue
            draw.ellipse([x - r, y - r, x + r, y + r], fill=(32, 32, 32))

    # верхняя и нижняя оранжевые полосы
    draw.rectangle([0, 0, W, 14], fill=_ORANGE)
    draw.rectangle([0, H - 14, W, H], fill=_ORANGE)

    # шапка: FRACS + AI-AGENT
    brand_f = _load_font(96, bold=True)
    tag_f = _load_font(30, bold=True)
    draw.text((72, 78), 'FRACS', font=brand_f, fill=_WHITE)
    tag = 'AI-AGENT'
    tw = draw.textlength(tag, font=tag_f)
    tag_x = 76 + draw.textlength('FRACS', font=brand_f) + 28
    draw.text((tag_x, 118), tag, font=tag_f, fill=_ORANGE)

    # линейка под шапкой
    draw.rectangle([72, 214, W - 72, 216], fill=(52, 52, 52))

    # заголовок и подзаголовок
    h1_f = _load_font(52, bold=True)
    sub_f = _load_font(28)
    draw.text((72, 258), 'Сайт, собранный нейросетью', font=h1_f, fill=_WHITE)
    draw.text((72, 332), 'Наведите камеру телефона на код — сайт откроется в браузере.',
              font=sub_f, fill=_GREY)

    # QR на белой карточке с оранжевыми уголками
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=12, border=1)
    qr.add_data(target)
    qr.make(fit=True)
    qr_img = qr.make_image(image_factory=PilImage).convert('RGB')
    qr_size = 520
    qr_img = qr_img.resize((qr_size, qr_size), Image.NEAREST)
    card = Image.new('RGB', (qr_size + 56, qr_size + 56), (10, 10, 10))
    cdraw = ImageDraw.Draw(card)
    cdraw.rounded_rectangle([0, 0, card.width - 1, card.height - 1], radius=36,
                            fill=(255, 255, 255))
    card.paste(qr_img, (28, 28))
    # мягкая тень под карточкой
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    cx, cy = (W - card.width) // 2, 430
    sdraw.rounded_rectangle([cx + 10, cy + 16, cx + card.width + 10, cy + card.height + 16],
                            radius=36, fill=(0, 0, 0, 150))
    img = Image.alpha_composite(img.convert('RGBA'), shadow).convert('RGB')
    draw = ImageDraw.Draw(img)
    img.paste(card, (cx, cy))
    # оранжевые уголки-скобки вокруг карточки
    bx0, by0, bx1, by1 = cx - 22, cy - 22, cx + card.width + 22, cy + card.height + 22
    arm = 56
    for (px, py, dx, dy) in ((bx0, by0, 1, 1), (bx1, by0, -1, 1),
                             (bx0, by1, 1, -1), (bx1, by1, -1, -1)):
        draw.line([(px, py), (px + dx * arm, py)], fill=_ORANGE, width=8)
        draw.line([(px, py), (px, py + dy * arm)], fill=_ORANGE, width=8)

    y = by1 + 44
    # цитата-промт
    q_f = _load_font(26)
    teaser = (prompt or '').strip().replace('\n', ' ')
    if len(teaser) > 150:
        teaser = teaser[:150].rstrip() + '…'
    draw.text((72, y), 'ЗАДАНИЕ АГЕНТУ', font=_load_font(22, bold=True), fill=_ORANGE)
    y += 44
    line = ''
    words = teaser.split()
    lines = []
    for w in words:
        test = (line + ' ' + w).strip()
        if draw.textlength(test, font=q_f) > W - 210:
            lines.append(line)
            line = w
        else:
            line = test
    if line:
        lines.append(line)
    lines = lines[:3]
    bar_h = max(30, len(lines) * 38 - 8)
    draw.rectangle([72, y + 4, 78, y + 4 + bar_h], fill=_ORANGE)
    for i, ln in enumerate(lines):
        draw.text((104, y + 6 + i * 38), ln, font=q_f, fill=(210, 210, 210))

    # подвал: адрес превью + подпись
    foot_f = _load_font(22, mono=True)
    url_show = target if len(target) <= 62 else target[:59] + '…'
    draw.text((72, H - 150), url_show, font=foot_f, fill=(110, 110, 110))
    sig_f = _load_font(24, bold=True)
    draw.text((72, H - 104), 'Собрано в Fracs Parser', font=sig_f, fill=(90, 90, 90))
    dot_x = 72 + draw.textlength('Собрано в Fracs Parser', font=sig_f) + 18
    draw.ellipse([dot_x, H - 90, dot_x + 10, H - 80], fill=_ORANGE)
    draw.text((dot_x + 24, H - 104), time.strftime('%d.%m.%Y'), font=sig_f, fill=(90, 90, 90))

    img.save(png_path, 'PNG')


# ── Fracs AI gate ─────────────────────────────────────────────────────────────

def fracs_ai_allowed() -> dict:
    """Fracs AI доступен только на PRO (и Бизнес — это PRO на 90 дней).
    Проверяем активную лицензию Fracs и её тариф/фичи."""
    try:
        from .. import license as fracs_license  # parser_2gis.license
    except Exception:
        try:
            from parser_2gis import license as fracs_license
        except Exception:
            return {'allowed': False, 'reason': 'license_unavailable'}
    st = fracs_license.check()
    if not st.get('ok'):
        reason = 'offline' if st.get('offline') else (st.get('reason') or 'no_license')
        return {'allowed': False, 'reason': 'Подписка Fracs не активна. Fracs AI доступен на тарифе PRO.' if reason != 'offline'
                else 'Нет связи с сервером Fracs — Fracs AI временно недоступен.'}
    features = [str(f).lower() for f in (st.get('features') or [])]
    name = str(st.get('name') or '').lower()
    if ('pro' in features or 'fracs_ai' in features or 'ai' in features or 'business' in features
            or 'pro' in name or 'business' in name):
        return {'allowed': True}
    return {'allowed': False,
            'reason': 'Fracs AI доступен только на тарифе PRO (и Бизнес). Оформите PRO в кабинете.'}


# ── Singleton и маршруты ──────────────────────────────────────────────────────

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
    """Регистрация маршрутов AI-Агента на Flask-приложении."""
    from flask import jsonify, request, send_file, Response
    mgr = init_manager(base_url)

    def _providers_payload() -> dict:
        try:
            gate = fracs_ai_allowed()
        except Exception:
            gate = {'allowed': False}
        items = []
        for pid, cfg in _PROVIDERS.items():
            items.append({
                'id': pid, 'name': pid, 'desc': cfg.get('desc', ''),
                'needs_key': bool(cfg.get('needs_key', True)),
                'vision': bool(cfg.get('vision')),
                'pro_only': bool(cfg.get('pro_only')),
                'allowed': (not cfg.get('pro_only')) or bool(gate.get('allowed')),
                'reason': '' if (not cfg.get('pro_only')) or gate.get('allowed')
                          else str(gate.get('reason') or 'pro_required'),
                'configured': (not cfg.get('pro_only')) or bool(_FRACS_AI_KEY),
                'models': list(cfg.get('default_models') or []),
            })
        return {'ok': True, 'providers': items}

    @app.route('/api/ai/providers')
    def ai_providers():
        return jsonify(_providers_payload())

    @app.route('/api/ai/models')
    def ai_models():
        provider = request.args.get('provider', 'Z.ai')
        api_key = request.args.get('api_key', '')
        base_url_q = request.args.get('base_url', '')
        if _provider_cfg(provider).get('pro_only'):
            gate = fracs_ai_allowed()
            if not gate.get('allowed'):
                return jsonify({'ok': False, 'error': str(gate.get('reason') or 'pro_required'),
                                'pro_required': True, 'models': [], 'auto': False})
        res = fetch_models(provider, api_key, base_url_q)
        return jsonify(res)

    @app.route('/api/ai/start', methods=['POST'])
    def ai_start():
        data = request.get_json(force=True, silent=True) or {}
        prompt = str(data.get('prompt', '')).strip()
        api_key = str(data.get('api_key', '')).strip()
        provider = str(data.get('provider', 'Z.ai')).strip()
        model = str(data.get('model', '')).strip()
        if provider != 'Fracs AI' and _provider_cfg(provider).get('needs_key') and not api_key:
            return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        if not prompt and not data.get('session_id'):
            return jsonify({'ok': False, 'error': 'no_prompt'}), 400
        try:
            temperature = float(data.get('temperature', 0.7))
        except (TypeError, ValueError):
            temperature = 0.7
        try:
            max_tokens = int(data.get('max_tokens', 4096))
        except (TypeError, ValueError):
            max_tokens = 4096
        res = mgr.start(prompt, api_key, model, provider,
                        extra=str(data.get('extra', '')).strip(),
                        session_id=str(data.get('session_id', '')).strip(),
                        prev_job=str(data.get('prev_job', '')).strip(),
                        base_url=str(data.get('base_url', '')).strip(),
                        temperature=temperature, max_tokens=max_tokens)
        status = 403 if (not res.get('ok') and res.get('pro_required')) else 200
        return jsonify(res), status

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

    @app.route('/api/ai/upload', methods=['POST'])
    def ai_upload():
        session_id = (request.form.get('session_id') or '').strip()
        if not session_id:
            return jsonify({'ok': False, 'error': 'no_session'}), 400
        files = request.files.getlist('files') or []
        if not files:
            return jsonify({'ok': False, 'error': 'no_files'}), 400
        saved = []
        for f in files:
            if not f or not f.filename:
                continue
            fd, tmp = tempfile.mkstemp(prefix='fracs_up_')
            with os.fdopen(fd, 'wb') as out:
                f.save(out)
            saved.append((os.path.basename(f.filename), tmp))
        if not saved:
            return jsonify({'ok': False, 'error': 'no_files'}), 400
        added = mgr.add_uploads(session_id, saved)
        for _, tmp in saved:
            try:
                os.remove(tmp)
            except OSError:
                pass
        return jsonify({'ok': True, 'files': [
            {'name': a['name'], 'kind': a['kind'], 'size': a['size']} for a in added]})

    @app.route('/api/ai/uploads/<session_id>', methods=['GET', 'DELETE'])
    def ai_uploads(session_id: str):
        if request.method == 'DELETE':
            mgr.clear_uploads(session_id)
            return jsonify({'ok': True})
        return jsonify({'ok': True, 'files': [
            {'name': a['name'], 'kind': a['kind'], 'size': a['size']}
            for a in mgr.list_uploads(session_id)]})

    @app.route('/api/ai/test', methods=['POST'])
    def ai_test():
        data = request.get_json(force=True, silent=True) or {}
        provider = str(data.get('provider', 'Z.ai')).strip()
        api_key = str(data.get('api_key', '')).strip()
        if provider == 'Fracs AI':
            gate = fracs_ai_allowed()
            if not gate.get('allowed'):
                return jsonify({'ok': False, 'error': str(gate.get('reason') or 'pro_required'),
                                'pro_required': True})
            if not _FRACS_AI_KEY:
                return jsonify({'ok': False, 'error': 'Fracs AI не настроен (нет ключа на сервере).'})
        else:
            if _provider_cfg(provider).get('needs_key') and not api_key:
                return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        res = _call_llm(provider, api_key, str(data.get('model', '')).strip(),
                        'Проверка связи. Ответь одним словом: ok.', '',
                        base_url=str(data.get('base_url', '')).strip())
        if not res.get('ok'):
            return jsonify({'ok': False, 'error': res.get('error', 'unknown'),
                            'ms': res.get('ms', 0)})
        return jsonify({'ok': True, 'ms': res.get('ms', 0)})
