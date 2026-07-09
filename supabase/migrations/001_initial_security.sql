-- BidSwift AI Supabase schema
-- Run this in the Supabase SQL editor or through the Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_name text not null check (char_length(trim(project_name)) between 1 and 200),
  file_name text,
  contract_value numeric(18, 2) not null default 0 check (contract_value >= 0),
  target_margin numeric(6, 2) not null default 0 check (target_margin >= 0 and target_margin <= 100),
  risk_score integer check (risk_score is null or (risk_score >= 0 and risk_score <= 100)),
  status text not null default 'completed' check (status in ('draft', 'running', 'completed', 'failed')),
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audits_user_created_idx on public.audits (user_id, created_at desc);
create index if not exists audits_analysis_gin_idx on public.audits using gin (analysis);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.audits enable row level security;
alter table public.audits force row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.audits to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = id);

drop policy if exists "audits_select_own" on public.audits;
create policy "audits_select_own"
  on public.audits
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "audits_insert_own" on public.audits;
create policy "audits_insert_own"
  on public.audits
  for insert
  to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "audits_update_own" on public.audits;
create policy "audits_update_own"
  on public.audits
  for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "audits_delete_own" on public.audits;
create policy "audits_delete_own"
  on public.audits
  for delete
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists audits_set_updated_at on public.audits;
create trigger audits_set_updated_at
  before update on public.audits
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();