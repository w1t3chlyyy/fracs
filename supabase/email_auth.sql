-- Fracs: вход по email-коду (OTP через Supabase Auth).
-- Вставьте целиком в SQL Editor и нажмите Run. Повторный запуск безопасен.
--
-- Что делает:
--  1. Разрешает пользователя без Telegram (tg_id становится nullable):
--     аккаунт, созданный входом по коду с почты, хранится в той же таблице users.
--  2. Добавляет колонку email с уникальным индексом — по ней находим/создаём
--     пользователя при подтверждении кода.

alter table public.users alter column tg_id drop not null;
alter table public.users add column if not exists email text;

-- Уникальность email (NULL допускается и не конфликтует: у TG-пользователей email = NULL).
create unique index if not exists users_email_key on public.users (email) where email is not null;
