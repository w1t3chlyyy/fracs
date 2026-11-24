#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply_fixes.py — безопасный патчер репозитория Fracs (сайт + desktop).

Закрывает блокеры из ревью 24.11.2026, для которых в поставке нет полного файла
(правки вносятся точечно, каждый патч отчитывается OK / SKIP / FAIL):

  desktop:
   1. requirements.txt          — + qrcode, Pillow (QR-открытка в релизе)
   2. fracs_parser.spec         — hiddenimports += qrcode, PIL
   3. parser_2gis/web/server.py — запасные тарифы Start 1800 / PRO 2700 / Ultra 4500,
                                  текст «владельцы на PRO и Ultra»
   4. hmac.compare_digest       — не падает на не-ASCII заголовке (encode в bytes)
  сайт:
   5. server/appRoutes.ts       — POST /api/app/ai и GET /api/app/ai/models:
                                  прокси Fracs AI, ключ OpenRouter ТОЛЬКО на сервере,
                                  доступ по фиче fracs_ai (Ultra), лимит частоты
   6. .env.example              — + OPENROUTER_API_KEY
   7. .gitignore                — полная замена (.env, __pycache__, sites/, dist/, data/)
   8. vercel.json               — buildCommand: npm run build:api (пересборка api/index.js)
   9. Гигиена: удаление корневых устаревших копий (server.ts, server.js, ai_agent.py,
      server.py, tg.js), public/assets/aistudio/*.py, dist/, __pycache__,
      api/index.js (если buildCommand выставлен)
  10. src-компоненты-заглушки (DemoTool/TgTool/MapsTool/AiAgent/Training):
      удаляются, только если нигде не импортируются (проверка по grep)
  11. README_VERCEL.md — печатает строки с упоминанием «Демо» (для ручной правки)

Запуск:  python3 apply_fixes.py            (из корня репозитория сайта)
         python3 apply_fixes.py <путь-к-desktop>   (папка desktop, если не ./desktop)

Полные заменяемые файлы (ai_agent.py, index.html, license.py, config.ts, db.ts,
bot.ts, routes.ts, icon.*) копируются из поставки отдельно — скрипт их не трогает,
но проверяет, что они на месте, и напоминает.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path

REPORT: list[str] = []


def ok(msg: str) -> None:
    REPORT.append('  OK   ' + msg)
    print('  OK   ' + msg)


def skip(msg: str) -> None:
    REPORT.append('  SKIP ' + msg)
    print('  SKIP ' + msg)


def fail(msg: str) -> None:
    REPORT.append('  FAIL ' + msg)
    print('  FAIL ' + msg)


def read(p: Path) -> str:
    return p.read_text(encoding='utf-8')


def write(p: Path, s: str) -> None:
    p.write_text(s, encoding='utf-8')


def patch(name: str, path: Path, old: str, new: str, count: int = 1) -> None:
    """Точная замена текста; SKIP если уже применена, FAIL если не найдена."""
    if not path.is_file():
        return fail(f'{name}: файл не найден ({path})')
    s = read(path)
    if new in s and old not in s:
        return skip(f'{name}: уже применено')
    if old not in s:
        return fail(f'{name}: образец не найден — файл изменился, правка вручную')
    write(path, s.replace(old, new, count))
    ok(f'{name}: заменено ({count})')


# ─────────────────────────────────────────────────────────────────────────────
def fix_requirements(base: Path) -> None:
    p = base / 'requirements.txt'
    if not p.is_file():
        return fail('requirements.txt не найден')
    s = read(p)
    add = []
    if not re.search(r'^\s*qrcode\b', s, re.M):
        add.append('qrcode')
    if not re.search(r'^\s*(Pillow|PIL)\b', s, re.M):
        add.append('Pillow')
    if add:
        write(p, s.rstrip('\n') + '\n' + '\n'.join(add) + '\n')
        ok('requirements.txt: добавлены ' + ', '.join(add) + ' (QR-открытка в релизе)')
    else:
        skip('requirements.txt: qrcode/Pillow уже есть')


def fix_spec(base: Path) -> None:
    p = base / 'fracs_parser.spec'
    if not p.is_file():
        return fail('fracs_parser.spec не найден')
    s = read(p)
    m = re.search(r'hiddenimports\s*=\s*\[', s)
    if not m:
        return fail('fracs_parser.spec: блок hiddenimports не найден — добавьте вручную '
                    "'qrcode', 'PIL' в hiddenimports")
    need = [x for x in ("'qrcode'", "'PIL'") if x not in s]
    if not need:
        return skip('fracs_parser.spec: hiddenimports уже содержит qrcode/PIL')
    idx = s.index('[', m.start())
    s = s[:idx + 1] + ', '.join(need) + ', ' + s[idx + 1:]
    write(p, s)
    ok('fracs_parser.spec: hiddenimports += ' + ', '.join(need))


FALLBACK_OLD = """    _FALLBACK_PLANS = [
        {'id': 'start', 'title': 'Старт', 'days': 30, 'priceRub': 990,
         'badge': '', 'description': 'Парсинг 2ГИС и Telegram-поиск. Выгрузка CSV/HTML.'},
        {'id': 'pro', 'title': 'PRO', 'days': 30, 'priceRub': 1990,
         'badge': 'Популярный', 'description': 'Всё из «Старт» + поиск владельцев и раздел «Обучение».'},
        {'id': 'business', 'title': 'Бизнес', 'days': 90, 'priceRub': 4990,
         'badge': 'Выгодно', 'description': 'PRO на 90 дней + AI-Агент без ограничений по числу генераций.'},
    ]"""

FALLBACK_NEW = """    _FALLBACK_PLANS = [
        {'id': 'start', 'title': 'Start', 'days': 30, 'priceRub': 1800,
         'badge': '', 'description': 'Парсинг Telegram и карт 2ГИС, база контактов, выгрузки CSV/HTML.'},
        {'id': 'pro', 'title': 'PRO', 'days': 30, 'priceRub': 2700,
         'badge': 'Владельцы + Обучение',
         'description': 'Всё из «Start» + поиск владельцев, раздел «Обучение» и AI-агент со своим провайдером.'},
        {'id': 'ultra', 'title': 'Ultra', 'days': 30, 'priceRub': 4500,
         'badge': 'Максимум',
         'description': 'Всё из «PRO» + встроенный Fracs AI (отдельная кнопка в AI-агенте).'},
    ]"""


def fix_server_py(base: Path) -> None:
    p = base / 'parser_2gis' / 'web' / 'server.py'
    if not p.is_file():
        return fail('web/server.py не найден — проверьте путь desktop/parser_2gis/web/server.py')
    patch('server.py: запасные тарифы 1800/2700/4500', p, FALLBACK_OLD, FALLBACK_NEW)
    patch('server.py: текст владельцев PRO/Ultra', p,
          "'message': 'Поиск владельцев доступен на тарифе PRO.'}), 402",
          "'message': 'Поиск владельцев доступен на тарифах PRO и Ultra.'}), 402")


def fix_compare_digest(base: Path) -> None:
    """hmac.compare_digest(a, b) → bytes: не-ASCII заголовок больше не даёт 500."""
    n = 0
    for p in base.rglob('*.py'):
        sp = str(p)
        if '__pycache__' in sp or '.venv' in sp or 'node_modules' in sp:
            continue
        s = read(p)
        if 'compare_digest' not in s:
            continue
        new = re.sub(
            r"hmac\.compare_digest\(\s*([^(),\[\]]+)\s*,\s*([^(),\[\]]+)\s*\)",
            lambda m: f"hmac.compare_digest(str({m.group(1).strip()}).encode('utf-8'), "
                      f"str({m.group(2).strip()}).encode('utf-8'))",
            s)
        if new != s:
            write(p, new)
            ok(f'compare_digest → bytes: {p.relative_to(base)}')
            n += 1
    if not n:
        skip('compare_digest: вхождений не найдено (уже исправлено или файлы удалены)')


# ── Сайт: прокси Fracs AI в appRoutes.ts ────────────────────────────────────
AI_PROXY_BLOCK = """

// ═════════════════════════════════════════════════════════════════════════════
// Fracs AI: прокси к OpenRouter (apply_fixes.py, обновление 9).
// Ключ OpenRouter хранится ТОЛЬКО на сервере (config.openrouterApiKey); программа
// шлёт чат на /api/app/ai с лицензионным ключом в Authorization. Доступ — фича
// 'fracs_ai' тарифа Ultra. Модели — GET /api/app/ai/models (кэш 10 минут).
// ═════════════════════════════════════════════════════════════════════════════
const OR_MODELS_TTL = 10 * 60_000;
let orModelsCache: { at: number; list: any[] } = { at: 0, list: [] };

function orAuthKey(req: any): string {
  // Ключ лицензии программы: Authorization: Bearer <license_key>
  const h = String(req.headers?.authorization || '').replace(/^Bearer\\s+/i, '').trim();
  if (h) return h;
  // Фолбэк: { key: ... } в теле (единый стиль остальных /api/app эндпоинтов).
  const k = req.body?.key;
  return typeof k === 'string' ? k.trim() : '';
}

async function fracsAiGate(req: any): Promise<{ user: any } | { error: [number, any] }> {
  const uid = orAuthKey(req);
  if (!uid || uid.length > 128) return { error: [401, { ok: false, reason: 'invalid' }] };
  const user = await getUser(uid);
  if (!user) return { error: [401, { ok: false, reason: 'invalid' }] };
  if (!isSubscribed(user)) return { error: [402, { ok: false, reason: 'expired' }] };
  if (!(await checkChannelSubs(user.tgId))) return { error: [403, { ok: false, reason: 'channels_required' }] };
  const features = await getActiveFeatures(user);
  if (!features.includes('fracs_ai') && !features.includes('ai')) {
    return { error: [402, { ok: false, error: 'fracs_ai_required', message: 'Fracs AI доступен на тарифе Ultra. Оформите Ultra в кабинете.' }] };
  }
  return { user };
}

appRouter.post('/ai', h(async (req, res) => {
  if (!(await rateLimit(`app-ai:${req.ip}`, 240, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI не настроен на сервере (нет OPENROUTER_API_KEY).' });
  }
  const body = req.body?.body ?? req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !String(body.model || '')) {
    return void res.status(400).json({ ok: false, error: 'bad_request', message: 'Ожидается тело chat/completions.' });
  }
  delete (body as any).key; // лицензионный ключ не уходит в OpenRouter
  try {
    const upstream = await fetch(config.openrouterUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouterApiKey}` },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream', message: 'OpenRouter недоступен: ' + String(e?.message || e) });
  }
}));

appRouter.get('/ai/models', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-models:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (orModelsCache.list.length && Date.now() - orModelsCache.at < OR_MODELS_TTL) {
    return void res.json(orModelsCache.list);
  }
  try {
    const upstream = await fetch(config.openrouterUrl + '/models', {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
    });
    if (!upstream.ok) return void res.status(502).json({ ok: false, error: 'upstream' });
    const data = await upstream.json();
    orModelsCache = { at: Date.now(), list: data };
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream' });
  }
}));
"""


def fix_app_routes(site: Path) -> None:
    p = site / 'server' / 'appRoutes.ts'
    if not p.is_file():
        return fail('server/appRoutes.ts не найден — прокси Fracs AI добавьте вручную '
                    '(блок в patches/appRoutes-ai-proxy.ts)')
    s = read(p)
    if '/ai/models' in s and 'fracsAiGate' in s:
        return skip('appRoutes.ts: прокси Fracs AI уже добавлен')
    for name in ('parseKey', 'getUser', 'isSubscribed', 'checkChannelSubs',
                 'getActiveFeatures', 'rateLimit', 'h('):
        if name.rstrip('(') not in s:
            return fail(f'appRoutes.ts: не найден импорт {name} — блок прокси добавьте вручную')
    write(p, s.rstrip('\n') + '\n' + AI_PROXY_BLOCK)
    ok('appRoutes.ts: добавлены POST /api/app/ai и GET /api/app/ai/models (ключ на сервере)')
    save_block(p.parent / 'patches' / 'appRoutes-ai-proxy.ts', AI_PROXY_BLOCK)


def save_block(path: Path, block: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('// Копия блока, добавленного в server/appRoutes.ts (для просмотра)\n' + block, encoding='utf-8')


def fix_env_example(site: Path) -> None:
    p = site / '.env.example'
    if not p.is_file():
        return fail('.env.example не найден')
    s = read(p)
    if 'OPENROUTER_API_KEY' in s:
        return skip('.env.example: OPENROUTER_API_KEY уже есть')
    write(p, s.rstrip('\n') + '\n# Ключ OpenRouter для прокси Fracs AI (только на сервере, не в сборке программы)\nOPENROUTER_API_KEY=\n')
    ok('.env.example: добавлен OPENROUTER_API_KEY')


GITIGNORE = """node_modules/
dist/
.vercel/
.env
.env.*
!.env.example
__pycache__/
*.pyc
sites/
data/
*.log
.DS_Store
"""


def fix_gitignore(site: Path) -> None:
    p = site / '.gitignore'
    old = read(p) if p.is_file() else ''
    if '.env' in old:
        return skip('.gitignore: уже содержит .env')
    write(p, GITIGNORE)
    ok('.gitignore: заменён на полный (.env, __pycache__, sites/, dist/, data/…)')


def fix_vercel_json(site: Path) -> bool:
    """Выставить buildCommand для пересборки api/index.js. Возвращает успех."""
    p = site / 'vercel.json'
    if not p.is_file():
        fail('vercel.json не найден — api/index.js НЕ удаляем, пересборка вручную')
        return False
    try:
        data = json.loads(read(p))
    except ValueError:
        fail('vercel.json не парсится — проверьте вручную')
        return False
    if data.get('buildCommand'):
        skip('vercel.json: buildCommand уже задан')
        return True
    data['buildCommand'] = 'npm run build:api'
    write(p, json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    ok('vercel.json: buildCommand = npm run build:api (api/index.js пересоберётся при деплое)')
    return True


STALE_ROOT = ['server.ts', 'server.js', 'ai_agent.py', 'server.py', 'tg.js']


def fix_hygiene(site: Path, remove_api_bundle: bool) -> None:
    for name in STALE_ROOT:
        p = site / name
        if p.is_file():
            p.unlink()
            ok(f'удалён устаревший корневой {name}')
        else:
            skip(f'корневой {name}: уже отсутствует')
    aistudio = site / 'public' / 'assets' / 'aistudio'
    if aistudio.is_dir():
        for f in list(aistudio.iterdir()):
            if f.suffix == '.py':
                f.unlink()
                ok(f'удалён публичный исходник {f.relative_to(site)}')
        if not any(aistudio.iterdir()):
            aistudio.rmdir()
            ok(f'удалена пустая папка {aistudio.relative_to(site)}')
    else:
        skip('public/assets/aistudio: не найдена')
    for d in ('dist', '__pycache__', 'server/__pycache__', 'desktop/parser_2gis/__pycache__'):
        p = site / d
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
            ok(f'удалена папка {d}/')
    if remove_api_bundle:
        p = site / 'api' / 'index.js'
        if p.is_file():
            p.unlink()
            ok('удалён закоммиченный api/index.js (Vercel соберёт его сам)')


CANDIDATE_COMPONENTS = ['DemoTool', 'TgTool', 'MapsTool', 'AiAgent', 'Training']


def fix_cabinet_stubs(site: Path) -> None:
    src_candidates = [d for d in (site / 'src', site / 'web', site / 'app', site / 'pages') if d.is_dir()]
    if not src_candidates:
        skip('кабинет: папка src не найдена (структура отличалась — проверьте вручную)')
        return
    src = src_candidates[0]
    removed = 0
    for name in CANDIDATE_COMPONENTS:
        files = [f for f in src.rglob(f'{name}.tsx')]
        if not files:
            continue
        f = files[0]
        refs = 0
        for g in src.rglob('*.tsx'):
            if g == f:
                continue
            if re.search(r'\b' + name + r'\b', read(g)):
                refs += 1
        if refs == 0:
            f.unlink()
            ok(f'удалена неиспользуемая заглушка {f.relative_to(site)}')
            removed += 1
        else:
            skip(f'{name}: есть ссылки ({refs}) — оставлен')
    if not removed:
        skip('кабинет: заглушки не найдены')


def fix_readme_vercel(site: Path) -> None:
    p = site / 'README_VERCEL.md'
    if not p.is_file():
        return skip('README_VERCEL.md не найден')
    hits = [f'    стр. {i}: {ln.strip()[:90]}'
            for i, ln in enumerate(read(p).splitlines(), 1) if 'Демо' in ln or 'DemoTool' in ln]
    if hits:
        fail('README_VERCEL.md упоминает вкладку «Демо», которой нет — поправьте строки:\n' + '\n'.join(hits))
    else:
        skip('README_VERCEL.md: упоминаний «Демо» нет')


# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    print(f'Репозиторий сайта: {site}')
    desktop = site / 'desktop'
    if not desktop.is_dir():
        alt = site.parent / 'desktop'
        desktop = alt if alt.is_dir() else desktop
    print(f'Репозиторий desktop: {desktop} {"(найден)" if desktop.is_dir() else "(НЕ НАЙДЕН — пункты 1-4 пропустятся)"}')
    print()

    if desktop.is_dir():
        print('— Desktop —')
        fix_requirements(desktop)
        fix_spec(desktop)
        fix_server_py(desktop)
        fix_compare_digest(desktop)
        print()

    print('— Сайт —')
    fix_app_routes(site)
    fix_env_example(site)
    fix_gitignore(site)
    remove_api = fix_vercel_json(site)
    fix_hygiene(site, remove_api_bundle=remove_api)
    fix_cabinet_stubs(site)
    fix_readme_vercel(site)
    print()

    print('— Проверка полных файлов из поставки —')
    must = [
        (desktop / 'parser_2gis' / 'web' / 'ai_agent.py', 'desktop ai_agent.py (прокси Fracs AI, CSP, лимиты)'),
        (desktop / 'parser_2gis' / 'web' / 'static' / 'index.html', 'desktop index.html (esc, без логов в чате)'),
        (desktop / 'parser_2gis' / 'license.py', 'desktop license.py'),
        (site / 'server' / 'bot.ts', 'сайт bot.ts (подтверждение входа)'),
        (site / 'server' / 'config.ts', 'сайт config.ts (openrouterApiKey, тарифы)'),
    ]
    for p, label in must:
        (ok if p.is_file() else fail)(f'{label}: {"на месте" if p.is_file() else "НЕТ — скопируйте из поставки fracs-fixes-v2.zip"}')

    print()
    print('Итог: OK=%d SKIP=%d FAIL=%d' % (
        sum(1 for r in REPORT if r.startswith('  OK')),
        sum(1 for r in REPORT if r.startswith('  SKIP')),
        sum(1 for r in REPORT if r.startswith('  FAIL'))))
    print('FAIL-пункты поправьте вручную — выше есть точные образцы «до/после».')


if __name__ == '__main__':
    main()
