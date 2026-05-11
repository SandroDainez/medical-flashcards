-- Run this SQL in Supabase SQL Editor.
-- It creates auth-linked profiles, per-user cards, per-user stats,
-- and RLS policies for user/admin management.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  cat text not null,
  q text not null,
  a text not null,
  hint text,
  exp text,
  interval int not null default 0,
  repetition int not null default 0,
  ease_factor numeric not null default 2.5,
  due_date date not null default current_date,
  created_at timestamptz not null default now(),
  review_count int not null default 0,
  status text not null default 'new'
);

create table if not exists public.user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  total_reviews int not null default 0,
  correct_reviews int not null default 0,
  days_studied jsonb not null default '{}'::jsonb,
  streak int not null default 0,
  last_studied date,
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'user',
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.user_stats enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles for select
using (
  id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  )
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles for update
using (
  id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  )
)
with check (
  id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  )
);

drop policy if exists "cards_owner_all" on public.cards;
create policy "cards_owner_all"
on public.cards for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "user_stats_owner_all" on public.user_stats;
create policy "user_stats_owner_all"
on public.user_stats for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Bootstrap first admin manually after creating your account:
-- update public.profiles
-- set role = 'admin', status = 'active'
-- where email = 'SEU_EMAIL_ADMIN';
