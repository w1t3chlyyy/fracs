-- One-time migration for existing Supabase projects.
create table if not exists public.trial_usage (
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('maps', 'tg')),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.trial_usage enable row level security;

insert into public.trial_usage (user_id, kind)
select distinct user_id, kind from public.searches where demo = false
on conflict (user_id, kind) do nothing;
