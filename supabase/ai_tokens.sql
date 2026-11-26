-- Баланс купленных токенов Fracs AI (пакеты — разовая покупка поверх подписки Ultra).
-- Выполните один раз в Supabase → SQL Editor.
create table if not exists public.ai_tokens (
  user_id text primary key,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.ai_tokens enable row level security;   -- доступ только у service_role (сервер)

-- Зачислить пакет (upsert: строки может ещё не быть).
create or replace function public.ai_tokens_add(p_user text, p_tokens bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_tokens (user_id, balance, updated_at)
  values (p_user, greatest(0, p_tokens), now())
  on conflict (user_id) do update
    set balance   = public.ai_tokens.balance + greatest(0, excluded.balance),
        updated_at = now();
$$;
revoke all on function public.ai_tokens_add(text, bigint) from public, anon, authenticated;

-- Списать расход сверх дневной квоты (не уходит в минус).
create or replace function public.ai_tokens_spend(p_user text, p_tokens bigint)
returns void language sql security definer set search_path = public as $$
  update public.ai_tokens
  set balance = greatest(0, balance - greatest(0, p_tokens)),
      updated_at = now()
  where user_id = p_user;
$$;
revoke all on function public.ai_tokens_spend(text, bigint) from public, anon, authenticated;
