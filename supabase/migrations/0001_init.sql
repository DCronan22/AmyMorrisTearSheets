-- Tear Sheets SaaS — initial schema, multi-tenant with subscription gating.
--
-- Run this in the Supabase SQL editor (or via the Supabase CLI) once, against a
-- fresh project. It creates three tables (firms, profiles, projects), the
-- helper functions used by Row-Level Security, and the RLS policies that make
-- the subscription enforcement real (server-side, cannot be bypassed by the
-- client).
--
-- Model
--   firm      = one design company (the tenant / subscriber)
--   profile   = one app user, linked to a firm; role 'member' or 'platform_admin'
--   project   = a tear-sheet project belonging to a firm; its items are JSON
--
-- Access rules (enforced below)
--   * A member sees ONLY their firm's projects, and ONLY while the firm's
--     subscription_status = 'active'.
--   * A member can always read their OWN firm row (so the app can show a
--     friendly "subscription paused" screen when suspended).
--   * A platform_admin (you) can read every firm/profile and is the only role
--     allowed to change subscription_status / renewal_date / firm assignment.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.firms (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  subscription_status text not null default 'trial'
                        check (subscription_status in ('trial','active','suspended','canceled')),
  renewal_date        date,
  notes               text not null default '',
  created_at          timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  firm_id    uuid references public.firms(id) on delete set null,
  full_name  text not null default '',
  email      text not null default '',
  role       text not null default 'member' check (role in ('member','platform_admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  name       text not null default 'Untitled Project',
  client     text not null default '',
  location   text not null default '',
  date       date,
  logo_url   text not null default '',
  notes      text not null default '',
  items      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_firm_id_idx on public.projects (firm_id);
create index if not exists profiles_firm_id_idx on public.profiles (firm_id);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they bypass RLS on profiles/firms and
-- therefore never trigger recursive policy evaluation).
-- ---------------------------------------------------------------------------

create or replace function public.current_firm_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select firm_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'platform_admin' from public.profiles where id = auth.uid()),
    false
  )
$$;

create or replace function public.firm_is_active(fid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select subscription_status = 'active' from public.firms where id = fid),
    false
  )
$$;

-- Keep projects.updated_at fresh on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- Auto-create a profile row whenever a new auth user signs up. New users start
-- with no firm and role 'member'; a platform_admin then assigns them to a firm.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.firms    enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;

-- firms ---------------------------------------------------------------------
drop policy if exists firms_select on public.firms;
create policy firms_select on public.firms
  for select using (id = public.current_firm_id() or public.is_platform_admin());

drop policy if exists firms_admin_insert on public.firms;
create policy firms_admin_insert on public.firms
  for insert with check (public.is_platform_admin());

drop policy if exists firms_admin_update on public.firms;
create policy firms_admin_update on public.firms
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists firms_admin_delete on public.firms;
create policy firms_admin_delete on public.firms
  for delete using (public.is_platform_admin());

-- profiles ------------------------------------------------------------------
-- A user reads their own profile; platform_admin reads all. Only platform_admin
-- may modify profiles (assign firms, grant roles) — this prevents a member from
-- escalating their own role or jumping to another firm.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
  for insert with check (public.is_platform_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles
  for delete using (public.is_platform_admin());

-- projects ------------------------------------------------------------------
-- The heart of subscription enforcement: a member can touch their firm's
-- projects only while the firm is active. Platform admin can see everything.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (
    public.is_platform_admin()
    or (firm_id = public.current_firm_id() and public.firm_is_active(firm_id))
  );

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  ) with check (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );
