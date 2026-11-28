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
  GET  /api/ai/download/<job_id>?type=zip|png|video
  POST /api/ai/upload   multipart(session_id, files[])  → скрепка в чате
  GET  /api/ai/uploads/<session_id>                    → список вложений
  DELETE /api/ai/uploads/<session_id>                   → очистить вложения
  POST /api/ai/test     {api_key, model, provider}
"""
from __future__ import annotations

import base64
import colorsys
import html as _html
import io
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import zipfile
from dataclasses import dataclass, field
from typing import Any

import requests

# Открытка, видеообзор и шрифты — в review_media.py (Pillow + qrcode опциональны:
# без них ZIP всё равно собирается, а открытка пропускается).
try:
    from .review_media import (_HAVE_QR, business_parts, draw_postcard,
                               record_review_mp4, render_review_html)
except Exception:  # запуск как скрипта, не как пакета
    from parser_2gis.web.review_media import (_HAVE_QR, business_parts, draw_postcard,  # type: ignore
                                              record_review_mp4, render_review_html)
try:
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None


# ── Провайдеры ────────────────────────────────────────────────────────────────
# shape: 'openai' — chat/completions, 'anthropic' — messages API.
# models_url — откуда автоматически тянуть список моделей (None → только fallback).
# needs_key=False → провайдер работает на ключе Fracs (Fracs AI).


def _load_dotenv() -> None:
    """Загружает .env при старте: ключи OPENROUTER_API_KEY, TWENTYFIRST_API_KEY и др.

    Ищет .env в папке программы (для .exe — рядом с exe), корне проекта и в CWD.
    Переменные, уже заданные в окружении, НЕ перезаписываются. Формат:
    KEY=VALUE (кавычки и префикс 'export ' допускаются, # — комментарий).
    """
    import sys
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    candidates = [os.path.join(here, '.env')]
    if getattr(sys, 'frozen', False):
        candidates.append(os.path.join(os.path.dirname(sys.executable), '.env'))
    candidates.append(os.path.join(os.getcwd(), '.env'))
    for path in candidates:
        try:
            if not os.path.isfile(path):
                continue
            with open(path, encoding='utf-8') as fh:
                for raw in fh:
                    line = raw.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    if line.startswith('export '):
                        line = line[7:]
                    k, _, v = line.partition('=')
                    k = k.strip()
                    v = v.strip().strip('"').strip("'").strip()
                    if k and k not in os.environ:
                        os.environ[k] = v
        except OSError:
            continue


_load_dotenv()

_OPENROUTER_URL = 'https://openrouter.ai/api/v1'
_FRACS_AI_KEY = (os.environ.get('OPENROUTER_API_KEY') or '').strip()
_FRACS_DOWN = 'Fracs AI временно недоступен. Попробуйте позже.'

# Fracs AI сам подбирает модель под задачу — пользователю не нужно разбираться в моделях
# OpenRouter и переключать их вручную. Премиум-кодинг-модель идёт на генерацию сайтов (главный
# продукт, здесь качество критично), дешёвая — на лёгкие задачи (поисковые фразы, чат, ответы).
_BEST_CODE_MODEL = 'anthropic/claude-sonnet-4'           # топ для фронтенд-кода, vision
_CHEAP_CHAT_MODEL = 'deepseek/deepseek-chat'             # дёшево и быстро для не-кодинга
_FALLBACK_CODE_MODELS = ('anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash', _CHEAP_CHAT_MODEL, 'openai/gpt-4o-mini')
_NO_TEMP_MODELS = {'anthropic/claude-sonnet-5.5', 'openai/gpt-5.6-terra-pro'}

# Cohere Command A работает ВМЕСТЕ с OpenRouter: тексты/арт-дирекшн до сборки и вычитка после.
# Ограничения модели: ответ ≤ 8000 токенов, контекст 256K, только текст (без vision).
_COHERE_MODEL = 'command-a-03-2025'
_COHERE_OR_MODEL = 'cohere/command-a'                     # тот же Command A, но через OpenRouter
_COHERE_URL = 'https://api.cohere.ai/compatibility/v1'    # OpenAI-совместимый режим Cohere
_COHERE_KEY = (os.environ.get('COHERE_API_KEY') or '').strip()   # только режим владельца / dev
_COHERE_TASKS = ('copy', 'critique')
# FRACS_PIPELINE=0 — выключить конвейер (копирайт Cohere + вычитка) и собирать сайт как раньше
_PIPELINE_ON = (os.environ.get('FRACS_PIPELINE', '1').strip().lower() not in ('0', 'false', 'no', 'off'))

_PROVIDERS: dict[str, dict] = {
    'Fracs AI': {
        'shape': 'openai',
        'chat_url': _OPENROUTER_URL + '/chat/completions',
        'models_url': _OPENROUTER_URL + '/models',
        'needs_key': False,
        'pro_only': True,
        'vision': True,
        'desc': 'Встроенная нейронка Fracs. Свой ключ не нужен.',
        'default_models': ['fracs-ai'],
    },
    'Cohere': {
        # Свой ключ Cohere (dashboard.cohere.com). OpenAI-совместимый режим. Command A отвечает до
        # 8000 токенов — для сайта целиком мало, лучше как копирайтер/редактор; сборку — Fracs AI.
        'shape': 'openai',
        'chat_url': _COHERE_URL + '/chat/completions',
        'models_url': _COHERE_URL + '/models',
        'needs_key': True,
        'vision': False,
        'desc': 'Command A от Cohere: сильный русский, тексты и вычитка (ответ до 8000 токенов)',
        'default_models': ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024'],
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
        'default_models': ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
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
    'Qwen': {
        # Alibaba DashScope (international / Singapore). OpenAI-совместимый режим.
        # 1M бесплатных токенов на 90 дней на каждую модель — ключ sk-... в кабинете
        # bailian.alibaba.com. qwen3-coder-plus — лучшая для фронтенд-кода.
        'shape': 'openai',
        'chat_url': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
        'models_url': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
        'needs_key': True,
        'vision': True,
        'desc': 'Qwen от Alibaba (DashScope). 1M бесплатных токенов на 90 дней.',
        'default_models': ['qwen3-coder-plus', 'qwen3.8-max', 'qwen3.7-plus',
                           'qwen3-vl-plus', 'qwen3.8-flash'],
    },
    'BazaarLink': {
        # Тайваньский AI-агрегатор. OpenAI-совместимый, бесплатные модели без кредитки.
        # Ключ в кабинете bazaarlink.ai/keys. qwen3.7-flash — vision, 1M ctx, лучшая из бесплатных.
        # Лимиты: 10 RPM / 60 units/day (без кредитки), 20 RPM / 120 units/day (с кредиткой).
        'shape': 'openai',
        'chat_url': 'https://api.bazaarlink.ai/v1/chat/completions',
        'models_url': 'https://api.bazaarlink.ai/v1/models',
        'needs_key': True,
        'vision': True,
        'desc': 'Бесплатные модели (Qwen, DeepSeek, NVIDIA) без кредитки.',
        'default_models': ['qwen/qwen3.7-flash', 'deepseek/deepseek-v4-flash-0731free',
                           'nvidia/nemotron-3.5-lightning-free', 'reflection/beam-free'],
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
_MAX_PREV_HTML = 34000           # предыдущий макет целиком (правки «Изменить макет»)
_MAX_UPLOAD_BYTES = 15 * 1024 * 1024   # лимит одного вложения (15 МБ)
_MAX_IMAGE_BYTES = 5 * 1024 * 1024

# ── Общий системный промт (Fracs Anti-Slop) ───────────────────────────────────
# Один общий промт для ЛЮБОЙ подключённой нейросети. ExtraПромт пользователя
# добавляется поверх и имеет приоритет.

# ── Шрифты: только семейства с кириллицей ─────────────────────────────────────
# Раньше рецепты требовали Fraunces / Sora / Bebas Neue, а серверный промт — Space Grotesk и
# Clash Display. У Space Grotesk нет кириллицы (проверено), у остальных — по имеющимся данным тоже;
# русские заголовки падали в системный шрифт и сайт выглядел «сломанным». Теперь список жёсткий.
# Значение: (доступные начертания, есть ли курсив, запасной generic).
_CYR_FONTS: dict[str, tuple[tuple[int, ...], bool, str]] = {
    'Manrope': ((400, 500, 600, 700), False, 'sans-serif'),
    'Onest': ((400, 500, 600, 700), False, 'sans-serif'),
    'Golos Text': ((400, 500, 600, 700), False, 'sans-serif'),
    'Unbounded': ((400, 500, 600), False, 'sans-serif'),
    'Inter Tight': ((400, 500, 600), False, 'sans-serif'),
    'Inter': ((400, 500, 600), False, 'sans-serif'),
    'Oswald': ((400, 500, 600, 700), False, 'sans-serif'),
    'PT Sans': ((400, 700), True, 'sans-serif'),
    'PT Serif': ((400, 700), True, 'serif'),
    'Playfair Display': ((400, 500, 600, 700), True, 'serif'),
    'Cormorant Garamond': ((400, 500, 600, 700), True, 'serif'),
    'Lora': ((400, 500, 600, 700), True, 'serif'),
    'Bitter': ((400, 500, 600, 700), True, 'serif'),
    'Montserrat': ((400, 500, 600, 700), False, 'sans-serif'),
    'Rubik': ((400, 500, 600, 700), False, 'sans-serif'),
    'Jost': ((400, 500, 600, 700), False, 'sans-serif'),
}
# Шрифты без кириллицы → чем заменяем, если модель всё же их подключила.
_NO_CYR_FONTS = {
    'Space Grotesk': 'Manrope', 'Fraunces': 'Playfair Display', 'Sora': 'Onest',
    'Bebas Neue': 'Oswald', 'Poppins': 'Onest', 'Outfit': 'Onest',
    'Clash Display': 'Unbounded', 'Satoshi': 'Manrope', 'General Sans': 'Manrope',
}
_FONT_LIST_TXT = ', '.join(_CYR_FONTS)


def _fonts_link(families: list[str]) -> str:
    """Валидный URL Google Fonts css2 для списка семейств (только существующие начертания)."""
    parts = []
    for fam in dict.fromkeys(f for f in families if f):
        spec = _CYR_FONTS.get(fam)
        name = fam.replace(' ', '+')
        if not spec:
            parts.append('family=' + name)          # без осей — всегда валидно
            continue
        weights, ital, _ = spec
        if ital:
            tuples = [f'0,{w}' for w in weights] + [f'1,{w}' for w in weights]
            parts.append(f'family={name}:ital,wght@' + ';'.join(tuples))
        else:
            parts.append(f'family={name}:wght@' + ';'.join(str(w) for w in weights))
    return 'https://fonts.googleapis.com/css2?' + '&'.join(parts) + '&display=swap'


# Короткие типографические детали (основная система — в _SYSTEM_PROMPT).
TYPO_RULES = (
    '\n\nДЕТАЛИ ТИПОГРАФИКИ И КОНТРАСТА:\n'
    '— Цифры-статы (если блок нужен): display-шрифт (вес 500–600, clamp(36px,4.2vw,54px), '
    'font-variant-numeric:tabular-nums), подпись 13px color:var(--muted).\n'
    '— Кнопки: min-height:46px, padding:12px 24px, border-radius:var(--radius-btn,10px), вес 600, font-size:15px; '
    'СТРОГО ОДНА акцентная кнопка (.btn) на первый экран/блок, вторая — только контурная (.btn.ghost).\n'
    '— Заголовки: text-wrap:balance; h1 и h2 не рвутся на висячее слово. Контейнер текста: max-width:62ch.'
)

# ── Единый системный промт сборщика сайтов ────────────────────────────────────
# ВАЖНО: первая строка — маркер. Сервер (appRoutes.ts) видит его и НЕ добавляет свой
# дизайн-промт: раньше модель получала два системных промта с противоречиями.
_SYSTEM_PROMPT = (
    'DESIGN_SYSTEM_VERSION: client-2026-11-28.2\n'
    'Ты — арт-директор и senior фронтенд-разработчик веб-студии. Собираешь сайт-визитку локального '
    'бизнеса ОДНИМ самодостаточным HTML-файлом. Планка — дорогая авторская студийная вёрстка, '
    'где каждый сайт ощущается спроектированным именно под этот бренд, без шаблонного конструктора.\n'
    '\n'
    'ИСТОЧНИКИ (по приоритету):\n'
    '1. Требования пользователя в конце промта — главнее всего.\n'
    '2. Блок «АРТ-ДИРЕКШН И ТЕКСТЫ», если он есть: палитра, шрифты, архетип и тексты — оттуда; '
    'тексты вставляй ДОСЛОВНО (можно чуть сжать, если не влезает, но не переписывать).\n'
    '3. Данные карточки бизнеса из задания — единственный источник фактов.\n'
    '4. НАПРАВЛЕНИЕ И АРХЕТИП ДИЗАЙНА — задают композицию, скругления, набор секций и визуальный характер.\n'
    '\n'
    'ПРАВДА (нарушение = брак):\n'
    '— Факты только из карточки или запроса: название, адрес, телефон, контакты, рейтинг и число отзывов. '
    'Выдуманные цены, годы работы, число клиентов, сертификаты, «№1», фейковые отзывы, часы работы — ЗАПРЕЩЕНЫ. '
    'Если пользователь сам попросил прайс или гарантию без точных цифр — описывай категории услуг и порядок расчёта '
    'без выдуманных рублей и процентов.\n'
    '— Нет цифр/данных — не делай полосу статов (.stats). Нет точных цен — блок «Как узнать стоимость» с кнопкой связи.\n'
    '— Никаких скобочных заглушек вида [УТОЧНИТЬ] или TODO.\n'
    '\n'
    'АРХИТЕКТУРА CSS И ВЁРСТКИ (КРИТИЧНО — НИКАКИХ ШАБЛОННЫХ КЛОНОВ):\n'
    '— НЕ копируй один и тот же конвейер из 8 секций на каждый сайт! Собирай 4–5 выразительных, '
    'содержательных секций по выбранному АРХЕТИПУ (например: кофейне/пекарне не нужны надуманные FAQ и '
    'сухая таблица статов, ей ближе меню-строки, живые фото и приглашение зайти; клинике или автосервису '
    'подходят шаги приёма, направления и короткий FAQ).\n'
    '— Все секции (<header>, <section>, <footer>) ОБЯЗАНЫ иметь внутренний контейнер .container '
    '(max-width:1180px; margin:0 auto; padding:0 clamp(18px,4vw,32px)). Ни один заголовок, абзац, список '
    'или CTA не имеет права прилипать к левому краю экрана (x=0).\n'
    '— Обязательно пиши ПОЛНЫЙ CSS в <style> для КАЖДОГО класса и КАЖДОЙ секции до </body>. '
    'Не бросай стили на полпути к низу страницы!\n'
    '— Если на странице есть <details>/<summary> (FAQ), ВСЕГДА стилизуй: summary{list-style:none} и '
    'summary::-webkit-details-marker{display:none}, padding:20px 0, border-bottom:1px solid var(--line).\n'
    '— В CTA-секции избегай одинакового кислотного баннера во всю ширину на каждом сайте: чередуй '
    'спокойные сплит-блоки контактов, тёмные/светлые редакционные карточки и аккуратные приглашения с адресом.\n'
    '— Липкая шапка (.topbar): строго 1 строка из 3 зон (название слева · 3–4 ссылки меню · 1 кнопка действия) '
    'и кнопка-бургер на мобиле (<760px).\n'
    '\n'
    'ФОТОГРАФИИ БИЗНЕСА (СТРОГИЕ ПРАВИЛА — БЕЗ КАШИ И ОБРЕЗКИ):\n'
    '— Если в задании даны файлы assets/photo-*.jpg — ОБЯЗАТЕЛЬНО встрой их точными путями src="assets/photo-1.jpg" '
    '(внешние стоковые URL запрещены!).\n'
    '— РЕКОМЕНДУЕМЫЙ ПО УМОЛЧАНИЮ СПОСОБ ДЛЯ ГЕРОЯ: выделенный медиа-слот БЕЗ текста поверх фото — '
    'сплит .hero-grid (2 колонки: слева текст на чистом фоне var(--bg), справа <figure class="hero-media">'
    '<img src="assets/photo-1.jpg" alt="..."></figure> с width:100%; height:100%; min-height:340px; max-height:540px; '
    'aspect-ratio:4/3; object-fit:cover; display:block; border-radius:var(--radius-media,14px)). Так текст всегда читаем, '
    'а фото не режется наполовину экрана!\n'
    '— ЕСЛИ делаешь фоновое фото во весь hero: картинка ОБЯЗАНА занимать ВСЕ 100% ширины и высоты '
    '(position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0 — НИКОГДА не половина ширины слева!), '
    'сплошной тёмный градиент-оверлей ::after { content:""; position:absolute; inset:0; z-index:1; '
    'background:linear-gradient(95deg, rgba(10,12,16,.88) 0%, rgba(10,12,16,.72) 55%, rgba(10,12,16,.40) 100%) } '
    'и светлый контрастный текст #ffffff в .container { position:relative; z-index:2 }.\n'
    '— Дополнительные фото (assets/photo-2.jpg .. photo-4.jpg) размещай в чистых рамках aspect-ratio:4/3 '
    'или 16/10 (object-fit:cover; width:100%; height:100%; display:block) в галерее или блоке «О нас» без текста поверх.\n'
    '\n'
    'ДИЗАЙН, КНОПКИ И ЭСТЕТИКА:\n'
    '— Токены в :root: --bg --surface --surface-2 --line --text --muted --accent --accent-contrast --radius-btn --radius-card; '
    'дальше только var(). Акцент один (≤ 10% площади). Контраст текста ≥ 4.5:1.\n'
    '— КНОПКИ: в одном блоке/экране — СТРОГО ОДНА залитая кнопка (.btn) цвета var(--accent). Вторая кнопка (если нужна) '
    'ОБЯЗАНА быть контурной (.btn.ghost: background:transparent; color:var(--text); border:1px solid var(--line))! '
    'Форму кнопок (--radius-btn) бери из архетипа (4px / 8px / 12px / 999px), не лепи везде одинаковые пилюли.\n'
    f'— Шрифты: максимум 2 семейства, ТОЛЬКО из списка с кириллицей: {_FONT_LIST_TXT}. '
    'Любой другой шрифт — брак. У PT Sans и PT Serif только 400 и 700, у остальных 400–700. Одна ссылка Google Fonts.\n'
    '— Масштаб: H1 clamp(2.35rem,5.4vw,4.35rem), line-height 1.06, letter-spacing -0.02em, вес 500–700, '
    'до 8 слов, text-wrap:balance; H2 clamp(1.7rem,3.4vw,2.65rem); текст 16–17px/1.65 (≤ 62ch).\n'
    '— Сетка 8px. Чередуй композиции от секции к секции, избегай унылой сетки из 3 одинаковых коробок.\n'
    '— Запрещено: сине-фиолетовые градиенты, декоративные пульсирующие точки, толстые левые полосы (border-left:4px), '
    'стеклянные карточки поверх кислотных пятен, статичные цветные пилюли-теги пачками, emoji, lorem ipsum.\n'
    '— Строгий бан на пошлые рекламные клише: «как у бабушки», «на любой вкус», «доставим с улыбкой», «с любовью», '
    '«для всей семьи», «приятные цены», «широкий выбор/ассортимент», «уютная атмосфера», «лучшие в городе», '
    '«инновационный», «индивидуальный подход», «высокое качество», «надёжный партнёр», «команда профессионалов», «мы рады представить».\n'
    '— Иконки: аккуратные инлайн SVG (20–24px, stroke="currentColor", stroke-width="1.75") только по смыслу.\n'
    '\n'
    'ТЕХНИКА:\n'
    '— Один файл: весь CSS внутри <style>, весь JS внутри <script>. Внешнее — только <link> Google Fonts; '
    'картинки — только assets/* из задания. Внешние JS-библиотеки с CDN НЕ подключай: пиши чистый нативный JS '
    '(IntersectionObserver + плавные взаимодействия + бургер-меню).\n'
    '— Безопасность показа контента: НИКОГДА не оставляй секции невидимыми! В <script> добавь '
    'document.documentElement.classList.add("js"), сразу покажи элементы в первом экране и запусти '
    'IntersectionObserver({threshold:0.05}) + страховочный setTimeout(850ms), снимающий скрытие со всех .r.\n'
    '— Адаптив: 375px без горизонтального скролла, брейкпоинт 760px, сетки grid-template-columns:minmax(0,1fr), '
    'кнопки/ссылки ≥ 44px по высоте, @media (prefers-reduced-motion: reduce).\n'
    '— Объём 17 000–32 000 символов. Документ ОБЯЗАН заканчиваться </style>...</script></body></html>.\n'
    '\n'
    'СКРЫТНОСТЬ (нарушение = брак): нигде в HTML, CSS, JS, комментариях, data-*, тексте не упоминай нейросети '
    '(GPT, Claude, Gemini, Llama, DeepSeek, Qwen, Grok, Mistral, Cohere, GLM, OpenAI, Anthropic, «AI», '
    '«нейросеть», «сгенерировано», «powered by») и названия UI-китов/библиотек. Подвал — контакты бизнеса '
    'или «Разработка: студия Фракс».\n'
    'Верни ТОЛЬКО полный чистый HTML-документ без markdown-ограждений (без ```html) и без пояснений. '
    'В начале — комментарий <!-- brief: 2 предложения о характере бизнеса и выбранной композиции -->.'
)


_EXTRA_PREFIX = (
    '\n\nДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ ПОЛЬЗОВАТЕЛЯ '
    '(имеют приоритет над правилами выше, если прямо противоречат):'
)


# ── Архетипы композиций (разная структура, скругления и характер секций) ──────
_LAYOUT_ARCHETYPES: dict[str, dict[str, Any]] = {
    'editorial': {
        'title': 'Журнальный разворот',
        'btn_radius': '6px',
        'card_radius': '10px',
        'hero': 'Асимметричный разворот 58/42: слева крупный заголовок с выразительной строкой-акцентом и 1 основной кнопкой (+ опционально лёгкая ссылка), справа — чистое обрамлённое фото (.hero-media) или типографическая выноска без текста поверх картинки.',
        'sections': '4–5 секций без шаблонной сетки: (1) герой → (2) услуги/меню в виде журнальных строк (.menu-row / .rowp с тонкими 1px линиями, БЕЗ тяжёлых карточек) → (3) история/подход в 2 колонках с крупной цитатой и дополнительным фото → (4) компактный блок адреса, контактов и приглашения вместо дежурного FAQ.',
    },
    'architectural_split': {
        'title': 'Архитектурный сплит',
        'btn_radius': '4px',
        'card_radius': '4px',
        'hero': 'Чёткая модульная композиция с тонкими линиями 1px: слева иерархия (надзаголовок · H1 · 1-2 строчки смысла · акцентная кнопка + .btn.ghost), справа — ровный медиа-фрейм .hero-media или строгая карточка записи с адресом и часами.',
        'sections': '4–5 секций: (1) герой → (2) направления/услуги в структурной сетке 2+1 или табличной матрице с чёткой нумерацией 01–04 → (3) как вы работаете: горизонтальная шкала из 3 конкретных шагов → (4) контакты/запись в 2 колонки и подвал.',
    },
    'swiss_catalog': {
        'title': 'Швейцарский каталог',
        'btn_radius': '6px',
        'card_radius': '8px',
        'hero': 'Чистый высокий контраст без лишних фоновых узоров: сдержанный компактный topbar, точный заголовок слева, крупная прямоугольная карточка фото справа (.hero-media).',
        'sections': '4–5 секций: (1) герой → (2) открытая галерея/витрина с фото (если есть 2+ фото) и короткими подписями → (3) подробный каталог позиций/услуг в табличных строках (.rowp) с понятным порядком расчёта → (4) FAQ-аккордеон (если уместен для ниши) или блок прямых контактов.',
    },
    'atelier_sticky': {
        'title': 'Бутик с sticky-колонкой',
        'btn_radius': '12px',
        'card_radius': '14px',
        'hero': 'Воздушный первый экран: компактная подача, выразительная типографика и чистое фото с мягким радиусом без заслоняющих плашек.',
        'sections': '4–5 секций: (1) герой → (2) «Sticky-витрина»: слева закреплённый (position:sticky; top:96px) заголовок раздела и короткий лид, справа — вертикальная лента 4–5 направлений с тонкими разделителями → (3) 2-колоночный блок о мастерах/подходе и фото → (4) камерная карточка записи и подвал.',
    },
    'clean_trust': {
        'title': 'Светлый сервис / Доверие',
        'btn_radius': '12px',
        'card_radius': '16px',
        'hero': 'Спокойный сплит 55/45 на чистом светлом фоне: слева ясное предложение и одна уверенная кнопка, справа — фото пространства или аккуратная белая карта с реальным рейтингом/телефоном.',
        'sections': '4–5 секций: (1) герой → (2) короткая полоса доверия с реальными данными карточки (если рейтинг/отзывы есть) → (3) направления в 2-колоночной сетке спокойных карточек с тонкими границами → (4) 3 понятных шага обращения + частые вопросы (по делу) → (5) светлая/спокойная карточка записи.',
    },
    'warm_craft': {
        'title': 'Тёплое ремесло',
        'btn_radius': '999px',
        'card_radius': '16px',
        'hero': 'Тёплая камерная подача: живое фото в чистом фрейме (.hero-media) рядом с крупным заголовком, одна выразительная кнопка и аккуратная контурная .btn.ghost.',
        'sections': '4–5 секций: (1) герой → (2) открытое меню/направления в 2 колонки без громоздких рамок → (3) лента атмосферы (2 фото рядом или фото + рассказ о процессе без штампов) → (4) спокойный блок адреса/телефона (без ядовитого полноширинного баннера) и подвал.',
    },
}


# ── Вариативные палитры и шрифты для каждой рубрики (нет двух одинаковых) ────
STYLE_VARIANTS: dict[str, list[dict[str, Any]]] = {
    'auto': [
        {
            'name': 'Графит и сталь',
            'theme': 'dark',
            'archetype': 'architectural_split',
            'palette': {'bg': '#101215', 'surface': '#171a20', 'surface_2': '#1f242c', 'line': 'rgba(255,255,255,.11)', 'text': '#f3f4f6', 'muted': '#9aa3b2', 'accent': '#ea580c', 'accent_contrast': '#ffffff'},
            'fonts': ('Oswald', 'Manrope'),
        },
        {
            'name': 'Светлый инженерный бокс',
            'theme': 'light',
            'archetype': 'swiss_catalog',
            'palette': {'bg': '#f4f5f7', 'surface': '#ffffff', 'surface_2': '#e9ecf1', 'line': 'rgba(15,23,42,.11)', 'text': '#111827', 'muted': '#4b5563', 'accent': '#c2410c', 'accent_contrast': '#ffffff'},
            'fonts': ('Jost', 'Golos Text'),
        },
        {
            'name': 'Тёмный сапфир и титан',
            'theme': 'dark',
            'archetype': 'atelier_sticky',
            'palette': {'bg': '#0c1118', 'surface': '#131b26', 'surface_2': '#1b2534', 'line': 'rgba(226,232,240,.11)', 'text': '#f1f5f9', 'muted': '#94a3b8', 'accent': '#0284c7', 'accent_contrast': '#ffffff'},
            'fonts': ('Unbounded', 'Onest'),
        },
    ],
    'coffee': [
        {
            'name': 'Утренняя бумага и терракота',
            'theme': 'light',
            'archetype': 'editorial',
            'palette': {'bg': '#f7f2ea', 'surface': '#fffdf9', 'surface_2': '#efe7da', 'line': 'rgba(42,32,23,.12)', 'text': '#241b13', 'muted': '#6f6152', 'accent': '#b4481e', 'accent_contrast': '#fffdf9'},
            'fonts': ('Playfair Display', 'Manrope'),
        },
        {
            'name': 'Обжарка и олива',
            'theme': 'dark',
            'archetype': 'warm_craft',
            'palette': {'bg': '#171411', 'surface': '#211c17', 'surface_2': '#2b251f', 'line': 'rgba(244,237,225,.12)', 'text': '#f5efe6', 'muted': '#b2a696', 'accent': '#d97724', 'accent_contrast': '#171411'},
            'fonts': ('Lora', 'Onest'),
        },
        {
            'name': 'Матча и фарфор',
            'theme': 'light',
            'archetype': 'warm_craft',
            'palette': {'bg': '#f4f5f0', 'surface': '#ffffff', 'surface_2': '#e7ebe1', 'line': 'rgba(26,40,30,.12)', 'text': '#18241c', 'muted': '#55655a', 'accent': '#2f6b48', 'accent_contrast': '#ffffff'},
            'fonts': ('Bitter', 'Golos Text'),
        },
        {
            'name': 'Бистро и бордо',
            'theme': 'light',
            'archetype': 'swiss_catalog',
            'palette': {'bg': '#faf7f2', 'surface': '#ffffff', 'surface_2': '#f1ebe2', 'line': 'rgba(38,24,26,.11)', 'text': '#231618', 'muted': '#6d5c5e', 'accent': '#8f2433', 'accent_contrast': '#ffffff'},
            'fonts': ('Cormorant Garamond', 'Manrope'),
        },
    ],
    'medical': [
        {
            'name': 'Светлый бирюзовый покой',
            'theme': 'light',
            'archetype': 'clean_trust',
            'palette': {'bg': '#f7fafb', 'surface': '#ffffff', 'surface_2': '#ebf3f5', 'line': 'rgba(15,23,42,.09)', 'text': '#0f172a', 'muted': '#516173', 'accent': '#0e7490', 'accent_contrast': '#ffffff'},
            'fonts': ('Onest', 'Golos Text'),
        },
        {
            'name': 'Тёплый минерал и шалфей',
            'theme': 'light',
            'archetype': 'atelier_sticky',
            'palette': {'bg': '#f6f7f4', 'surface': '#ffffff', 'surface_2': '#eaede6', 'line': 'rgba(24,34,28,.10)', 'text': '#18221c', 'muted': '#58665d', 'accent': '#2e6f56', 'accent_contrast': '#ffffff'},
            'fonts': ('Inter Tight', 'Manrope'),
        },
        {
            'name': 'Клинический кобальт',
            'theme': 'light',
            'archetype': 'architectural_split',
            'palette': {'bg': '#f8fafc', 'surface': '#ffffff', 'surface_2': '#eef2f7', 'line': 'rgba(15,23,42,.10)', 'text': '#0f172a', 'muted': '#475569', 'accent': '#1d4ed8', 'accent_contrast': '#ffffff'},
            'fonts': ('Rubik', 'Golos Text'),
        },
    ],
    'beauty': [
        {
            'name': 'Тёмная латунь',
            'theme': 'dark',
            'archetype': 'atelier_sticky',
            'palette': {'bg': '#12100e', 'surface': '#1b1815', 'surface_2': '#24201b', 'line': 'rgba(239,233,223,.11)', 'text': '#f2ece2', 'muted': '#a39a8b', 'accent': '#c9a45c', 'accent_contrast': '#141210'},
            'fonts': ('Cormorant Garamond', 'Manrope'),
        },
        {
            'name': 'Светлый шёлк и оникс',
            'theme': 'light',
            'archetype': 'editorial',
            'palette': {'bg': '#faf8f5', 'surface': '#ffffff', 'surface_2': '#f1ece5', 'line': 'rgba(28,25,23,.10)', 'text': '#1c1917', 'muted': '#6c655e', 'accent': '#854d27', 'accent_contrast': '#ffffff'},
            'fonts': ('Playfair Display', 'Onest'),
        },
        {
            'name': 'Глубокий изумруд',
            'theme': 'dark',
            'archetype': 'warm_craft',
            'palette': {'bg': '#0e1714', 'surface': '#15221e', 'surface_2': '#1d2d28', 'line': 'rgba(236,243,239,.11)', 'text': '#eef4f0', 'muted': '#9cb0a5', 'accent': '#d4a359', 'accent_contrast': '#121916'},
            'fonts': ('Lora', 'Manrope'),
        },
    ],
    'build': [
        {
            'name': 'Тёмный бетон и янтарь',
            'theme': 'dark',
            'archetype': 'architectural_split',
            'palette': {'bg': '#15181d', 'surface': '#1d2128', 'surface_2': '#252a33', 'line': 'rgba(255,255,255,.10)', 'text': '#eceae5', 'muted': '#949ca8', 'accent': '#e09a2b', 'accent_contrast': '#15181d'},
            'fonts': ('Unbounded', 'Golos Text'),
        },
        {
            'name': 'Светлый чертёж и грифель',
            'theme': 'light',
            'archetype': 'swiss_catalog',
            'palette': {'bg': '#f3f3f0', 'surface': '#ffffff', 'surface_2': '#e6e6e1', 'line': 'rgba(24,24,27,.12)', 'text': '#18181b', 'muted': '#52525b', 'accent': '#b45309', 'accent_contrast': '#ffffff'},
            'fonts': ('Jost', 'Onest'),
        },
        {
            'name': 'Архитектурный хвойный',
            'theme': 'dark',
            'archetype': 'editorial',
            'palette': {'bg': '#111615', 'surface': '#18201e', 'surface_2': '#212b28', 'line': 'rgba(235,240,238,.11)', 'text': '#eef2f0', 'muted': '#97a6a0', 'accent': '#d97736', 'accent_contrast': '#ffffff'},
            'fonts': ('Bitter', 'Manrope'),
        },
    ],
    'neutral': [
        {
            'name': 'Светлый редакционный',
            'theme': 'light',
            'archetype': 'editorial',
            'palette': {'bg': '#f8f7f4', 'surface': '#ffffff', 'surface_2': '#efede8', 'line': 'rgba(20,20,22,.10)', 'text': '#141416', 'muted': '#5f5f66', 'accent': '#1d4ed8', 'accent_contrast': '#ffffff'},
            'fonts': ('Onest', 'Manrope'),
        },
        {
            'name': 'Сдержанный графит и охра',
            'theme': 'dark',
            'archetype': 'atelier_sticky',
            'palette': {'bg': '#0e1013', 'surface': '#16191e', 'surface_2': '#1f232b', 'line': 'rgba(255,255,255,.10)', 'text': '#f3f4f6', 'muted': '#9aa1ad', 'accent': '#d89b3c', 'accent_contrast': '#111214'},
            'fonts': ('Jost', 'Golos Text'),
        },
        {
            'name': 'Морской сланец',
            'theme': 'light',
            'archetype': 'clean_trust',
            'palette': {'bg': '#f5f7fa', 'surface': '#ffffff', 'surface_2': '#e8eef5', 'line': 'rgba(15,23,42,.10)', 'text': '#0f172a', 'muted': '#475569', 'accent': '#0f766e', 'accent_contrast': '#ffffff'},
            'fonts': ('Playfair Display', 'Manrope'),
        },
    ],
}


def _pick_creative_direction(prompt: str, style: str = '', seed: str = '') -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Подбирает (style_key, variant, archetype) так, чтобы разные проекты и повторные запуски не выглядели клонами."""
    style_key = style if style in STYLE_VARIANTS else _pick_style(prompt)
    variants = STYLE_VARIANTS.get(style_key) or STYLE_VARIANTS['neutral']
    low = (prompt or '').lower()
    if any(k in low for k in ('светл', 'light', 'белы', 'кремов', 'пастель')):
        light = [v for v in variants if v['theme'] == 'light']
        if light:
            variants = light
    elif any(k in low for k in ('тёмн', 'темн', 'dark', 'чёрн', 'черн')):
        dark = [v for v in variants if v['theme'] == 'dark']
        if dark:
            variants = dark
    if seed:
        idx = sum(ord(ch) * (i + 1) for i, ch in enumerate(seed)) % len(variants)
    else:
        idx = secrets.randbelow(len(variants))
    var = variants[idx]
    arch_key = var['archetype']
    arch = _LAYOUT_ARCHETYPES.get(arch_key) or _LAYOUT_ARCHETYPES['editorial']
    return style_key, var, {'key': arch_key, **arch}


def _format_style_recipe(style_key: str, var: dict[str, Any], arch: dict[str, Any]) -> str:
    pal = var['palette']
    disp_font, body_font = var['fonts']
    fams = [disp_font] + ([body_font] if body_font != disp_font else [])
    fonts_url = _fonts_link(fams)
    disp_gen = _CYR_FONTS[disp_font][2]
    body_gen = _CYR_FONTS[body_font][2]
    return (
        f'СТИЛЕВОЕ НАПРАВЛЕНИЕ — «{var["name"]}» (рубрика: {style_key}, архетип: {arch["title"]}):\n'
        f'Палитра: --bg:{pal["bg"]}; --surface:{pal["surface"]}; --surface-2:{pal["surface_2"]}; '
        f'--line:{pal["line"]}; --text:{pal["text"]}; --muted:{pal["muted"]}; '
        f'--accent:{pal["accent"]}; --accent-contrast:{pal["accent_contrast"]}; '
        f'--radius-btn:{arch["btn_radius"]}; --radius-card:{arch["card_radius"]}.\n'
        f'Шрифты (подключи ровно этой ссылкой Google Fonts: {fonts_url}):\n'
        f'  --font-display: "{disp_font}", {disp_gen}; --font-text: "{body_font}", {body_gen}.\n'
        f'ГЕРОЙ: {arch["hero"]}\n'
        f'СЕКЦИИ: {arch["sections"]}'
    )


STYLE_PROMPTS = {
    k: _format_style_recipe(k, vs[0], {'key': vs[0]['archetype'], **_LAYOUT_ARCHETYPES[vs[0]['archetype']]})
    for k, vs in STYLE_VARIANTS.items()
}

_STYLE_KEYS = (
    (('автосервис', 'детейлинг', 'автомойк', 'шиномонтаж', 'сто ', 'автосалон', 'автомаст', 'авто'), 'auto'),
    (('кофе', 'кондитер', 'пекар', 'выпечк', 'хлеб', 'круассан', 'кафе', 'бар ', 'пицц', 'ресторан', 'столовая', 'общепит'), 'coffee'),
    (('стомат', 'клиник', 'медиц', 'массаж', 'косметол', 'медцентр', 'аптека', 'ветерина'), 'medical'),
    (('барбер', 'парикмах', 'салон красоты', 'ногт', 'маник', 'спа', 'массажн'), 'beauty'),
    (('строй', 'ремонт', 'мебель', 'производств', 'монтаж', 'мебельн', 'склад', 'логист'), 'build'),
)


def _pick_style(user_text: str) -> str:
    low = (user_text or '').lower()
    for keys, style in _STYLE_KEYS:
        if any(k in low for k in keys):
            return style
    return 'neutral'


# ── Встроенная библиотека студийных компонентов и микро-анимаций ──────────────
BLOCKS_LIB = (
    '\n\nМОДУЛЬНАЯ БИБЛИОТЕКА СТУДИЙНЫХ КОМПОНЕНТОВ (выбери ТОЛЬКО 2–3 подходящих паттерна под выбранный АРХЕТИП, '
    'не вставляй все подряд и всегда опирайся на токены :root):\n'
    '1) [БАЗА И КОНТЕЙНЕР]:\n'
    '   *,*::before,*::after{box-sizing:border-box}\n'
    '   body{margin:0;background:var(--bg);color:var(--text);font:400 16px/1.65 var(--font-text);overflow-x:hidden}\n'
    '   .container{width:100%;max-width:1180px;margin:0 auto;padding:0 clamp(18px,4vw,32px)}\n'
    '   section{padding:clamp(60px,7.5vw,100px) 0}\n'
    '   h1,h2,h3{margin:0;font-family:var(--font-display);line-height:1.08;text-wrap:balance}\n'
    '   p{margin:0;max-width:62ch}\n'
    '2) [ШАПКА]: .topbar{position:sticky;top:0;z-index:40;background:var(--bg);border-bottom:1px solid var(--line)} '
    '.topbar-in{height:70px;display:flex;align-items:center;justify-content:space-between;gap:24px} '
    '.nav-links{display:flex;gap:24px} @media(max-width:760px){.nav-links{display:none}}\n'
    '3) [ГЕРОЙ-СПЛИТ С ФОТО БЕЗ НАЛОЖЕНИЯ ТЕКСТА]: '
    '.hero-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);gap:clamp(28px,5vw,56px);align-items:center} '
    '.hero-media{margin:0;border-radius:var(--radius-card,14px);overflow:hidden;border:1px solid var(--line);background:var(--surface)} '
    '.hero-media img{width:100%;height:100%;min-height:320px;max-height:520px;aspect-ratio:4/3;object-fit:cover;display:block} '
    '@media(max-width:900px){.hero-grid{grid-template-columns:minmax(0,1fr)}}\n'
    '4) [ГАЛЕРЕЯ ФОТО]: .photo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px} '
    '.photo-frame{margin:0;border-radius:var(--radius-card,12px);overflow:hidden;border:1px solid var(--line);aspect-ratio:4/3} '
    '.photo-frame img{width:100%;height:100%;object-fit:cover;display:block}\n'
    '5) [КНОПКИ — СТРОГО 1 АКЦЕНТНАЯ + ОПЦИОНАЛЬНО .btn.ghost]: '
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:46px;'
    'padding:12px 24px;border-radius:var(--radius-btn,10px);background:var(--accent);color:var(--accent-contrast);font-weight:600;'
    'font-size:15px;text-decoration:none;border:1px solid transparent;transition:transform .18s,filter .18s} '
    '.btn:hover{transform:translateY(-1px);filter:brightness(1.06)} '
    '.btn.ghost{background:transparent;color:var(--text);border-color:var(--line)} '
    '.btn.ghost:hover{border-color:var(--accent);color:var(--accent)}\n'
    '6) [ЖУРНАЛЬНЫЕ СТРОКИ / КАТАЛОГ]: .rowp{display:flex;align-items:baseline;gap:14px;padding:16px 0;'
    'border-bottom:1px solid var(--line)} .rowp b{font-weight:600} .rowp i{flex:1;'
    'border-bottom:1px dotted var(--line)} .rowp span{color:var(--accent);font-weight:600;'
    'font-variant-numeric:tabular-nums;white-space:nowrap}\n'
    '7) [STICKY-ВИТРИНА]: .sticky-split{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:clamp(28px,5vw,60px);align-items:start} '
    '.sticky-aside{position:sticky;top:96px} @media(max-width:860px){.sticky-split{grid-template-columns:minmax(0,1fr)}.sticky-aside{position:static}}\n'
    '8) [СТРУКТУРНЫЕ КАРТОЧКИ 2 КОЛОНКИ / 2+1]: .grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px} '
    '@media(max-width:860px){.grid-2{grid-template-columns:minmax(0,1fr)}} '
    '.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-card,12px);padding:26px}\n'
    '9) [FAQ АККОРДЕОН (только если уместен по нише)]: '
    '.faq details{border-bottom:1px solid var(--line)} '
    '.faq summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;font-size:17px;font-weight:500;cursor:pointer} '
    '.faq summary::-webkit-details-marker{display:none}\n'
    '10) [ПОЯВЛЕНИЕ + БЕЗОПАСНЫЙ JS]: '
    '.js .r{opacity:0;transform:translateY(14px);transition:opacity .45s cubic-bezier(.22,1,.36,1),transform .45s cubic-bezier(.22,1,.36,1)} '
    '.js .r.in{opacity:1;transform:none} @media(prefers-reduced-motion:reduce){.js .r{opacity:1;transform:none;transition:none}}\n'
    '11) [ПОДВАЛ]: .footer{border-top:1px solid var(--line);padding:38px 0;color:var(--muted);font-size:14px} '
    '.footer-in{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px}'
)


# ── Сохранение сайтов в проект: sites/<slug>/index.html + versions/ ───────────
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _default_sites_dir() -> str:
    """Папка сайтов: env → прежняя <проект>/sites (если уже есть) → профиль пользователя,
    чтобы собранные сайты переживали обновление программы."""
    env = os.environ.get('FRACS_SITES_DIR')
    if env:
        return env
    legacy = os.path.join(_PROJECT_ROOT, 'sites')
    if os.path.isdir(legacy):
        return legacy
    if sys.platform == 'win32':
        base = os.environ.get('APPDATA') or os.path.expanduser('~')
        return os.path.join(base, 'fracs-parser', 'sites')
    if sys.platform == 'darwin':
        return os.path.expanduser('~/Library/Application Support/fracs-parser/sites')
    return os.path.expanduser('~/.local/share/fracs-parser/sites')


_SITES_DIR = _default_sites_dir()

_TRANSLIT = {'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
             'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
             'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
             'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
             'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'}


def _slugify(text: str, fallback: str = 'site') -> str:
    s = (text or '').lower()
    s = ''.join(_TRANSLIT.get(ch, ch) for ch in s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    s = re.sub(r'-{2,}', '-', s)[:48]
    return s or fallback


def _business_name(prompt: str) -> str:
    """Название бизнеса для открытки и видеообзора."""
    return business_parts(prompt)[0]


def _slug_from_prompt(prompt: str, fallback: str = 'site') -> str:
    """Слаг из названия бизнеса: строка «Название: …» в промте-карточке."""
    m = re.search(r'^Название:\s*(.+)$', prompt or '', re.M)
    return _slugify(m.group(1) if m else (prompt or '')[:60], fallback)


def _save_site_files(job) -> str:
    """Пишет сайт в <проект>/sites/<slug>/ : index.html (последняя версия),
    assets/* (фотографии бизнеса, если есть) и versions/v<N>.html (история).
    Возвращает локальный URL /sites/<slug>/."""
    try:
        d = os.path.join(_SITES_DIR, job.site_slug)
        os.makedirs(os.path.join(d, 'versions'), exist_ok=True)
        assets = getattr(job, 'assets', None) or []
        if assets:
            assets_dir = os.path.realpath(os.path.join(d, 'assets'))
            os.makedirs(assets_dir, exist_ok=True)
            for asset in assets:
                fname = os.path.basename(str(asset.get('filename') or ''))
                raw = asset.get('bytes')
                if not fname or not raw:
                    continue
                target = os.path.realpath(os.path.join(assets_dir, fname))
                if not target.startswith(assets_dir + os.sep):
                    continue
                with open(target, 'wb') as af:
                    af.write(raw)
        with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(job.html)
        with open(os.path.join(d, 'versions', f'v{job.version:02d}.html'), 'w',
                  encoding='utf-8') as f:
            f.write(job.html)
        meta = {'slug': job.site_slug, 'version': job.version, 'job_id': job.job_id,
                'updated': time.strftime('%Y-%m-%d %H:%M:%S'),
                'prompt': (job.prompt or '')[:300]}
        with open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        return f'/sites/{job.site_slug}/'
    except OSError as e:
        job.logs.append(f'Не удалось сохранить файлы сайта: {e}')
        return ''


# ── Безопасная загрузка фото карточки бизнеса (2GIS / Яндекс Карты) ────────────

_MAX_CARD_PHOTOS = 6
_PHOTO_FETCH_TIMEOUT = 10


def _is_public_url(url: str) -> bool:
    """Проверяет, что URL использует http/https и резолвится только в публичные IP (защита от SSRF)."""
    try:
        parsed = urllib.parse.urlsplit((url or '').strip())
    except ValueError:
        return False
    if parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname:
        return False
    host = parsed.hostname.strip().lower()
    if host in ('localhost', 'localhost.localdomain') or host.endswith('.local'):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    if not infos:
        return False
    for info in infos:
        ip_str = info[4][0].split('%')[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False
    return True


def _safe_http_get(url: str, max_bytes: int = _MAX_IMAGE_BYTES,
                   timeout: int = _PHOTO_FETCH_TIMEOUT) -> tuple[bytes, str] | None:
    """Скачивает ресурс по публичному URL, проверяя каждый редирект от SSRF."""
    cur = (url or '').strip()
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; FracsBuilder/1.0)'}
    for _ in range(3):
        if not _is_public_url(cur):
            return None
        try:
            r = requests.get(cur, headers=headers, timeout=timeout, stream=True, allow_redirects=False)
        except requests.RequestException:
            return None
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get('Location') or ''
            r.close()
            if not loc:
                return None
            cur = urllib.parse.urljoin(cur, loc)
            continue
        if not r.ok:
            r.close()
            return None
        ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        buf = bytearray()
        try:
            for chunk in r.iter_content(chunk_size=32768):
                if not chunk:
                    continue
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    return None
        finally:
            r.close()
        return bytes(buf), ctype
    return None


def _normalize_photo_bytes(raw: bytes, ctype: str) -> tuple[bytes, str, str] | None:
    """Проверяет, что это настоящая картинка, и при наличии Pillow оптимизирует её в JPEG."""
    if not raw:
        return None
    if Image is not None:
        try:
            with Image.open(io.BytesIO(raw)) as im:
                im.load()
                if im.width < 60 or im.height < 60:
                    return None
                if im.mode in ('RGBA', 'LA', 'P'):
                    bg = Image.new('RGB', im.size, (255, 255, 255))
                    rgba = im.convert('RGBA')
                    bg.paste(rgba, mask=rgba.split()[-1])
                    rgb = bg
                else:
                    rgb = im.convert('RGB')
                max_side = 1280
                if max(rgb.size) > max_side:
                    rgb.thumbnail((max_side, max_side), Image.LANCZOS)
                out = io.BytesIO()
                rgb.save(out, format='JPEG', quality=82, optimize=True)
                return out.getvalue(), 'image/jpeg', 'jpg'
        except Exception:
            return None
    # Без Pillow проверяем сигнатуры JPEG / PNG / WEBP.
    if raw.startswith(b'\xff\xd8\xff'):
        return raw, 'image/jpeg', 'jpg'
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        return raw, 'image/png', 'png'
    if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
        return raw, 'image/webp', 'webp'
    if ctype in _IMAGE_MIMES:
        ext = _IMAGE_MIMES[ctype]
        if ext != 'gif':
            return raw, ctype, ext
    return None


def _discover_card_photos(card_url: str, ymaps_url: str = '') -> list[str]:
    """Запасной поиск фото со страницы карточки 2GIS/Яндекс Карт, если в сохранённой записи их нет."""
    found: list[str] = []
    seen: set[str] = set()
    for page_url in (card_url, ymaps_url):
        u = (page_url or '').strip()
        if not u:
            continue
        host = (urllib.parse.urlsplit(u).hostname or '').lower()
        if not (host == '2gis.com' or host.endswith('.2gis.com') or host.endswith('.2gis.ru')
                or host.endswith('.yandex.ru') or host.endswith('.yandex.com')):
            continue
        got = _safe_http_get(u, max_bytes=1_500_000, timeout=5)
        if not got:
            continue
        body_bytes, _ = got
        html_txt = body_bytes.decode('utf-8', errors='replace')
        for m in re.finditer(r'(?:property=["\']og:image["\'][^>]+content=|content=["\'])(https://[^"\'>\s]+)', html_txt, re.I):
            cand = m.group(1).strip()
            if cand not in seen and ('photo.2gis' in cand or 'avatars.mds.yandex.net/get-' in cand):
                seen.add(cand)
                found.append(cand)
        for m in re.finditer(r'https://(?:i\d+\.photo\.2gis\.com|avatars\.mds\.yandex\.net/get-(?:altay|sprav|vh))/[^\s"\'<>\\]+', html_txt):
            cand = m.group(0).strip()
            if cand not in seen and not cand.lower().endswith('.svg'):
                seen.add(cand)
                found.append(cand)
                if len(found) >= _MAX_CARD_PHOTOS:
                    return found
    return found[:_MAX_CARD_PHOTOS]


def _fetch_card_photos(photo_urls: list[str], limit: int = 4) -> list[dict]:
    """Скачивает и нормализует до `limit` фотографий карточки в assets/photo-N.<ext>."""
    assets: list[dict] = []
    seen_urls: set[str] = set()
    for raw_url in photo_urls:
        if len(assets) >= limit:
            break
        u = str(raw_url or '').strip()
        if not u or u in seen_urls:
            continue
        seen_urls.add(u)
        got = _safe_http_get(u)
        if not got:
            continue
        norm = _normalize_photo_bytes(*got)
        if not norm:
            continue
        img_bytes, mime, ext = norm
        idx = len(assets) + 1
        fname = f'photo-{idx}.{ext}'
        assets.append({
            'filename': fname,
            'rel_path': f'assets/{fname}',
            'mime': mime,
            'bytes': img_bytes,
            'b64': base64.b64encode(img_bytes).decode('ascii'),
            'source_url': u,
        })
    return assets


def _inline_assets_html(html: str, assets: list[dict], max_total_bytes: int = 750_000) -> str:
    """Заменяет относительные ссылки assets/photo-* на data-URI для автономных review.html и preview."""
    if not html or not assets:
        return html
    out = html
    used_bytes = 0
    for asset in assets:
        rel = asset.get('rel_path') or ''
        b64 = asset.get('b64') or ''
        mime = asset.get('mime') or 'image/jpeg'
        if not rel or not b64:
            continue
        if used_bytes + len(b64) > max_total_bytes:
            break
        pat = re.compile(r'(?:\.?/)' + re.escape(rel) + r'|(?<![A-Za-z0-9_/-])' + re.escape(rel))
        if pat.search(out):
            data_uri = f'data:{mime};base64,{b64}'
            out = pat.sub(lambda _m, uri=data_uri: uri, out)
            used_bytes += len(b64)
    return out


def _normalize_asset_refs(html: str, assets: list[dict]) -> str:
    """Приводит пути ./assets/photo-N.jpg и /assets/photo-N.jpg к единому assets/photo-N.jpg."""
    if not html or not assets:
        return html
    out = html
    for asset in assets:
        rel = asset.get('rel_path') or ''
        if not rel:
            continue
        out = re.sub(r'(["\'\(])\s*(?:\./|/)' + re.escape(rel), r'\1' + rel, out)
    return out


# ── 21st.dev: бесплатный поиск референсов-компонентов (metadata only) ─────────
_21ST_MCP = 'https://21st.dev/api/mcp'
_21ST_KEY_ENV = (os.environ.get('TWENTYFIRST_API_KEY')
                 or os.environ.get('API_KEY_21ST_DEV') or '').strip()


def _21st_query_from_prompt(prompt: str) -> str:
    """Запрос для поиска: рубрика бизнеса + hero landing, иначе общий."""
    m = re.search(r'^Рубрики:\s*(.+)$', prompt or '', re.M)
    if m:
        return (m.group(1)[:60] + ' hero landing page').strip()
    return 'hero section landing page'


def _21st_search(query: str, key: str, limit: int = 3) -> str:
    """MCP-поиск компонентов 21st.dev (режим metadata — бесплатный).
    Возвращает текст со списком найденных компонентов или '' при ошибке."""
    if not key or not query:
        return ''
    try:
        s = requests.Session()
        s.headers.update({'Authorization': 'Bearer ' + key.strip(),
                          'Accept': 'application/json, text/event-stream',
                          'Content-Type': 'application/json'})
        r = s.post(_21ST_MCP, json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                                    'params': {'protocolVersion': '2024-11-05',
                                               'capabilities': {},
                                               'clientInfo': {'name': 'fracs-agent',
                                                              'version': '1.0'}}}, timeout=20)
        sid = r.headers.get('mcp-session-id', '')
        if sid:
            s.headers['mcp-session-id'] = sid
            s.post(_21ST_MCP, json={'jsonrpc': '2.0',
                                    'method': 'notifications/initialized'}, timeout=15)
        r = s.post(_21ST_MCP, json={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                                    'params': {'name': 'search',
                                               'arguments': {'query': query[:120],
                                                             'mode': 'metadata',
                                                             'limit': limit}}}, timeout=30)
        data = r.json()
        text = (data.get('result', {}).get('content') or [{}])[0].get('text', '')
        return text if 'result(s)' in text else ''
    except Exception:
        return ''


# ── LLM ───────────────────────────────────────────────────────────────────────

def _provider_cfg(provider: str) -> dict:
    return _PROVIDERS.get(provider) or _PROVIDERS['Z.ai']


_LIC_MOD = None


def _lic_mod():
    """Ленивый импорт и кэш модуля parser_2gis.license."""
    global _LIC_MOD
    if _LIC_MOD is not None:
        return _LIC_MOD
    try:
        from .. import license as _lic
    except Exception:
        try:
            from parser_2gis import license as _lic
        except Exception:
            return None
    _LIC_MOD = _lic
    return _LIC_MOD


def _fracs_license_key() -> str:
    """Ключ лицензии из локального файла (пусто, если его нет)."""
    try:
        lic = _lic_mod()
        if not lic:
            return ''
        return str((lic._load() or {}).get('key') or '').strip()
    except Exception:
        return ''


def _fracs_proxy() -> tuple[str, str] | None:
    """Прокси Fracs AI через сайт: (site_url, лицензионный ключ) или None.

    None → пользователь без активной лицензии-ключа: Fracs AI пойдёт напрямую
    в OpenRouter на ключе из env (режим владельца / dev-сборка). У обычных
    пользователей OpenRouter-ключа в сборке нет, поэтому запрос уходит на сайт,
    где ключ хранится на сервере: POST /api/app/ai (Authorization: ключ лицензии).
    """
    try:
        lic = _lic_mod()
        if not lic:
            return None
        if lic._owner_mode() and _FRACS_AI_KEY:
            return None
        site = (lic._site() or '').strip()
        key = _fracs_license_key()
        if site and key:
            return site.rstrip('/'), key
    except Exception:
        pass
    return None


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
              temperature: float = 0.7, max_tokens: int = 4096,
              system: str | None = None, style: str = '',
              task: str = '', brief_block: str = '',
              creative_recipe: str = '') -> dict:
    """Вызов LLM. Возвращает {ok, text, error, ms}. system=None → общий промт сборщика сайтов.

    task: 'copy' | 'critique' — задачи Cohere внутри Fracs AI; 'build' — сборка сайта.
    brief_block: арт-дирекшн и тексты от Cohere (добавляется в системный промт сборщика)."""
    started = time.time()
    cfg = _provider_cfg(provider)
    if provider == 'Fracs AI':
        # Fracs AI — встроенная нейронка программы, под капотом OpenRouter / Cohere.
        # Приоритет: прокси сайта Fracs → серверный ключ env (подписка) →
        # локальный ключ OpenRouter (режим владельца / dev).
        proxy = _fracs_proxy()
        if proxy:
            api_key = proxy[1]
        elif task in _COHERE_TASKS and _COHERE_KEY:
            api_key = _COHERE_KEY
        elif _FRACS_AI_KEY:
            api_key = _FRACS_AI_KEY
        else:
            return {'ok': False, 'error': _FRACS_DOWN}
    else:
        api_key = (api_key or '').strip()
        if cfg['needs_key'] and not api_key:
            return {'ok': False, 'error': 'no_api_key'}

    via_proxy = False
    direct_cohere = False
    if provider == 'Fracs AI':
        proxy = _fracs_proxy()
        if proxy:
            url, via_proxy = proxy[0] + '/api/app/ai', True      # сервер сам выбирает провайдера
        elif task in _COHERE_TASKS and _COHERE_KEY:
            url, direct_cohere = _COHERE_URL + '/chat/completions', True
        elif _FRACS_AI_KEY:
            url = _OPENROUTER_URL + '/chat/completions'
        else:
            return {'ok': False, 'error': _FRACS_DOWN}
    else:
        url = _resolve_chat_url(provider, base_url)
    if not url:
        return {'ok': False, 'error': 'no_base_url'}

    uploads = uploads or []
    vision_ok = bool(cfg.get('vision'))
    skipped = [a['name'] for a in uploads if a['kind'] == 'image' and not vision_ok]
    system = _SYSTEM_PROMPT if system is None else system
    if provider == 'Fracs AI':
        # Наружу (через прокси сайта) отправляем непрозрачные алиасы fracs-ai*,
        # чтобы внутренние модели не светились даже в сетевых запросах.
        if via_proxy:
            if task in _COHERE_TASKS:
                model = 'fracs-ai-edit'
                temperature = min(float(temperature), 1.0)
                max_tokens = min(int(max_tokens or 4096), 8000)
            elif system is _SYSTEM_PROMPT or task == 'build':
                model = 'fracs-ai'
            else:
                model = 'fracs-ai-fast'
        else:
            if task in _COHERE_TASKS:
                model = _COHERE_MODEL if direct_cohere else _COHERE_OR_MODEL
                temperature = min(float(temperature), 1.0)
                max_tokens = min(int(max_tokens or 4096), 8000)
            else:
                model = _BEST_CODE_MODEL if system is _SYSTEM_PROMPT else _CHEAP_CHAT_MODEL
    if system is _SYSTEM_PROMPT:
        # типографика + гибкие компоненты + вариативное стилевое направление (разные палитры/шрифты/архетипы)
        if creative_recipe:
            recipe_txt = creative_recipe
        else:
            sk, var, arch = _pick_creative_direction(prompt, style=style)
            recipe_txt = _format_style_recipe(sk, var, arch)
        system += TYPO_RULES + BLOCKS_LIB + '\n\n' + recipe_txt
        if brief_block:
            system += brief_block
    if extra:
        system += _EXTRA_PREFIX + '\n' + extra.strip()
    user_content = _build_user_content(provider, cfg, prompt, uploads, vision_ok)

    def _make_req_body(target_model: str, strip_temp: bool = False) -> dict:
        if cfg['shape'] == 'anthropic':
            return {'model': target_model, 'max_tokens': int(max_tokens or 4096),
                    'system': system, 'messages': [{'role': 'user', 'content': user_content}]}
        b: dict[str, Any] = {
            'model': target_model,
            'max_tokens': int(max_tokens or 4096),
            'messages': [{'role': 'system', 'content': system},
                         {'role': 'user', 'content': user_content}],
        }
        if not strip_temp and target_model not in _NO_TEMP_MODELS:
            b['temperature'] = float(temperature if temperature is not None else 0.7)
        if via_proxy and task:
            b['fracs_task'] = task   # прокси по метке копирайта/вычитки считает их как лёгкие задачи
        return b

    headers = _auth_headers(provider, cfg, api_key)
    direct_candidates = [model]
    if provider == 'Fracs AI' and not via_proxy and not direct_cohere and model == _BEST_CODE_MODEL:
        for fb in _FALLBACK_CODE_MODELS:
            if fb not in direct_candidates:
                direct_candidates.append(fb)

    req_timeout = 240 if via_proxy else 180
    r = None
    last_req_err: Exception | None = None
    for cand_idx, cand_model in enumerate(direct_candidates):
        body = _make_req_body(cand_model)
        try:
            r = requests.post(url, headers=headers, json=body, timeout=req_timeout)
            if r.status_code == 400 and not via_proxy and 'temperature' in body:
                r = requests.post(url, headers=headers, json=_make_req_body(cand_model, strip_temp=True), timeout=req_timeout)
        except requests.RequestException as e:
            last_req_err = e
            r = None
            if cand_idx + 1 < len(direct_candidates):
                continue
            if provider == 'Fracs AI':
                return {'ok': False, 'error': _FRACS_DOWN, 'ms': _ms(started), 'skipped_images': skipped}
            return {'ok': False, 'error': f'network: {e}', 'ms': _ms(started), 'skipped_images': skipped}
        if r.status_code < 400 or via_proxy or cand_idx + 1 >= len(direct_candidates):
            break

    if r is None:
        if provider == 'Fracs AI':
            return {'ok': False, 'error': _FRACS_DOWN, 'ms': _ms(started), 'skipped_images': skipped}
        return {'ok': False, 'error': f'network: {last_req_err}', 'ms': _ms(started), 'skipped_images': skipped}

    if r.status_code >= 400 and provider == 'Fracs AI':
        # наружу — только «свои» сообщения Fracs (лимиты прокси), без деталей движка
        msg = _FRACS_DOWN
        err_code = ''
        buy_url = ''
        reset_at = 0
        try:
            err = r.json()
            if isinstance(err, dict) and err.get('ok') is False and isinstance(err.get('message'), str):
                msg = err['message']
                err_code = str(err.get('error') or '')
                buy_url = str(err.get('buyUrl') or '')
                reset_at = int(err.get('resetAt') or 0)
        except Exception:
            pass
        if not reset_at:
            try:
                reset_at = int(r.headers.get('X-Fracs-Reset-At') or 0)
            except Exception:
                reset_at = 0
        return {'ok': False, 'error': msg, 'error_code': err_code, 'buy_url': buy_url,
                'reset_at': reset_at, 'ms': _ms(started), 'skipped_images': skipped}
    if r.status_code >= 400:
        try:
            err = r.json()
            if isinstance(err.get('error'), dict):
                msg = err['error'].get('message')
            else:   # прокси Fracs: {ok:false, error:'quota_day', message:'…по-русски…'}
                msg = err.get('message') or str(err)
        except Exception:
            msg = r.text[:200]
        return {'ok': False, 'error': f'http {r.status_code}: {msg}', 'ms': _ms(started),
                'skipped_images': skipped}
    try:
        data = r.json()
    except ValueError:
        return {'ok': False, 'error': 'bad_response', 'ms': _ms(started), 'skipped_images': skipped}

    text = ''
    truncated = False
    if cfg['shape'] == 'anthropic':
        truncated = data.get('stop_reason') == 'max_tokens'
        for block in data.get('content', []):
            if isinstance(block, dict) and block.get('type') == 'text':
                text += block.get('text', '')
    else:
        choices = data.get('choices') or []
        if choices:
            truncated = choices[0].get('finish_reason') == 'length'
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
    cx_tier = r.headers.get('X-Fracs-Complexity-Tier', '')
    cx_cost = r.headers.get('X-Fracs-Complexity-Cost', '')
    cx_left = r.headers.get('X-Fracs-Complexity-Left', '')
    try:
        cx_reset = int(r.headers.get('X-Fracs-Reset-At') or 0)
    except Exception:
        cx_reset = 0
    return {'ok': True, 'text': text, 'ms': _ms(started), 'skipped_images': skipped,
            'truncated': truncated, 'reset_at': cx_reset,
            'complexity': {'tier': cx_tier, 'cost': cx_cost, 'left': cx_left} if cx_tier else None}


def _ms(started: float) -> int:
    return int((time.time() - started) * 1000)


def _extract_html(raw: str) -> str:
    """Достаёт HTML-документ из ответа LLM (снимает markdown-ограждения и лишний текст)."""
    s = (raw or '').strip()
    fence = re.search(r'```(?:html|htm)?\s*([\s\S]*?)```', s, re.I)
    if fence and ('<' in fence.group(1)):
        s = fence.group(1).strip()
    elif s.startswith('```'):
        s = re.sub(r'^```(?:html|htm)?\s*', '', s, flags=re.I)
        s = re.sub(r'\s*```$', '', s).strip()
    if '<html' not in s.lower() and '<!doctype' not in s.lower():
        s = ('<!DOCTYPE html>\n<html lang="ru"><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width, initial-scale=1">'
             '<title>Сайт</title></head><body>' + s + '</body></html>')
    return s


_SAFE_BASE_STYLE = (
    '<style data-fracs-base="1">'
    ':where(*,*::before,*::after){box-sizing:border-box}'
    ':where(html,body){margin:0;overflow-x:hidden}'
    ':where(img,svg){max-width:100%;height:auto}'
    ':where(.hero-media,.photo-frame,.media-box){overflow:hidden;margin:0}'
    ':where(.hero-media img,.photo-frame img,.media-box img){width:100%;height:100%;object-fit:cover;display:block}'
    ':where(.btn.ghost,.btn-ghost,.btn-outline,.btn-secondary){background:transparent;color:var(--text,currentColor);border:1px solid var(--line,rgba(128,128,128,.35))}'
    ':where(section){padding:clamp(56px,7vw,96px) clamp(18px,4vw,32px)}'
    ':where(section) > :where(h1,h2,h3,p,ul,ol,dl,div,details){max-width:1180px;margin-inline:auto}'
    ':where(.container,.wrap,.inner){width:100%;max-width:1180px;margin-inline:auto;padding-inline:clamp(18px,4vw,32px)}'
    ':where(details){border-bottom:1px solid var(--line,rgba(128,128,128,.25))}'
    ':where(details summary){list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;cursor:pointer;font-weight:500}'
    ':where(details summary)::-webkit-details-marker{display:none}'
    ':where(details p){margin:0;padding:0 0 18px;color:var(--muted,inherit)}'
    ':where(a,button):focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:3px}'
    '</style>'
)

_SAFE_REVEAL_SCRIPT = (
    '<script data-fracs-reveal="1">(function(){'
    'function show(){document.querySelectorAll(".r,.reveal,[data-reveal],section").forEach(function(el){'
    'if(getComputedStyle(el).opacity==="0"){el.classList.add("in","visible","is-visible");'
    'el.style.opacity="1";el.style.transform="none";}});}'
    'setTimeout(show,850);addEventListener("load",function(){setTimeout(show,250);});'
    '})();</script>'
)


def _heal_generated_html(html: str) -> tuple[str, list[str]]:
    """Детерминированная страховка: чинит незакрытые теги и добавляет 0-specificity базовые стили
    (:where), чтобы секции и <details> никогда не падали в нестилизованный HTML."""
    fixes: list[str] = []
    out = html or ''
    # Если модель оборвала <style> до </style>
    open_styles = len(re.findall(r'<style\b', out, re.I))
    close_styles = len(re.findall(r'</style>', out, re.I))
    if open_styles > close_styles:
        out += '\n</style>'
        fixes.append('закрыт оборванный <style>')
    if '</head>' not in out.lower() and '<body' in out.lower():
        out = re.sub(r'(<body\b)', '</head>\n\\1', out, count=1, flags=re.I)
    if '</body>' not in out.lower():
        out += '\n</body>'
        fixes.append('добавлен </body>')
    if '</html>' not in out.lower():
        out += '\n</html>'
        fixes.append('добавлен </html>')

    if 'data-fracs-base' not in out:
        if re.search(r'</head>', out, re.I):
            out = re.sub(r'</head>', _SAFE_BASE_STYLE + '\n</head>', out, count=1, flags=re.I)
        elif re.search(r'<head[^>]*>', out, re.I):
            out = re.sub(r'(<head[^>]*>)', r'\1\n' + _SAFE_BASE_STYLE, out, count=1, flags=re.I)

    if 'data-fracs-reveal' not in out and re.search(r'\bclass=["\'][^"\']*\br\b', out):
        if re.search(r'</body>', out, re.I):
            out = re.sub(r'</body>', _SAFE_REVEAL_SCRIPT + '\n</body>', out, count=1, flags=re.I)
    return out, fixes


_SLOP_PHRASES = (
    'инновационн',
    'динамично развивающ',
    'мы рады представить',
    'индивидуальный подход',
    'высокое качество по доступным ценам',
    'ваш надёжный партнёр',
    'ваш надежный партнер',
    'как у бабушки',
    'на любой вкус',
    'доставим с улыбкой',
    'с любовью к',
    'для всей семьи',
    'приятные цены',
    'широкий выбор',
    'широкий ассортимент',
    'команда профессионалов',
    'лучшие в городе',
    'lorem ipsum',
)


def _audit_generated_html(html: str) -> tuple[str, list[str]]:
    """Быстрая проверка сгенерированного HTML перед показом превью."""
    low = (html or '').lower()
    checks = []
    if 'name="viewport"' in low or "name='viewport'" in low:
        checks.append('адаптив')
    if '<style' in low:
        checks.append('стили')
    if '.container' in low or '.wrap' in low or 'max-width' in low:
        checks.append('сетка')
    sections = len(re.findall(r'<section\b', low))
    if sections:
        checks.append(f'{sections} секц.')
    if 'href="tel:' in low or 't.me/' in low or 'mailto:' in low:
        checks.append('клик-контакты')
    slop = [p for p in _SLOP_PHRASES if p in low]
    notes = []
    if slop:
        notes.append(f'Замечены клише ({len(slop)}): при желании скорректируйте через «Изменить макет».')
    summary = 'Проверка шедевра: ' + (', '.join(checks) if checks else 'HTML собран') + (
        '' if slop else ' · анти-слоп пройден'
    )
    return summary, notes


# ── Конвейер Fracs AI: Cohere + OpenRouter работают вместе ─────────────────────
# 1) Cohere Command A (copy)  — арт-дирекшн + готовые русские тексты (JSON). У модели потолок
#    ответа 8000 токенов, целую страницу она не соберёт, зато сильна в русском и структурном выводе.
# 2) OpenRouter (премиум-кодинг) — собирает вёрстку по этому брифу.
# 3) Cohere Command A (critique) — вычитывает видимые тексты готового сайта и точечно правит
#    клише/выдумки. Правки применяются подстановкой строк, без повторной генерации страницы.
# Любой шаг конвейера необязателен: упал Cohere — сайт собирается как раньше, без брифа.

_COPY_SYSTEM = (
    'Ты — арт-директор и редактор русскоязычных текстов в веб-студии. Тебе дают данные карточки '
    'местного бизнеса. Ты НЕ пишешь код: ты готовишь ТЗ для верстальщика — концепцию, палитру, '
    'шрифты, архетип композиции и готовые тексты. Верстальщик вставит твои тексты дословно.\n\n'
    'ТЕКСТЫ:\n'
    '— Пиши как живой человек из этой отрасли: конкретно, свежо, без канцелярита и пошлых рекламных штампов. '
    'СТРОГО ЗАПРЕЩЕНЫ: «инновационный», «динамично развивающийся», «индивидуальный подход», «высокое качество», '
    '«ваш надёжный партнёр», «мы рады представить», «команда профессионалов», «широкий спектр/выбор/ассортимент», '
    '«комплексные решения», «как у бабушки», «на любой вкус», «доставим с улыбкой», «с любовью», '
    '«для всей семьи», «приятные цены», «лучшие в городе».\n'
    '— Факты — только из карточки. НЕ выдумывай цены, сроки, годы, число клиентов, сертификаты, '
    'гарантии, часы работы, имена, отзывы. Нет конкретики — пиши о ремесле/процессе и как обратиться. '
    'Никаких скобок-заглушек вроде [УТОЧНИТЬ].\n'
    '— H1: до 7 слов, точный и характерный («Хлеб на закваске с 7 утра» или «Тормоза за один визит», а не штампы).\n'
    '— Услуги — только то, что логично следует из рубрик бизнеса; в названии 2–5 слов, в описании '
    'одно конкретное предложение до 110 знаков.\n\n'
    'ДИЗАЙН (ОБЯЗАТЕЛЬНОЕ РАЗНООБРАЗИЕ — НЕ КЛОНИРУЙ ОДИН ШАБЛОН):\n'
    '— Учитывай ориентир темы/направления из запроса, но адаптируй под характер бизнеса. Не делай всё тёмным '
    'и однотипным! Чередуй светлые редакционные и глубокие цветовые темы; запрещены фиолетовые/индиго акценты. '
    'Контраст: text на bg ≥ 7:1, muted на bg ≥ 4.5:1, accent_contrast на accent ≥ 4.5:1. Цвета — hex #RRGGBB.\n'
    f'— Шрифты ТОЛЬКО из списка (в них есть кириллица): {_FONT_LIST_TXT}. Display — для H1 и цифр, '
    'text — для остального; меняй пары шрифтов от проекта к проекту.\n'
    '— archetype — структура страницы: editorial (журнальный разворот без тяжёлых карточек), '
    'architectural_split (модульные тонкие линии 1px), swiss_catalog (светлый каталог + фото), '
    'atelier_sticky (закреплённый левый заголовок + лента направлений), clean_trust (спокойный светлый сервис), '
    'warm_craft (тёплое ремесло и меню в 2 колонки).\n'
    '— Не включай why и faq автоматически в каждый сайт: включай why и faq ТОЛЬКО там, где они реально нужны '
    'клиенту (для пекарни/кафе faq не нужен — оставь []; для клиники/авто/стройки 3 конкретных вопроса уместны).\n'
    '— signature — ОДИН запоминающийся приём чистым CSS (например: нумерация строк 01–05 крупной антиквой, '
    'закреплённый заголовок слева, открытая таблица-меню с тонкими 1px линиями).\n\n'
    'Верни ТОЛЬКО JSON-объект, без markdown и пояснений:\n'
    '{"positioning":"1 предложение: кому и чем полезен бизнес","tone":"3-5 слов",'
    '"style_key":"auto|coffee|medical|beauty|build|neutral",'
    '"archetype":"editorial|architectural_split|swiss_catalog|atelier_sticky|clean_trust|warm_craft",'
    '"palette":{"bg":"#","surface":"#","line":"#","text":"#","muted":"#","accent":"#","accent_contrast":"#"},'
    '"fonts":{"display":"","text":""},"signature":"",'
    '"hero":{"eyebrow":"до 28 знаков","h1":"","h1_accent":"2-4 слова или пусто","sub":"до 120 знаков",'
    '"cta_primary":"","cta_secondary":""},'
    '"services":[{"title":"","text":""}],'
    '"why":[{"title":"","text":""}],'
    '"about":"2-3 предложения без выдуманных фактов",'
    '"faq":[{"q":"","a":""}],'
    '"cta":{"title":"","text":""},'
    '"avoid":["что НЕ писать именно для этого бизнеса"]}\n'
    'Количество: services 3-5, why 0 или 3, faq 0 или 3.'
)

_CRITIC_SYSTEM = (
    'Ты — строгий редактор русскоязычных текстов сайта. Тебе дают данные бизнеса и пронумерованные '
    'тексты со страницы. Найди проблемные и дай замену.\n'
    'Проблемы: (1) канцелярит и пошлые клише («индивидуальный подход», «высокое качество», '
    '«надёжный партнёр», «инновационный», «как у бабушки», «на любой вкус», «доставим с улыбкой», '
    '«для всей семьи», «приятные цены», «с любовью»); (2) ВЫДУМАННЫЕ факты — цены, сроки, годы, число клиентов, '
    'сертификаты, часы работы, которых нет в данных бизнеса; (3) скобочные заглушки [..]; '
    '(4) упоминания нейросетей, моделей, библиотек; (5) заголовок длиннее 10 слов.\n'
    'Замена — полный новый текст сегмента, тот же смысл и примерно та же длина, живой конкретный язык, без '
    'выдумок и без HTML. Не трогай нормальные тексты, телефоны, адреса, названия. Если проблем нет — '
    'верни пустой список.\n'
    'Верни ТОЛЬКО JSON: {"patches":[{"id":3,"new":"..."}]}. Максимум 12 патчей.'
)

_COPY_LIMITS = {'h1': 90, 'h1_accent': 40, 'sub': 160, 'eyebrow': 40, 'cta_primary': 40,
                'cta_secondary': 40}


def _parse_json_obj(raw: str) -> dict | None:
    """Достаёт JSON-объект из ответа модели (снимает ```json, ищет первую { и последнюю })."""
    s = (raw or '').strip()
    s = re.sub(r'^```(?:json)?\s*|\s*```$', '', s)
    i, j = s.find('{'), s.rfind('}')
    if i < 0 or j <= i:
        return None
    try:
        data = json.loads(s[i:j + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


_HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


def _hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _luminance(h: str) -> float:
    r, g, b = [(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4) for c in _hex_rgb(h)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _is_purplish(h: str) -> bool:
    """Индиго/фиолетовый акцент (оттенок 245-300°, заметная насыщенность) — главный маркер «нейрослопа»."""
    r, g, b = _hex_rgb(h)
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    return sat > 0.3 and 0.12 < light < 0.9 and 245 <= hue * 360 <= 300


def _check_palette(p: Any) -> tuple[dict | None, str]:
    """(палитра | None, причина отказа). Палитра принимается только целиком и с нормальным контрастом."""
    keys = ('bg', 'surface', 'line', 'text', 'muted', 'accent', 'accent_contrast')
    if not isinstance(p, dict):
        return None, 'нет палитры'
    out = {}
    for k in keys:
        v = str(p.get(k) or '').strip()
        if not _HEX_RE.match(v):
            return None, f'цвет «{k}» не в формате #RRGGBB'
        out[k] = v.lower()
    if _contrast(out['text'], out['bg']) < 4.5:
        return None, 'низкий контраст текста'
    if _contrast(out['muted'], out['bg']) < 3.5:
        return None, 'низкий контраст вторичного текста'
    if _contrast(out['accent_contrast'], out['accent']) < 4.0:   # в промте просим 4.5, допуск — как у штатных рецептов (4.2-4.4)
        return None, 'низкий контраст текста на акценте'
    if _contrast(out['accent'], out['bg']) < 2.5:
        return None, 'акцент сливается с фоном'
    if _is_purplish(out['accent']):
        return None, 'сине-фиолетовый акцент'
    return out, ''


def _clean_brief(raw: dict, prompt: str) -> tuple[dict, list[str]]:
    """Чистит бриф Cohere: невалидные части отбрасываются, сайт соберётся по рецепту."""
    notes: list[str] = []

    def txt(v: Any, n: int) -> str:
        return re.sub(r'\s+', ' ', str(v or '')).strip()[:n]

    def items(v: Any, keys: tuple[str, ...], lim: int, n: int = 160) -> list[dict]:
        out = []
        for it in (v if isinstance(v, list) else [])[:lim]:
            if isinstance(it, dict):
                d = {k: txt(it.get(k), n) for k in keys}
                if all(d.values()):
                    out.append(d)
        return out

    b: dict = {}
    b['positioning'] = txt(raw.get('positioning'), 220)
    b['tone'] = txt(raw.get('tone'), 60)
    sk = txt(raw.get('style_key'), 12).lower()
    b['style_key'] = sk if sk in STYLE_PROMPTS else _pick_style(prompt)
    ak = txt(raw.get('archetype'), 24).lower()
    if ak in _LAYOUT_ARCHETYPES:
        b['archetype'] = ak
    pal, why = _check_palette(raw.get('palette'))
    if pal:
        b['palette'] = pal
    else:
        notes.append(f'палитра арт-директора отклонена ({why}) — беру палитру рецепта')
    fonts = raw.get('fonts') if isinstance(raw.get('fonts'), dict) else {}
    canon = {k.lower(): k for k in _CYR_FONTS}
    fd = canon.get(str(fonts.get('display') or '').strip().lower())
    ft = canon.get(str(fonts.get('text') or '').strip().lower())
    if fd and ft:
        b['fonts'] = {'display': fd, 'text': ft}
    else:
        notes.append('шрифты арт-директора не из списка с кириллицей — беру шрифты рецепта')
    b['signature'] = txt(raw.get('signature'), 200)
    hero = raw.get('hero') if isinstance(raw.get('hero'), dict) else {}
    b['hero'] = {k: txt(hero.get(k), n) for k, n in _COPY_LIMITS.items()}
    b['services'] = items(raw.get('services'), ('title', 'text'), 5)
    b['why'] = items(raw.get('why'), ('title', 'text'), 3)
    b['about'] = txt(raw.get('about'), 480)
    b['faq'] = items(raw.get('faq'), ('q', 'a'), 4, 220)
    cta = raw.get('cta') if isinstance(raw.get('cta'), dict) else {}
    b['cta'] = {'title': txt(cta.get('title'), 90), 'text': txt(cta.get('text'), 160)}
    b['avoid'] = [txt(x, 80) for x in (raw.get('avoid') if isinstance(raw.get('avoid'), list) else [])[:6]
                  if txt(x, 80)]
    if not b['hero'].get('h1') or not b['services']:
        raise ValueError('в брифе нет H1 или услуг')
    return b, notes


def _brief_block(b: dict) -> str:
    """Бриф → блок системного промта «АРТ-ДИРЕКШН И ТЕКСТЫ»."""
    L = ['\n\nАРТ-ДИРЕКШН И ТЕКСТЫ (готовит редактор; тексты вставляй ДОСЛОВНО, факты не добавляй):']
    if b.get('positioning'):
        L.append('Позиционирование: ' + b['positioning'])
    if b.get('tone'):
        L.append('Тон: ' + b['tone'])
    pal = b.get('palette')
    if pal:
        L.append('Палитра (ЗАМЕЩАЕТ цвета рецепта): ' + '; '.join(
            f'--{k.replace("_", "-")}:{v}' for k, v in pal.items()))
    fonts = b.get('fonts')
    if fonts:
        fams = [fonts['display']] + ([fonts['text']] if fonts['text'] != fonts['display'] else [])
        gen = {f: _CYR_FONTS[f][2] for f in fams}
        L.append(f'Шрифты (ЗАМЕЩАЮТ шрифты рецепта): заголовки и цифры — «{fonts["display"]}», '
                 f'текст — «{fonts["text"]}». Подключи ровно этой ссылкой: '
                 f'<link rel="stylesheet" href="{_fonts_link(fams)}">; '
                 'в CSS добавь запасной generic: ' + ', '.join(f'{f} → {g}' for f, g in gen.items()) + '.')
    ak = b.get('archetype')
    if ak and ak in _LAYOUT_ARCHETYPES:
        arch = _LAYOUT_ARCHETYPES[ak]
        L.append(f'Архетип композиции: {arch["title"]} — {arch["sections"]}')
    if b.get('signature'):
        L.append('Signature-приём страницы: ' + b['signature'])
    h = b.get('hero') or {}
    L.append('ГЕРОЙ: надзаголовок «{eyebrow}» · H1 «{h1}»{acc} · подпись «{sub}» · кнопки: «{cta_primary}»'
             '{sec}'.format(
                 eyebrow=h.get('eyebrow', ''), h1=h.get('h1', ''),
                 acc=(' + вторая строка/акцент курсивом «%s»' % h['h1_accent']) if h.get('h1_accent') else '',
                 sub=h.get('sub', ''), cta_primary=h.get('cta_primary', ''),
                 sec=(' и контурная .btn.ghost «%s»' % h['cta_secondary']) if h.get('cta_secondary') else ''))
    if b.get('services'):
        L.append('УСЛУГИ: ' + ' | '.join(f'{i}) {s["title"]} — {s["text"]}' for i, s in enumerate(b['services'], 1)))
    if b.get('why'):
        L.append('ПОЧЕМУ МЫ / КАК РАБОТАЕМ: ' + ' | '.join(f'{w["title"]} — {w["text"]}' for w in b['why']))
    if b.get('about'):
        L.append('О КОМПАНИИ: ' + b['about'])
    if b.get('faq'):
        L.append('FAQ: ' + ' | '.join(f'В: {f["q"]} О: {f["a"]}' for f in b['faq']))
    c = b.get('cta') or {}
    if c.get('title'):
        L.append(f'ФИНАЛЬНЫЙ БЛОК / CTA: «{c["title"]}» — {c.get("text", "")}')
    if b.get('avoid'):
        L.append('НЕ писать: ' + '; '.join(b['avoid']))
    L.append('Контакты, адрес, рейтинг — строго из карточки. Используй только те секции, что есть выше (пустые не придумывай).')
    return '\n'.join(L)


def _make_brief(job_prompt: str, extra: str, uploads: list[dict],
                direction_hint: str = '') -> dict:
    """Шаг 1 конвейера (Cohere). Возвращает {ok, brief, notes, ms} или {ok: False, error}."""
    user = job_prompt[:6000]
    if direction_hint:
        user += '\n\nОриентир по визуальному направлению (чтобы не повторяться с прошлыми сайтами):\n' + direction_hint
    if extra:
        user += '\n\nПожелания пользователя (учти в тоне, теме и палитре):\n' + extra.strip()[:1500]
    text_uploads = [a for a in uploads if a.get('kind') == 'text']
    res = _call_llm('Fracs AI', '', '', user, uploads=text_uploads, temperature=0.8,
                    max_tokens=3800, system=_COPY_SYSTEM, task='copy')
    if not res.get('ok'):
        return res
    raw = _parse_json_obj(res['text'])
    if not raw:
        return {'ok': False, 'error': 'бриф пришёл не в формате JSON', 'ms': res.get('ms', 0)}
    try:
        brief, notes = _clean_brief(raw, job_prompt)
    except ValueError as e:
        return {'ok': False, 'error': str(e), 'ms': res.get('ms', 0)}
    return {'ok': True, 'brief': brief, 'notes': notes, 'ms': res.get('ms', 0)}


_TEXT_NODE_RE = re.compile(r'>([^<>]{14,400})<')


def _text_segments(html: str) -> list[tuple[int, int, str]]:
    """Видимые текстовые узлы страницы: (начало, конец, сырой текст). script/style пропускаем."""
    masked = re.sub(r'(?is)<(script|style)\b.*?</\1>', lambda m: ' ' * len(m.group(0)), html)
    segs = []
    for m in _TEXT_NODE_RE.finditer(masked):
        raw = m.group(1)
        if re.search(r'[A-Za-zА-Яа-яЁё]{3}', raw) and len(raw.strip()) >= 14:
            segs.append((m.start(1), m.end(1), raw))
    return segs


def _polish_html(html: str, job_prompt: str) -> tuple[str, int, str]:
    """Шаг 3 конвейера (Cohere): вычитка видимых текстов. Возвращает (html, число правок, заметка)."""
    segs = _text_segments(html)[:80]
    if not segs:
        return html, 0, ''
    listing = '\n'.join(f'{i}. {_html.unescape(raw.strip())[:300]}' for i, (_, _, raw) in enumerate(segs))
    user = f'ДАННЫЕ БИЗНЕСА:\n{job_prompt[:2500]}\n\nТЕКСТЫ СТРАНИЦЫ:\n{listing}'
    res = _call_llm('Fracs AI', '', '', user, temperature=0.2, max_tokens=2500,
                    system=_CRITIC_SYSTEM, task='critique')
    if not res.get('ok'):
        return html, 0, str(res.get('error') or 'вычитка недоступна')
    data = _parse_json_obj(res['text']) or {}
    applied = 0
    patches = data.get('patches') if isinstance(data.get('patches'), list) else []
    todo = []
    for p in patches[:12]:
        try:
            idx = int(p.get('id'))
        except (TypeError, ValueError, AttributeError):
            continue
        new = re.sub(r'\s+', ' ', str(p.get('new') or '')).strip()
        if not (0 <= idx < len(segs)) or not new:
            continue
        old = _html.unescape(segs[idx][2].strip())
        low = new.lower()
        if ('<' in new or '>' in new or '[' in new or len(new) > len(old) * 1.6 + 40
                or any(sp in low for sp in _SLOP_PHRASES) or new == old):
            continue
        todo.append((segs[idx][0], segs[idx][1], segs[idx][2], new))
    for start, end, raw, new in sorted(todo, key=lambda t: t[0], reverse=True):
        lead = raw[:len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        html = html[:start] + lead + _html.escape(new, quote=False) + trail + html[end:]
        applied += 1
    return html, applied, ''


def _fix_fonts(html: str) -> tuple[str, list[str]]:
    """Страховка: если модель всё же подключила шрифт без кириллицы — меняем на безопасный
    и пересобираем ссылку Google Fonts (валидные начертания), чтобы русский не падал в системный."""
    changed = []
    for bad, good in _NO_CYR_FONTS.items():
        pat = re.compile(r'(?<![\w-])' + re.escape(bad).replace(r'\ ', r'[ +]') + r'(?![\w-])', re.I)
        if pat.search(html):
            html = pat.sub(good, html)
            changed.append(f'{bad}→{good}')
    if not changed:
        return html, changed
    links = list(re.finditer(
        r'<link[^>]+href=["\']https://fonts\.googleapis\.com/css2\?[^"\']+["\'][^>]*>', html, re.I))
    if links:
        fams: list[str] = []
        for m in links:
            fams += [urllib.parse.unquote_plus(x) for x in re.findall(r'family=([^:&"\']+)', m.group(0))]
        tag = f'<link rel="stylesheet" href="{_fonts_link(list(dict.fromkeys(fams)))}">'
        first = links[0]
        for m in reversed(links[1:]):
            html = html[:m.start()] + html[m.end():]
        html = html[:first.start()] + tag + html[first.end():]
    return html, changed


_EMOJI_RE = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF]')


def _design_flags(html: str) -> list[str]:
    """Детерминированные проверки «нейрослопа» и поломок — без обращения к модели."""
    flags = []
    low = html.lower()
    if '</html>' not in low:
        flags.append('документ не закрыт — ответ мог оборваться')
    body_text = ' '.join(raw for _, _, raw in _text_segments(html))
    n_ph = len(re.findall(r'\[[^\]]{2,40}\]', body_text))
    if n_ph:
        flags.append(f'скобочные заглушки в тексте: {n_ph}')
    if _EMOJI_RE.search(body_text):
        flags.append('emoji в тексте страницы')
    for grad in re.findall(r'gradient\([^;{}]*\)', html, re.I):
        if any(_is_purplish(h if len(h) == 7 else '#' + ''.join(c * 2 for c in h[1:]))
               for h in re.findall(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', grad)):
            flags.append('сине-фиолетовый градиент')
            break
    return flags



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
        # Модели Fracs AI скрыты — маршрутизацией управляет сервер Fracs.
        return {'ok': True, 'models': ['fracs-ai'], 'auto': True}
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
    stage: str = 'queued'   # queued|thinking|building|checking|preview|packaging|done|failed|cancelled
    stage_label: str = 'В очереди'
    logs: list[str] = field(default_factory=list)
    html: str = ''
    files: list[dict] = field(default_factory=list)
    uploads: list[dict] = field(default_factory=list)
    error: str = ''
    error_code: str = ''
    buy_url: str = ''
    reset_at: int = 0
    created_at: float = field(default_factory=time.time)
    approved: threading.Event = field(default_factory=threading.Event)
    zip_path: str = ''
    png_path: str = ''
    video_path: str = ''
    demo_url: str = ''      # публичная ссылка на видеообзор (из QR), если опубликован
    review_path: str = ''   # review.html — анимированный видеообзор (на него ведёт QR)
    preview_url: str = ''
    site_slug: str = ''   # папка в <проект>/sites/<slug>/
    site_url: str = ''    # локальный URL для ручной проверки, /sites/<slug>/
    version: int = 0      # номер версии (1, 2, … — растёт при «Изменить макет»)
    is_edit: bool = False  # правка поверх предыдущего макета (бриф Cohere не пересобираем)
    brief: dict = field(default_factory=dict)   # арт-дирекшн и тексты от Cohere (конвейер Fracs AI)
    photo_urls: list[str] = field(default_factory=list)
    card_url: str = ''
    ymaps_url: str = ''
    assets: list[dict] = field(default_factory=list)

    def to_dict(self, base_url: str = '') -> dict:
        files = []
        if self.zip_path and os.path.exists(self.zip_path):
            files.append({'name': 'site.zip', 'type': 'zip',
                          'url': f'/api/ai/download/{self.job_id}?type=zip'})
        if self.png_path and os.path.exists(self.png_path):
            files.append({'name': 'postcard.png', 'type': 'png',
                          'url': f'/api/ai/download/{self.job_id}?type=png'})
        if self.review_path and os.path.exists(self.review_path) and self.site_url:
            files.append({'name': 'review.html', 'type': 'html',
                          'url': f'{self.site_url}review.html'})
        if self.video_path and os.path.exists(self.video_path):
            files.append({'name': 'site-review.mp4', 'type': 'video',
                          'url': f'/api/ai/download/{self.job_id}?type=video'})
        local_url = self.site_url or ''
        return {
            'ok': True,
            'status': self.status,
            'stage': self.stage,
            'stage_label': self.stage_label,
            'logs': self.logs[-30:],
            'preview_url': self.preview_url if self.status in ('preview', 'building', 'done') else '',
            'local_url': local_url,
            'site_dir': (os.path.join(_SITES_DIR, self.site_slug)
                         if self.site_slug else ''),
            'version': self.version,
            'files': files,
            'uploads': [{'name': a['name'], 'kind': a['kind'], 'size': a['size']}
                        for a in self.uploads],
            'model': 'fracs-ai' if self.provider == 'Fracs AI' else self.model, 'provider': self.provider,
            'error': self.error,
            'error_code': self.error_code,
            'buy_url': self.buy_url,
            'reset_at': self.reset_at,
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


def _extract_biz_name(prompt: str) -> str:
    """Нормализованное имя бизнеса из строки «Название: ...» (если запуск с карточки)."""
    m = re.search(r'^Название:\s*(.+)$', prompt or '', re.M | re.I)
    if not m:
        return ''
    name = re.sub(r'[«»"\']+', '', m.group(1)).strip().lower()
    return '' if name in ('', '—', '-') else re.sub(r'\s+', ' ', name)


_EDIT_INTENT_RE = re.compile(
    r'\b(?:измен|поправ|передел|замен|обнов|добав|убер|удал|смен|подправ|доработ|текущ|макет|выше|правее|левее|крупнее|мельче|светлее|темнее)',
    re.I,
)


def _looks_like_edit_request(prompt: str) -> bool:
    return bool(_EDIT_INTENT_RE.search(prompt or ''))


def _should_apply_edit(prev: AiJob | None, prompt: str, is_edit: bool | None,
                       photo_urls: list[str], card_url: str, ymaps_url: str) -> bool:
    """Решает, является ли задача правкой поверх `prev`, или это новый бизнес-сайт с нуля."""
    if prev is None:
        return False
    if is_edit is False:
        return False
    cu = (card_url or '').strip()
    yu = (ymaps_url or '').strip()
    if (cu and cu != (prev.card_url or '')) or (yu and yu != (prev.ymaps_url or '')):
        return False
    if photo_urls and prev.photo_urls and photo_urls != prev.photo_urls:
        return False
    if photo_urls and not prev.photo_urls:
        return False
    prev_name = _extract_biz_name(prev.prompt)
    new_name = _extract_biz_name(prompt)
    if new_name and (not prev_name or new_name != prev_name):
        return False
    prev_style = _pick_style(prev.prompt)
    new_style = _pick_style(prompt)
    if new_style != 'neutral' and prev_style != new_style and not _looks_like_edit_request(prompt):
        return False
    if is_edit is None and not _looks_like_edit_request(prompt):
        return False
    return True


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
    _JOB_TTL_S = 4 * 3600   # задачи старше 4 часов вычищаются из памяти

    def _sweep_jobs(self) -> None:
        """Удаляет завершённые задачи старше TTL (память не растёт бесконечно)."""
        cutoff = time.time() - self._JOB_TTL_S
        with self._lock:
            for jid in [j for j, job in self._jobs.items()
                        if job.created_at < cutoff
                        and job.status in ('done', 'failed', 'cancelled')]:
                self._jobs.pop(jid, None)
            for sid in [s for s, b in self._sessions.items() if not b]:
                self._sessions.pop(sid, None)

    def start(self, prompt: str, api_key: str, model: str, provider: str, extra: str = '',
              session_id: str = '', prev_job: str = '', base_url: str = '',
              temperature: float = 0.7, max_tokens: int = 4096,
              style: str = '', key21st: str = '',
              photos: list[str] | None = None,
              card_url: str = '', ymaps_url: str = '',
              is_edit: bool | None = None) -> dict:
        self._sweep_jobs()
        # не больше 2 одновременных задач на программу (защита от «залпа» запросов)
        with self._lock:
            active = sum(1 for j in self._jobs.values()
                         if j.status in ('queued', 'running', 'building'))
        if active >= 2:
            return {'ok': False, 'error': 'Уже идут две генерации — дождитесь окончания '
                                          'одной из них и повторите.'}
        if (provider or '') == 'Fracs AI':
            # встроенный ИИ идёт на ваш ключ: ограничиваем и на стороне программы
            # (главные лимиты — на сервере, см. server/appRoutes.ts).
            # Бюджет ответа фиксируем: UI по умолчанию слал 4096 токенов, а целая страница с CSS и
            # JS — это 8-12К; на 4096 ответ обрывался на полуслове (и «дозакрывался» тегами).
            max_tokens = 12000
            prompt = (prompt or '')[:12000]
            extra = (extra or '')[:4000]
        else:
            # то же для своих провайдеров: дефолт UI (4096) режет страницу — поднимаем до 8192
            try:
                mt = int(max_tokens or 0)
            except (TypeError, ValueError):
                mt = 0
            max_tokens = 8192 if mt <= 4096 else mt
        need = _provider_feature(provider)
        if not _has_feature(need):
            if need == 'fracs_ai':
                gate = fracs_ai_allowed()
                return {'ok': False, 'error': gate.get('reason', 'pro_required'),
                        'pro_required': True}
            return {'ok': False, 'error': 'AI-агент со своим провайдером доступен '
                    'на тарифах PRO и Ultra.', 'pro_required': True}
        job_id = secrets.token_urlsafe(12)
        job_model = 'fracs-ai' if (provider or '') == 'Fracs AI' else (model or '')
        clean_photo_urls = [str(u).strip() for u in (photos or [])
                            if isinstance(u, str) and str(u).strip().startswith(('http://', 'https://'))][:_MAX_CARD_PHOTOS]
        clean_card_url = (card_url or '').strip()
        clean_ymaps_url = (ymaps_url or '').strip()
        job = AiJob(job_id=job_id, prompt=prompt or '', model=job_model,
                    provider=provider or 'Z.ai', photo_urls=clean_photo_urls,
                    card_url=clean_card_url, ymaps_url=clean_ymaps_url)
        uploads = self.pop_uploads(session_id)
        if prev_job:
            prev = self.get(prev_job)
            if _should_apply_edit(prev, prompt, is_edit, clean_photo_urls, clean_card_url, clean_ymaps_url):
                if prev and prev.assets:
                    job.assets = list(prev.assets)
                    if not job.photo_urls and prev.photo_urls:
                        job.photo_urls = list(prev.photo_urls)
                if prev and prev.html and len(prev.html) > _MAX_PREV_HTML:
                    # раньше макет обрезался до 12К знаков посреди кода, и правки ломали страницу
                    self._log(job, 'Макет слишком большой для правок поверх — соберу заново '
                                   'с учётом ваших пожеланий.')
                elif prev and prev.html:
                    uploads = list(uploads) + [{
                        'id': 'prev', 'name': 'текущая-версия-сайта.html', 'kind': 'text',
                        'mime': 'text/html', 'size': len(prev.html),
                        'content': prev.html, 'b64': ''}]
                    job.is_edit = True
                    # редактирование макета: та же папка, номер версии растёт
                    job.site_slug = prev.site_slug or _slug_from_prompt(prev.prompt, prev.job_id)
                    job.version = prev.version + 1
                    self._log(job, f'Правки поверх версии v{prev.version or 1} — '
                                   f'новая будет v{job.version} в той же папке.')
        if not job.site_slug:
            job.site_slug = _slug_from_prompt(prompt, job_id)
            job.version = 1
        job.uploads = uploads
        if uploads:
            names = ', '.join(a['name'] for a in uploads[:6])
            self._log(job, f'К задаче приложено файлов: {len(uploads)} ({names})')
        with self._lock:
            self._jobs[job_id] = job
        t = threading.Thread(target=self._run,
                             args=(job, api_key, extra, base_url, temperature,
                                   max_tokens, style, key21st),
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

    def _set_stage(self, job: AiJob, stage: str, label: str):
        job.stage = stage
        job.stage_label = label

    def _run(self, job: AiJob, api_key: str, extra: str, base_url: str,
             temperature: float, max_tokens: float, style: str = '',
             key21st: str = ''):
        try:
            job.status = 'running'
            self._set_stage(job, 'thinking', 'Думаю')
            if job.provider == 'Fracs AI':
                self._log(job, 'Думаю над задачей… (Fracs AI).')
            else:
                self._log(job, f'Думаю над задачей… Модель: {job.model or "default"} ({job.provider}).')
            if style and style in STYLE_PROMPTS:
                self._log(job, f'Выбран стиль: «{style}».')
            # бесплатные референсы с 21st.dev (metadata-поиск компонентов)
            if key21st:
                q = _21st_query_from_prompt(job.prompt)
                self._log(job, f'Подбираю референсы на 21st.dev: «{q}»…')
                ref = _21st_search(q, key21st, limit=3) or \
                    _21st_search('hero section landing page', key21st, limit=2)
                if ref:
                    self._log(job, 'Референсы найдены — идеи компонентов уйдут в задание.')
                    job.prompt = (job.prompt + '\n\nРЕФЕРЕНСЫ 21st.dev (метаданные: '
                                  'название/описание — переосмысли идеи под бизнес, '
                                  'не копируй чужой код и тексты):\n' + ref[:3000])
                else:
                    self._log(job, '21st.dev: референсы не найдены — собираю без них.')
            # ── Загрузка реальных фото бизнеса из карточки (2GIS / Яндекс Карты) ──
            if not job.assets:
                urls_to_fetch = list(job.photo_urls)
                if len(urls_to_fetch) < 2 and (job.card_url or job.ymaps_url):
                    discovered = _discover_card_photos(job.card_url, job.ymaps_url)
                    for du in discovered:
                        if du not in urls_to_fetch:
                            urls_to_fetch.append(du)
                if urls_to_fetch:
                    self._log(job, f'Загружаю фотографии бизнеса ({len(urls_to_fetch)} шт.)…')
                    job.assets = _fetch_card_photos(urls_to_fetch, limit=4)
                    if job.assets:
                        self._log(job, f'В макет добавлены реальные фото: '
                                   + ', '.join(a['rel_path'] for a in job.assets) + '.')

            llm_prompt = job.prompt
            if job.assets:
                photo_lines = [
                    '\n\nРЕАЛЬНЫЕ ФОТО БИЗНЕСА ИЗ КАРТОЧКИ (файлы уже сохранены рядом с index.html — '
                    'ОБЯЗАТЕЛЬНО используй их в вёрстке через <img>):'
                ]
                for idx_a, a in enumerate(job.assets):
                    role_hint = 'главное фото для отдельного медиа-слота hero (.hero-media)' if idx_a == 0 else 'фото для галереи / блока «О нас» в отдельной рамке (.photo-frame)'
                    photo_lines.append(f'- {a["rel_path"]} ({role_hint})')
                photo_lines.append(
                    'ПРАВИЛА ДЛЯ ФОТО: указывай в src ТОЛЬКО эти точные относительные пути (src="assets/photo-1.jpg"). '
                    'Размещай фото в выделенном фрейме (width:100%; height:100%; object-fit:cover; display:block) '
                    'БЕЗ текста поверх фото (или только full-bleed inset:0 с плотным тёмным оверлеем >=0.75). '
                    'Никогда не делай фото шириной 50-60% под текстом!'
                )
                llm_prompt = llm_prompt + '\n'.join(photo_lines)

            # Подбираем свежее визуальное направление и архетип специально под этот запуск
            dir_style, dir_var, dir_arch = _pick_creative_direction(job.prompt, style=style, seed=job.job_id)
            creative_recipe = _format_style_recipe(dir_style, dir_var, dir_arch)

            # ── конвейер Fracs AI: Cohere пишет тексты и арт-дирекшн, OpenRouter верстает ──
            use_pipe = _PIPELINE_ON and job.provider == 'Fracs AI'
            brief_block = ''
            if use_pipe and not job.is_edit:
                self._set_stage(job, 'thinking', 'Пишу тексты и концепцию')
                self._log(job, 'Редактор пишет тексты и подбирает палитру и шрифты под бизнес…')
                dir_hint = (
                    f'Направление «{dir_var["name"]}» (тема {dir_var["theme"]}, архетип {dir_arch["key"]}, '
                    f'акцент {dir_var["palette"]["accent"]}, шрифты {dir_var["fonts"][0]} + {dir_var["fonts"][1]}). '
                    'Используй это или предложи свой контрастный свежий вариант под этот конкретный бизнес.'
                )
                br = _make_brief(llm_prompt, extra, job.uploads, direction_hint=dir_hint)
                if br.get('ok'):
                    job.brief = br['brief']
                    brief_block = _brief_block(job.brief)
                    if not style:
                        style = job.brief.get('style_key', '')
                    self._log(job, f'Бриф готов за {br.get("ms", 0)} мс: композиция «{job.brief.get("archetype") or style or dir_style}»'
                                   + (f', шрифты {job.brief["fonts"]["display"]} + {job.brief["fonts"]["text"]}'
                                      if job.brief.get('fonts') else '') + '.')
                    for note in br.get('notes', []):
                        self._log(job, 'Редактор: ' + note)
                else:
                    self._log(job, 'Редактор недоступен (' + str(br.get('error') or 'ошибка')
                              + ') — собираю без брифа.')
            self._set_stage(job, 'building', 'Собираю')
            self._log(job, f'Собираю вёрстку ({dir_var["name"]}, {dir_arch["title"]})…')
            res = _call_llm(job.provider, api_key, job.model, llm_prompt, extra,
                            base_url=base_url, uploads=job.uploads,
                            temperature=temperature, max_tokens=max_tokens,
                            style=style, brief_block=brief_block,
                            creative_recipe=creative_recipe,
                            task='build' if job.provider == 'Fracs AI' else '')
            if res.get('skipped_images'):
                self._log(job, 'Картинки пропущены (провайдер без vision): '
                           + ', '.join(res['skipped_images']))
            if not res.get('ok'):
                job.status = 'failed'
                self._set_stage(job, 'failed', 'Ошибка')
                job.error = res.get('error', 'llm_error')
                job.error_code = str(res.get('error_code') or '')
                job.buy_url = str(res.get('buy_url') or '')
                job.reset_at = int(res.get('reset_at') or 0)
                self._log(job, f'Ошибка LLM: {job.error}')
                return
            self._set_stage(job, 'checking', 'Проверяю шедевр')
            self._log(job, f'Ответ получен за {res["ms"]} мс. Проверяю шедевр…')
            html = _extract_html(res['text'])
            html = _normalize_asset_refs(html, job.assets)
            html, font_fixes = _fix_fonts(html)
            if font_fixes:
                self._log(job, 'Шрифты без кириллицы заменены: ' + ', '.join(font_fixes) + '.')
            html, html_fixes = _heal_generated_html(html)
            if html_fixes:
                self._log(job, 'Автоисправление разметки: ' + ', '.join(html_fixes) + '.')
            if res.get('truncated'):
                self._log(job, 'Внимание: модель оборвала ответ по лимиту токенов — страница '
                               'могла получиться неполной. Нажмите «Изменить макет» и попросите '
                               'сделать проще/короче, либо выберите модель с большим лимитом.')
            if use_pipe:
                self._set_stage(job, 'checking', 'Вычитываю тексты')
                self._log(job, 'Редактор вычитывает тексты страницы…')
                html, n_fix, perr = _polish_html(html, job.prompt)
                if perr:
                    self._log(job, 'Вычитка пропущена: ' + perr)
                else:
                    self._log(job, f'Вычитка: исправлено текстов — {n_fix}.' if n_fix
                              else 'Вычитка: замечаний нет.')
            audit_summary, audit_notes = _audit_generated_html(html)
            self._log(job, audit_summary)
            for note in audit_notes + _design_flags(html):
                self._log(job, note)
            job.html = html
            job.preview_url = f'/api/ai/preview/{job.job_id}'
            saved = _save_site_files(job)
            if saved:
                job.site_url = saved
                self._log(job, 'Файлы сайта сохранены: '
                           f'{os.path.join(_SITES_DIR, job.site_slug)} (v{job.version}).')
                self._log(job, 'Локальная проверка (откройте в браузере): '
                           f'{self.base_url}{saved}')
            job.status = 'preview'
            self._set_stage(job, 'preview', 'Превью готово')
            self._log(job, 'Превью готово — посмотрите его перед сборкой.')
            self._log(job, 'Если устраивает — нажмите «Одобрить и собрать». '
                           'Если нет — нажмите «Изменить макет»: напишите правки и, '
                           'если нужно, смените стиль; сайт перегенерируется '
                           'в ту же папку следующей версией.')
            if not job.approved.wait(timeout=3600):
                job.status = 'cancelled'
                self._set_stage(job, 'cancelled', 'Отменено')
                self._log(job, 'Превью устарело (прошёл час). Запустите заново.')
                return
            job.status = 'building'
            self._set_stage(job, 'packaging', 'Упаковываю релиз')
            self._log(job, 'Собираю видеообзор (review.html)…')
            self._build_review(job)
            self._log(job, 'Публикую видеообзор по ссылке для QR…')
            self._publish_demo(job)
            self._log(job, 'Рисую открытку с QR-кодом…')
            self._build_postcard(job)
            self._log(job, 'Собираю ZIP: сайт, видеообзор и открытка…')
            self._build_zip(job)
            self._build_mp4(job)
            job.status = 'done'
            self._set_stage(job, 'done', 'Шедевр готов')
            self._log(job, 'Шедевр готов. ZIP и открытка — справа в «Передаче файлов».')
        except Exception as e:  # pragma: no cover
            job.status = 'failed'
            self._set_stage(job, 'failed', 'Ошибка')
            job.error = str(e)
            self._log(job, f'Ошибка: {e}')

    def _public_base(self) -> tuple[str, bool]:
        """(адрес для QR, публичный ли он). FRACS_DEMO_BASE_URL — свой хостинг демо (необязательно)."""
        demo = os.environ.get('FRACS_DEMO_BASE_URL', '').strip().rstrip('/')
        return (demo or self.base_url), bool(demo)

    def _publish_demo(self, job: AiJob):
        """Публикует review.html на сайт Fracs (/v/<id>) — QR получает рабочую ссылку без
        отдельного хостинга. Нужна активная лицензия; при ошибке остаёмся на локальном адресе."""
        if os.environ.get('FRACS_DEMO_BASE_URL', '').strip():
            return                       # задан свой хостинг — используем его
        if not job.review_path or not os.path.exists(job.review_path):
            return
        try:
            lic = _lic_mod()
            site = (lic._site() or '') if lic else ''
            key = _fracs_license_key()
            if not site or not key:
                self._log(job, 'Публикация демо пропущена: нет лицензионного ключа Fracs.')
                return
            with open(job.review_path, encoding='utf-8') as f:
                html = f.read()
            r = requests.post(site + '/api/app/demo', json={'html': html},
                              headers={'Authorization': 'Bearer ' + key}, timeout=60)
            try:
                d = r.json()
            except ValueError:
                d = {}
            if r.ok and d.get('url'):
                job.demo_url = d['url']
                self._log(job, f'Видеообзор опубликован: {job.demo_url} (хранится 45 дней).')
            else:
                self._log(job, 'Видеообзор не опубликован: ' + str(d.get('message') or d.get('error')
                                                                  or d.get('reason') or f'HTTP {r.status_code}'))
        except Exception as e:
            self._log(job, f'Видеообзор не опубликован: {e}')

    def _build_review(self, job: AiJob):
        """review.html — анимированный видеообзор: интро → сайт в окне браузера → телефон →
        финал. Самодостаточный файл (сайт внутри), лежит рядом с сайтом в sites/<slug>/.
        Именно эта страница открывается по QR. Не требует ffmpeg/playwright."""
        try:
            title, sub = business_parts(job.prompt, html=job.html, brief=job.brief)
            review_site_html = _inline_assets_html(job.html, job.assets)
            html = render_review_html(title, sub, review_site_html)
            d = (os.path.join(_SITES_DIR, job.site_slug) if job.site_url
                 else tempfile.mkdtemp(prefix='fracs_ai_rev_'))
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, 'review.html')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(html)
            job.review_path = path
        except Exception as e:
            self._log(job, f'Видеообзор не собран: {e}')

    def _build_postcard(self, job: AiJob):
        d = tempfile.mkdtemp(prefix='fracs_ai_png_')
        png_path = os.path.join(d, 'postcard.png')
        base, public = self._public_base()
        if job.demo_url:
            target, public = job.demo_url, True
        elif job.site_url and job.review_path:
            target = f'{base}{job.site_url}review.html'
        elif job.site_url:
            target = f'{base}{job.site_url}'
        else:
            target = f'{base}/api/ai/preview/{job.job_id}'
        if not public:
            self._log(job, 'ВНИМАНИЕ: видеообзор не опубликован, поэтому QR ведёт на адрес вашего '
                           'компьютера — у заказчика он не откроется. Проверьте лицензионный ключ '
                           'и интернет и соберите открытку заново.')
        if Image is None or not _HAVE_QR:
            self._log(job, 'Открытка пропущена: не установлены Pillow/qrcode.')
            return
        try:
            title, sub = business_parts(job.prompt, html=job.html, brief=job.brief)
            draw_postcard(png_path, target, title, sub)
            job.png_path = png_path
        except Exception as e:
            self._log(job, f'Открытка не нарисована: {e}')

    def _build_zip(self, job: AiJob):
        d = tempfile.mkdtemp(prefix='fracs_ai_')
        zip_path = os.path.join(d, 'site.zip')
        assets_note = ('assets/         — фотографии бизнеса, используемые в index.html.\n'
                       if job.assets else '')
        readme = ('# Сайт, собранный AI-Агентом Fracs\n\n'
                  'index.html      — одностраничный сайт-визитка. Откройте в браузере или выложите\n'
                  '                  на статический хостинг (Vercel / Netlify / GitHub Pages).\n'
                  + assets_note +
                  'review.html     — анимированный видеообзор сайта (его открывает QR из открытки).\n'
                  'postcard.png    — открытка с QR-кодом для заказчика.\n\n'
                  'Промт: ' + (job.prompt[:200] or '—') + '\n')
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('index.html', job.html)
            for asset in job.assets:
                rel = asset.get('rel_path')
                raw = asset.get('bytes')
                if rel and raw:
                    z.writestr(rel, raw)
            z.writestr('README.md', readme)
            if job.review_path and os.path.exists(job.review_path):
                z.write(job.review_path, 'review.html')
            if job.png_path and os.path.exists(job.png_path):
                z.write(job.png_path, 'postcard.png')
        job.zip_path = zip_path

    def _build_mp4(self, job: AiJob):
        """Необязательный бонус: запись review.html в site-review.mp4 (нужны playwright
        и ffmpeg). Без них шаг тихо пропускается — QR и так ведёт на review.html."""
        if os.environ.get('FRACS_NO_MP4') == '1' or not job.site_url or not job.review_path:
            return
        if not shutil.which('ffmpeg'):
            return
        try:
            import playwright  # noqa: F401
        except Exception:
            return
        d = tempfile.mkdtemp(prefix='fracs_ai_vid_')
        out = os.path.join(d, 'site-review.mp4')
        try:
            self._log(job, 'Записываю mp4-версию видеообзора (≈1 минута)…')
            if record_review_mp4(f'{self.base_url}{job.site_url}review.html', out):
                job.video_path = out
                try:
                    shutil.copyfile(out, os.path.join(_SITES_DIR, job.site_slug, 'review.mp4'))
                except OSError:
                    pass
                self._log(job, 'mp4 готов — site-review.mp4 в «Передаче файлов».')
        except Exception as e:
            self._log(job, f'mp4 пропущен: {e}')


# ── Fracs AI gate ─────────────────────────────────────────────────────────────

def _plan_features() -> list:
    """Коды возможностей текущего тарифа (из лицензии; при ошибке — пусто)."""
    try:
        lic = _lic_mod()
        if not lic:
            return []
        return [str(f).lower() for f in (lic.check().get('features') or [])]
    except Exception:
        return []


def _has_feature(*codes: str) -> bool:
    feats = set(_plan_features())
    return any(c in feats for c in codes)


def _provider_feature(provider: str) -> str:
    """Код тарифа, необходимый для провайдера: Fracs AI — 'fracs_ai',
    любой свой провайдер — 'ai_provider'."""
    return 'fracs_ai' if _provider_cfg(provider).get('pro_only') else 'ai_provider'


def fracs_ai_allowed() -> dict:
    """Fracs AI доступен только на Ultra. Проверяем активную лицензию Fracs и её тариф/фичи."""
    fracs_license = _lic_mod()
    if not fracs_license:
        return {'allowed': False, 'reason': 'license_unavailable'}
    st = fracs_license.check()
    if not st.get('ok'):
        reason = 'offline' if st.get('offline') else (st.get('reason') or 'no_license')
        return {'allowed': False, 'reason': 'Подписка Fracs не активна. Fracs AI доступен на тарифе Ultra.' if reason != 'offline'
                else 'Нет связи с сервером Fracs — Fracs AI временно недоступен.'}
    features = [str(f).lower() for f in (st.get('features') or [])]
    if ('fracs_ai' in features or 'ai' in features or 'business' in features
            or 'ultra' in features):
        return {'allowed': True}
    return {'allowed': False,
            'reason': 'Fracs AI доступен только на тарифе Ultra. Оформите Ultra в кабинете '
                      'или выберите своего провайдера (доступен на PRO).'}


def _fracs_ai_ready() -> bool:
    """Fracs AI настроен на этой сборке: есть ключ (OPENROUTER_API_KEY) или работает прокси сайта Fracs."""
    if _FRACS_AI_KEY:
        return True
    try:
        return bool(_fracs_proxy())
    except Exception:
        return False


def _fracs_key_env() -> str:
    """Имя переменной окружения, из которой взят ключ Fracs AI (для диагностики
    в UI). Пусто — ключа в окружении нет."""
    # имя движка наружу не отдаём
    return ''


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
        items = []
        for pid, cfg in _PROVIDERS.items():
            need = _provider_feature(pid)
            if need == 'fracs_ai':
                try:
                    ok = bool(fracs_ai_allowed().get('allowed'))
                    reason = '' if ok else 'Fracs AI доступен только на тарифе Ultra.'
                except Exception:
                    ok, reason = False, 'Лицензия недоступна.'
            else:
                ok = _has_feature('ai_provider')
                reason = '' if ok else ('AI-агент со своим провайдером доступен на тарифах '
                                        'PRO и Ultra. Оформите PRO в кабинете.')
            items.append({
                'id': pid, 'name': pid, 'desc': cfg.get('desc', ''),
                'needs_key': bool(cfg.get('needs_key', True)),
                'vision': bool(cfg.get('vision')),
                'pro_only': bool(cfg.get('pro_only')),
                'feature': need,
                'allowed': ok,
                'reason': reason,
                'configured': (not cfg.get('pro_only')) or _fracs_ai_ready(),
                'key_env': '',
                'models': ['fracs-ai'] if cfg.get('pro_only') else list(cfg.get('default_models') or []),
            })
        return {'ok': True, 'features': _plan_features(), 'providers': items}

    @app.route('/api/ai/providers')
    def ai_providers():
        return jsonify(_providers_payload())

    @app.route('/api/ai/models')
    def ai_models():
        provider = request.args.get('provider', 'Z.ai')
        # Ключ берём из заголовка X-Api-Key (не попадает в access-логи);
        # query-параметр оставлен для совместимости со старой версией UI.
        api_key = (request.headers.get('X-Api-Key')
                   or request.args.get('api_key') or '').strip()
        base_url_q = request.args.get('base_url', '')
        # Fracs AI без ключа на сервере и без прокси: моделей не отдаём вовсе.
        if provider == 'Fracs AI' and not _fracs_ai_ready():
            return jsonify({'ok': True, 'models': [], 'auto': False,
                            'error': 'fracs_ai_not_configured'})
        need = _provider_feature(provider)
        if not _has_feature(need):
            gate = fracs_ai_allowed() if need == 'fracs_ai' else {'allowed': False}
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
            # премиум-страница с блоками из библиотеки крупнее, чем 4К токенов;
            # максимум ограничиваем, чтобы не ругались строгие API
            max_tokens = min(16384, max(4096, int(data.get('max_tokens', 16384))))
        except (TypeError, ValueError):
            max_tokens = 16384
        photos = data.get('photos') if isinstance(data.get('photos'), list) else []
        is_edit_raw = data.get('is_edit') if 'is_edit' in data else None
        is_edit_arg = bool(is_edit_raw) if is_edit_raw is not None else None
        res = mgr.start(prompt, api_key, model, provider,
                        extra=str(data.get('extra', '')).strip(),
                        session_id=str(data.get('session_id', '')).strip(),
                        prev_job=str(data.get('prev_job', '')).strip(),
                        base_url=str(data.get('base_url', '')).strip(),
                        temperature=temperature, max_tokens=max_tokens,
                        style=str(data.get('style', '')).strip(),
                        key21st=str(data.get('key21st', '')).strip()
                        or _21ST_KEY_ENV,
                        photos=photos,
                        card_url=str(data.get('card_url', '')).strip(),
                        ymaps_url=str(data.get('ymaps_url', '')).strip(),
                        is_edit=is_edit_arg)
        status = 403 if (not res.get('ok') and res.get('pro_required')) else 200
        return jsonify(res), status

    @app.route('/api/ai/usage')
    def ai_usage_proxy():
        """Квота Fracs AI (сложность, фразы и токены) через прокси сайта для показа в чате."""
        proxy = _fracs_proxy()
        if not proxy:
            return jsonify({'ok': False, 'error': 'not_proxied'})
        try:
            r = requests.get(proxy[0] + '/api/app/ai/usage',
                             headers={'Authorization': 'Bearer ' + proxy[1]}, timeout=10)
            return jsonify(r.json()), r.status_code
        except Exception:
            return jsonify({'ok': False, 'error': 'offline'}), 502

    @app.route('/api/ai/buy', methods=['POST'])
    def ai_buy_proxy():
        """Покупка пакета токенов Fracs AI прямо из программы через сайт."""
        proxy = _fracs_proxy()
        if not proxy:
            return jsonify({'ok': False, 'error': 'not_proxied',
                            'message': 'Для покупки токенов войдите по лицензионному ключу.'}), 400
        data = request.get_json(force=True, silent=True) or {}
        payload = {
            'packId': str(data.get('packId', '')).strip(),
            'method': str(data.get('method', 'cryptobot')).strip(),
        }
        try:
            r = requests.post(proxy[0] + '/api/app/ai/buy', json=payload,
                              headers={'Authorization': 'Bearer ' + proxy[1]}, timeout=20)
            return jsonify(r.json()), r.status_code
        except Exception:
            return jsonify({'ok': False, 'error': 'offline',
                            'message': 'Нет связи с сервером оплаты Fracs.'}), 502

    @app.route('/api/ai/chat', methods=['POST'])
    def ai_chat():
        """Живой чат: модель отвечает текстом в чате, а при готовности ставит [BUILD] / [BUILD_NEW] / [BUILD_EDIT]."""
        data = request.get_json(force=True, silent=True) or {}
        msg = str(data.get('message', '')).strip()
        if not msg:
            return jsonify({'ok': False, 'error': 'no_message'}), 400
        provider = str(data.get('provider', 'Z.ai')).strip()
        api_key = str(data.get('api_key', '')).strip()
        model = str(data.get('model', '')).strip()
        base_url = str(data.get('base_url', '')).strip()
        editing = bool(data.get('editing'))
        has_job = bool(data.get('has_job'))
        if provider != 'Fracs AI' and _provider_cfg(provider).get('needs_key') and not api_key:
            return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        need = _provider_feature(provider)
        if not _has_feature(need):
            return jsonify({'ok': False, 'error': 'pro_required', 'pro_required': True}), 403
        lines = []
        for m in (data.get('history') or [])[-8:]:
            if isinstance(m, dict) and str(m.get('role')) in ('user', 'assistant') and m.get('content'):
                who = 'Пользователь' if m.get('role') == 'user' else 'Ты'
                lines.append(who + ': ' + str(m.get('content'))[:2000])
        lines.append('Пользователь: ' + msg)
        ctx_rule = (
            'Сейчас включён режим правки текущего макета: коротко подтверди правку и поставь маркер [BUILD_EDIT] '
            '(если пользователь явно просит ДРУГОЙ новый бизнес с нуля — поставь [BUILD_NEW]).'
            if editing else
            ('В чате уже есть собранный макет. Если пользователь просит поправить именно его (цвет, блок, шрифт, текст) — '
             'закончи маркером [BUILD_EDIT]. Если пользователь просит сайт для ДРУГОГО или нового бизнеса («сделай сайт для пекарни») — '
             'закончи маркером [BUILD_NEW].'
             if has_job else
             'Если ниша/задача уже понятна ИЛИ собеседник уточнил детали — НЕ задавай больше вопросов, коротко подтверди '
             'старт сборки и закончи ответ маркером [BUILD_NEW].')
        )
        system = ('Ты — «личный AI-Агент» внутри программы Fracs. Отвечай в обычном чате: '
                  'кратко, по-человечески, на русском, 1–3 предложения. Ты умеешь собирать '
                  'одностраничные сайты-визитки по карточкам бизнеса (2ГИС) или текстовому '
                  'описанию, показывать превью, а после одобрения собирать ZIP, открытку с '
                  'QR-кодом и видеообзор. Никогда не придумывай ссылки, URL и пути к файлам. '
                  'Если это приветствие или общий вопрос без задачи на сайт — просто ответь. '
                  'Если собеседник просит собрать сайт и пока НЕ назвал нишу или бизнес — задай ОДИН короткий уточняющий вопрос. '
                  + ctx_rule)
        res = _call_llm(provider, api_key, model, '\n'.join(lines), base_url=base_url,
                        temperature=0.55, max_tokens=800, system=system)
        if not res.get('ok'):
            return jsonify({'ok': False, 'error': str(res.get('error') or 'model_error'),
                            'error_code': res.get('error_code', ''),
                            'buy_url': res.get('buy_url', ''),
                            'reset_at': res.get('reset_at', 0)}), 502
        text = str(res.get('text') or '').strip()
        build_edit = '[BUILD_EDIT]' in text
        build_new = '[BUILD_NEW]' in text
        build = build_edit or build_new or ('[BUILD]' in text)
        for tag in ('[BUILD_EDIT]', '[BUILD_NEW]', '[BUILD]'):
            text = text.replace(tag, '')
        text = text.strip()
        is_edit_out = bool(build and (build_edit or (editing and not build_new)))
        return jsonify({
            'ok': True,
            'reply': text,
            'build': build,
            'is_edit': is_edit_out,
            'stage': 'building' if build else 'thinking',
            'stage_label': 'Собираю' if build else 'Думаю',
        })

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
        # HTML сгенерирован нейросетью/пользователем: изолируем origin (CSP sandbox
        # без allow-same-origin) — скрипты страницы не достучатся до /api/* программы.
        preview_html = _inline_assets_html(job.html, job.assets) if job.assets else job.html
        resp = Response(preview_html, mimetype='text/html; charset=utf-8')
        resp.headers['Content-Security-Policy'] = "sandbox allow-scripts allow-forms allow-popups"
        return resp

    # Локальная проверка сохранённых файлов сайта (стабильный URL).
    @app.route('/sites/<path:subpath>')
    def sites_files(subpath: str):
        full = os.path.realpath(os.path.join(_SITES_DIR, subpath))
        if not full.startswith(os.path.realpath(_SITES_DIR) + os.sep) and \
                full != os.path.realpath(_SITES_DIR):
            return Response('forbidden', status=403, mimetype='text/plain')
        if not os.path.isfile(full):
            if os.path.isdir(full):
                full = os.path.join(full, 'index.html')
            if not os.path.isfile(full):
                return Response('Сайт ещё не собран в эту папку.', status=404,
                                mimetype='text/plain')
        resp = send_file(full)
        if str(full).lower().endswith(('.html', '.htm', '.svg')):
            resp.headers['Content-Security-Policy'] = "sandbox allow-scripts allow-forms allow-popups"
        return resp

    @app.route('/api/ai/sites')
    def sites_list():
        """Список собранных сайтов в <проект>/sites/ (для повторного открытия)."""
        out = []
        if os.path.isdir(_SITES_DIR):
            for slug in sorted(os.listdir(_SITES_DIR)):
                d = os.path.join(_SITES_DIR, slug)
                meta_path = os.path.join(d, 'meta.json')
                if os.path.isfile(os.path.join(d, 'index.html')):
                    meta = {}
                    try:
                        with open(meta_path, encoding='utf-8') as f:
                            meta = json.load(f)
                    except (OSError, ValueError):
                        pass
                    out.append({'slug': slug, 'url': f'/sites/{slug}/',
                                'version': meta.get('version', 1),
                                'prompt': (meta.get('prompt') or '')[:120]})
        return jsonify({'ok': True, 'sites': out})

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
        if kind == 'video' and job.video_path and os.path.exists(job.video_path):
            return send_file(job.video_path, as_attachment=True,
                             download_name='site-review.mp4', mimetype='video/mp4')
        return jsonify({'ok': False, 'error': 'file_not_ready'}), 404

    @app.route('/api/ai/upload', methods=['POST'])
    def ai_upload():
        session_id = (request.form.get('session_id') or '').strip()
        if not session_id:
            return jsonify({'ok': False, 'error': 'no_session'}), 400
        files = request.files.getlist('files') or []
        if not files:
            return jsonify({'ok': False, 'error': 'no_files'}), 400
        saved, too_big = [], []
        for f in files:
            if not f or not f.filename:
                continue
            data = f.stream.read(_MAX_UPLOAD_BYTES + 1)
            if len(data) > _MAX_UPLOAD_BYTES:
                too_big.append(os.path.basename(f.filename))
                continue
            fd, tmp = tempfile.mkstemp(prefix='fracs_up_')
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
            saved.append((os.path.basename(f.filename), tmp))
        if not saved:
            return jsonify({'ok': False, 'error': 'file_too_large',
                            'message': 'Файл больше 15 МБ: ' + ', '.join(too_big[:3])}), 400
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

    @app.route('/api/ai/test21st', methods=['POST'])
    def ai_test21st():
        data = request.get_json(force=True, silent=True) or {}
        key = str(data.get('key21st', '')).strip() or _21ST_KEY_ENV
        if not key:
            return jsonify({'ok': False, 'error': 'no_key'}), 400
        ref = _21st_search('hero section landing page', key, limit=2)
        if not ref:
            return jsonify({'ok': False, 'error': 'bad_key_or_no_results'})
        return jsonify({'ok': True, 'sample': ref[:220]})

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
            if not _fracs_ai_ready():
                return jsonify({'ok': False, 'error': _FRACS_DOWN})
        else:
            if _provider_cfg(provider).get('needs_key') and not api_key:
                return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        res = _call_llm(provider, api_key, str(data.get('model', '')).strip(),
                        'Проверка связи. Ответь одним словом: ok.', '',
                        base_url=str(data.get('base_url', '')).strip(),
                        max_tokens=32,
                        system='Ты — сервис проверки связи. Отвечай одним словом.')
        if not res.get('ok'):
            return jsonify({'ok': False, 'error': res.get('error', 'unknown'),
                            'ms': res.get('ms', 0)})
        return jsonify({'ok': True, 'ms': res.get('ms', 0)})

    @app.route('/api/ai/phrases', methods=['POST'])
    def ai_phrases():
        """FracsAI-генератор поисковых фраз: из одной фразы делает до 20 похожих
        для Telegram-поиска. Провайдер/ключ/модель берутся из конфига AI-Агента."""
        data = request.get_json(force=True, silent=True) or {}
        phrase = str(data.get('phrase', '')).strip()
        provider = str(data.get('provider', 'Z.ai')).strip()
        api_key = str(data.get('api_key', '')).strip()
        if not phrase:
            return jsonify({'ok': False, 'error': 'no_phrase'}), 400
        if provider == 'Fracs AI':
            gate = fracs_ai_allowed()
            if not gate.get('allowed'):
                return jsonify({'ok': False, 'error': str(gate.get('reason') or 'pro_required'),
                                'pro_required': True})
            if not _fracs_ai_ready():
                return jsonify({'ok': False, 'error': _FRACS_DOWN})
        else:
            if _provider_cfg(provider).get('needs_key') and not api_key:
                return jsonify({'ok': False, 'error': 'no_api_key'}), 400
        try:
            temperature = min(1.2, max(0.2, float(data.get('temperature', 0.9))))
        except (TypeError, ValueError):
            temperature = 0.9
        system = (
            'Ты — специалист по контекстной рекламе и парсингу заявок в Telegram. '
            'Пользователь даёт одну поисковую фразу людей, ищущих услугу или товар. '
            'Сгенерируй до 20 РЕАЛЬНЫХ, живых формулировок, которые пишут люди в чатах, '
            'когда ищут то же самое: с опечатками, разговорные, короткие и длинные, '
            '«посоветуйте», «где заказать», «сколько стоит», с городом и без. '
            'Не повторяй одну и ту же фразу с разными словами — разнообразь структуру. '
            'ВАЖНО: верни только сами фразы — по одной на строку, без нумерации, '
            'без кавычек и без каких-либо пояснений.')
        res = _call_llm(provider, api_key, str(data.get('model', '')).strip(),
                        'Исходная фраза: ' + phrase, '',
                        base_url=str(data.get('base_url', '')).strip(),
                        temperature=temperature, max_tokens=1200, system=system)
        if not res.get('ok'):
            return jsonify({'ok': False, 'error': res.get('error', 'unknown'),
                            'error_code': res.get('error_code', ''),
                            'buy_url': res.get('buy_url', ''),
                            'reset_at': res.get('reset_at', 0)})
        # парсим ответ: по строке на фразу, снимаем нумерацию/буллеты/кавычки
        phrases, seen = [], set()
        for line in res['text'].splitlines():
            s = line.strip().strip('«»"\'')
            s = re.sub(r'^\s*(?:\d+[\).\s:-]+|[-•*]\s+)', '', s).strip().strip('«»"\'')
            if len(s) < 3 or len(s) > 120:
                continue
            low = s.lower()
            if low in seen:
                continue
            seen.add(low)
            phrases.append(s)
            if len(phrases) >= 20:
                break
        if not phrases:
            return jsonify({'ok': False, 'error': 'Не удалось разобрать фразы из ответа модели.'})
        return jsonify({'ok': True, 'phrases': phrases, 'ms': res.get('ms', 0)})

