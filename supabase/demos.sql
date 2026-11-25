-- Демо-страницы (видеообзор по QR). Выполните один раз в Supabase → SQL Editor.
create table if not exists public.demos (
  id text primary key,
  user_id text not null,
  size int not null default 0,
  html text not null,
  created_at timestamptz not null default now()
);
create index if not exists demos_user_created on public.demos (user_id, created_at desc);
alter table public.demos enable row level security;   -- доступ только у service_role (сервер)
