# Fracs — применённые правки безопасности

Все исправленные файлы лежат в `fracs-patched/` с теми же путями, что в репозитории.
Перенесите их поверх рабочей копии (с заменой), удалите файлы из `DELETIONS.txt`,
затем закоммитьте и запушьте.

## Что сделано по пунктам ТЗ

### 2. server/app.ts (+ удалён корневой server.ts)
- Импорт `csrfGuard, limit, noStoreApi, securityHeaders` из `./security.ts`.
- Инлайн-блок заголовков заменён на `app.use(securityHeaders)`.
- Порядок маршрутов: `POST /api/bot/webhook` → `app.use('/api', noStoreApi, csrfGuard)`
  → лимиты на `/api/cities` и `/api/config` (60/60с) → `/api/app` (attachUser, appRouter)
  → `/api` (attachUser, api).
- `dev-server.ts` не тронут: он и так вызывает `buildApp()`, отдельных правок не нужно.
- Корневой `server.ts` удалён (как просит README_VERCEL).

### 3. server/config.ts — fail-fast в production
Вместо предупреждения теперь бросается `Error`, если в проде:
- отсутствуют `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
- `SESSION_SECRET` короче 32 символов;
- включён `ALLOW_DEV_LOGIN` или `ALLOW_MOCK_PAYMENTS`.
Секрет: `openssl rand -hex 32`.

### 4. server/auth.ts — разделение назначений ключа
- `sign(p)` теперь подписывает с префиксом `'session:' + p`, поэтому подпись сессии
  нельзя переиспользовать как trial-ticket или лицензию.
- `cookies()` переписана: пропускает записи без `=`, оборачивает `decodeURIComponent`
  в try/catch (битая cookie не роняет запрос).
- `cookieOpts()`: `SameSite=None` только если HTTPS **и** явно задано
  `COOKIE_SAMESITE=None` (нужно для iframe AI Studio); иначе `Lax`. Возврат с ЮKassa
  (`/app?paid=1`) — обычная навигация, с Lax cookie доезжает.
- В routes.ts `signTrialTicket`/`verifyTrialTicket` подписывают с префиксом
  `'trial-ticket:'`.
- В appRoutes.ts ключ лицензии подписывается отдельным секретом
  `process.env.LICENSE_SECRET || config.sessionSecret` (префикс `'fracs-app-license:'`
  сохранён).
- Побочный эффект: после смены `sign` существующие сессии сбросятся — пользователям
  нужно войти заново.

### 5. server/routes.ts — whitelist для worker + ужесточение разбора
- Добавлены `num()`, `flag()` и `trialOptions(body)`: в Chrome-worker уходит только
  белый список filters/advanced с заданными границами, а не `req.body` как есть.
  В `/search/maps/trial/start` тело собирается через `...trialOptions(req.body)`.
- `parse2gisUrl`: длина ≤ 2000, только `https:`, без `username`/`password` в URL.
- Поисковый запрос городов обрезан: `String(req.query.q || '').slice(0, 40)`.
- `db.rateLimit` получил параметр `failClosed = false`; при сбое Supabase с
  `failClosed=true` возвращается «запретить». Включён для `auth:*` (auth.ts) и
  `app-verify:*` (appRoutes.ts), чтобы при падении БД не открывался перебор.

### 6. vercel.json — заголовки для статики
Добавлен блок `headers` для `source: "/(.*)"`: HSTS, X-Content-Type-Options,
X-Frame-Options DENY, Referrer-Policy, Permissions-Policy и
`Content-Security-Policy-Report-Only` (default-src 'self'; script-src 'self'
'wasm-unsafe-eval'; …; frame-ancestors 'none').

> CSP намеренно в режиме **Report-Only**: библиотека shaders (WebGL/WASM) может
> требовать больше разрешений. Откройте сайт, посмотрите консоль на нарушения,
> поправьте политику и только потом переименуйте заголовок в `Content-Security-Policy`.

### 7. desktop/parser_2gis/web/server.py
- `_worker_authorized` сравнивает байты: `hmac.compare_digest(supplied.encode(),
  f'Bearer {token}'.encode())` — не-ASCII в заголовке больше не даёт TypeError.
- Добавлен `before_request _local_guard`: пропускает только хосты 127.0.0.1/localhost
  (защита от DNS-rebinding); для не-GET/HEAD/OPTIONS проверяет Origin и
  `Sec-Fetch-Site` (защита от CSRF). `/api/internal/trial/*` пропускает — у них своя
  Bearer-авторизация (воркер за прокси).
- Добавлен `after_request _headers`: X-Content-Type-Options, X-Frame-Options DENY,
  Referrer-Policy no-referrer.
- На VPS пропускайте через reverse proxy только `/api/internal/trial/*`, остальное режьте.

### 8. Инъекции в экспорте
- **xlsx_writer.py**: оба `Workbook(...)` — `{'strings_to_urls': False,
  'strings_to_formulas': False}`.
- **csv_writer.py**: в `_writerow` текстовые поля `name, description, address,
  address_comment, rubrics` с первым символом `= + - @ \t \r` получают префикс `'`.
  Телефоны (с `+`) не трогаются.
- **html_writer.py**: добавлена `_safe_url()` (пропускает только `http(s)://` и
  `tg://`, иначе `#`); обёрнуты `c['whatsapp']`, `c['telegram']`, `c['instagram']`,
  `c['website']`, `r['url']` (через `esc(_safe_url(...))`).
- **web/static/index.html** (JS-дашборд): добавлена `safeUrl()`, обёрнуты `c.telegram`,
  `c.instagram`, `c.website`, `r.url` в `renderCard`. WhatsApp не обёрнут намеренно:
  его `href="#"`, а реальная ссылка строится из `digits(c.whatsapp)` через wa.me-хелпер,
  так что схему туда протолкнуть нельзя. (Файл содержит намеренные NUL-байты как
  разделители составных ключей — они сохранены.)
- **web/static/tg.js**: добавлена `safeUrl()`, обёрнут `r.link`.
- **src/cabinet/gis/lib.ts**: экспортирована `safeHref(u)` (http(s)/tg → строка,
  иначе `undefined`).
- **RecordCard.tsx**: `safeHref` применён к `c.telegram`, `c.instagram`, `c.website`,
  `r.url`.
- **ResultPanel.tsx**: `safeHref` применён к `r.url` (MapsItem) и `r.link` (TgItem),
  причём ссылка рендерится только если `safeHref(...)` вернул значение.

### 9. Удалено из public/assets/aistudio/
`app_8a6cf0b8.py`, `tg_a6dd18fd.py`, `tg_routes_b6a4b90d.py`,
`gen_session_ddb14f08.py`, `tg_1bd0e3d5.js`, `vercel_0cdefa91.json`.
Картинки `image_*.png` оставлены. В `public/` нет `.env`, бэкапов и `*.map`.

### 10. api/tg.py
`FastAPI(title='Fracs TG service', docs_url=None, redoc_url=None, openapi_url=None)` —
документация и OpenAPI-схема выключены.

## Проверка
- Все изменённые `.ts`/`.tsx` транспилируются без ошибок (esbuild).
- Все изменённые `.py` проходят `python -m py_compile`.
- `vercel.json` — валидный JSON.
- `tg.js` проходит `node --check`.

## После заливки в репозиторий не забудьте
1. Сгенерировать и проставить в env Vercel: `SESSION_SECRET` (`openssl rand -hex 32`),
   при желании отдельный `LICENSE_SECRET`, и (только если кабинет встраивается в
   iframe AI Studio) `COOKIE_SAMESITE=None`.
2. Пересобрать серверный бандл: `npm run build:api` и закоммитить обновлённый
   `api/index.js` (он — готовый бандл кода из `server/`, см. README_VERCEL).
3. Проверить CSP в консоли браузера и перевести заголовок из Report-Only в
   enforcing, когда нарушений не останется.
4. На VPS для desktop-воркера настроить reverse proxy только на `/api/internal/trial/*`.
