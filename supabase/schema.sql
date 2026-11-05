-- Fracs: схема для Supabase. Вставьте целиком в SQL Editor и нажмите Run. Повторный запуск безопасен.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  tg_id bigint not null unique,
  username text,
  first_name text not null default 'Пользователь',
  created_at timestamptz not null default now(),
  subscription_until timestamptz,
  expiry_notified_for timestamptz
);

create table if not exists public.login_tokens (
  token text primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.users(id) on delete cascade
);

create table if not exists public.searches (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('maps', 'tg')),
  created_at timestamptz not null default now(),
  demo boolean not null default true,
  seed text not null,
  query jsonb not null default '{}',
  stats jsonb not null default '{}',
  rows_total int not null default 0,
  head jsonb,
  rows jsonb
);
create index if not exists searches_user_kind_created on public.searches (user_id, kind, created_at desc);

create table if not exists public.payments (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  plan_id text not null,
  amount_rub int not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'canceled')),
  provider text not null,
  provider_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_provider_id on public.payments (provider_id);

create table if not exists public.rate_limits (
  key text primary key,
  n int not null,
  reset_at timestamptz not null
);

-- Атомарный счётчик лимитов: true — можно, false — лимит исчерпан.
create or replace function public.rate_limit(p_key text, p_max int, p_window_ms int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  insert into rate_limits as r (key, n, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update set
    n = case when r.reset_at < now() then 1 else r.n + 1 end,
    reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_ms / 1000.0) else r.reset_at end
  returning n into v_n;
  return v_n <= p_max;
end $$;

-- Доступ только через service_role с сервера. RLS включён без политик: anon/authenticated ничего не видят.
alter table public.users enable row level security;
alter table public.login_tokens enable row level security;
alter table public.searches enable row level security;
alter table public.payments enable row level security;
alter table public.rate_limits enable row level security;

revoke all on function public.rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit(text, int, int) to service_role;
