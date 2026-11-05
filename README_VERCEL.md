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

## Важно
- Функция `api/index.js` — готовый бандл серверного кода. После любых правок в `server/` выполните `npm run build:api` и закоммитьте обновлённый `api/index.js`.
- Локально: `npm run dev` (нужны SUPABASE_*; бот работает через polling).
- Поиск 2ГИС теперь грузит страницы по 5 параллельно, чтобы уложиться в лимит времени функции (60 с).
