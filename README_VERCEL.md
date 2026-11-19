# Fracs на Vercel: что изменилось

Архив — это **накладка на ваш проект**: распакуйте в корень репозитория с заменой файлов. Лендинг (`src/`, `index.html`, `vite.config.ts`, `tsconfig.json`) не тронут.

## Удалите из репозитория
- `server.ts` в корне (его заменил `dev-server.ts`, иначе Vercel может принять его за Express-приложение)
- `bun.lock` (в нём нет `@supabase/supabase-js`; Vercel сам создаст lock при установке) и, если есть, `data/`

## Порядок запуска
1. Supabase → SQL Editor → вставить `supabase/schema.sql` → Run.
2. Vercel → Environment Variables → значения из `.env.example`.
3. Deploy.
4. Зарегистрировать webhook бота (ссылка/команда из ответа) и проверить `APP_URL/api/health` → `{"ok":true,"db":true}`.
5. cron-job.org: GET `APP_URL/api/cron/cleanup`, раз в сутки, заголовок `Authorization: Bearer <CRON_SECRET>`.

### Telegram-поиск

Telegram-парсер разворачивается отдельной Python-функцией `/api/tg` в этом же Vercel-проекте. Для включения поиска добавьте в Environment Variables `TG_PROVIDER=http`, `TG_PARSER_KEY`, `TG_API_ID`, `TG_API_HASH` и `TG_SESSION_STRING`, затем сделайте Redeploy. Получить `TG_API_ID` и `TG_API_HASH` можно на `my.telegram.org`; `TG_SESSION_STRING` сгенерируйте один раз локально скриптом `scripts/gen-tg-session.py`. `TG_PARSER_URL` задавать не нужно.

### Пробный поиск

Новый пользователь может получить реальные результаты один раз по картам (на вкладке «Демо») и один раз — в Telegram. Пробный Maps-поиск выполняет тот же Chrome-парсер, что и программа, на отдельном Docker-worker; первый успешный результат показывается полностью. Пустой результат не расходует пробный доступ. После успешного поиска следующие запуски демо показывают вымышленные компании с блюром. Для уже работающего Supabase-проекта выполните SQL из `supabase/trial_usage.sql`; для новой базы таблица создаётся через `supabase/schema.sql`.

#### Запуск Chrome-worker на VPS

Worker должен быть постоянно запущен отдельно от Vercel: Vercel только создаёт задачу и получает её состояние, Chrome работает в контейнере. На VPS с Docker из корня репозитория:

```sh
docker build -f desktop/Dockerfile.worker -t fracs-maps-worker .
docker run -d --name fracs-maps-worker --restart unless-stopped \
  -p 127.0.0.1:8086:8080 \
  -e MAPS_WORKER_TOKEN='<длинный случайный секрет>' \
  fracs-maps-worker
```

Настройте HTTPS reverse proxy на домене VPS к `127.0.0.1:8086`; не публикуйте порт worker напрямую без TLS. В Vercel → Environment Variables задайте `MAPS_WORKER_URL=https://<домен-worker>` и такой же `MAPS_WORKER_TOKEN`, затем выполните Redeploy. Worker хранит состояние незавершённых задач в памяти контейнера, поэтому не перезапускайте его во время пробного парсинга.

Выбор городов ограничен тремя и проверяется также сервером. Для активной подписки новый запуск парсера карт (сайт или программа) разрешён раз в 6 часов; Telegram-поиск этим интервалом не ограничивается.

## Важно
- Функция `api/index.js` — готовый бандл серверного кода. После любых правок в `server/` выполните `npm run build:api` и закоммитьте обновлённый `api/index.js`.
- Локально: `npm run dev` (нужны SUPABASE_*; бот работает через polling).
