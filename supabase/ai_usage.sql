-- Учёт расходов Fracs AI (прокси к OpenRouter). Выполните один раз в Supabase → SQL Editor.
create table if not exists public.ai_usage (
  day date not null,
  user_id text not null,
  requests int not null default 0,
  tokens bigint not null default 0,
  cost_usd numeric(12,5) not null default 0,
  primary key (day, user_id)
);
alter table public.ai_usage enable row level security;   -- доступ только у service_role (сервер)

create or replace function public.ai_usage_add(p_user text, p_tokens bigint, p_cost numeric)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage (day, user_id, requests, tokens, cost_usd)
  values ((now() at time zone 'utc')::date, p_user, 1, p_tokens, p_cost)
  on conflict (day, user_id) do update
    set requests = public.ai_usage.requests + 1,
        tokens   = public.ai_usage.tokens + excluded.tokens,
        cost_usd = public.ai_usage.cost_usd + excluded.cost_usd;
$$;
revoke all on function public.ai_usage_add(text, bigint, numeric) from public, anon, authenticated;
