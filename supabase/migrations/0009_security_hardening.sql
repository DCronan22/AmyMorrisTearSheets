-- 0009_security_hardening.sql
-- Database security hardening (ops findings DB-2..DB-5). Run once in the
-- Supabase SQL editor. Idempotent — safe to re-run.
--
-- Safe to apply BEFORE the matching frontend deploy: it changes no column the
-- current app reads and only removes access that logged-out visitors never
-- needed (the app makes no table/RPC calls until a user is signed in).
-- The firms.notes column itself is dropped later, in 0011, once the new
-- frontend (which no longer selects it) is live.
--
-- Does NOT touch: the public item-images bucket setting, storage grants, or the
-- billing columns / stripe_events table added by 0008.

-- ---------------------------------------------------------------------------
-- DB-3a: every RLS policy on public tables applies TO authenticated only.
-- Policies were created without a TO clause (= PUBLIC, which includes anon).
-- Enumerated from pg_policies so new tables can't be missed.
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      -- Only the TO-clause-less ones; a later policy deliberately scoped to
      -- service_role/anon must not be widened if this file is re-run.
      and roles = array['public']::name[]
  loop
    execute format('alter policy %I on %I.%I to authenticated',
                   p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- DB-5: item_images_select also requires an active firm (insert/delete already
-- do). Platform admins keep read access to every folder. Public-URL reads of
-- the public bucket don't go through this policy, so image display is
-- unaffected.
-- ---------------------------------------------------------------------------
drop policy if exists item_images_select on storage.objects;
create policy item_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-images'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = public.current_firm_id()::text
        and public.firm_is_active(public.current_firm_id())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- DB-3b: the SECURITY DEFINER RLS helpers are not callable by logged-out
-- visitors. Signed-in users must keep EXECUTE: every RLS policy calls them.
-- ---------------------------------------------------------------------------
revoke execute on function public.current_firm_id()     from public, anon;
revoke execute on function public.is_platform_admin()   from public, anon;
revoke execute on function public.firm_is_active(uuid)  from public, anon;
grant  execute on function public.current_firm_id()     to authenticated, service_role;
grant  execute on function public.is_platform_admin()   to authenticated, service_role;
grant  execute on function public.firm_is_active(uuid)  to authenticated, service_role;

-- Trigger-only function: never called over the API (EXECUTE is checked when a
-- trigger is created, not when it fires).
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DB-4: least-privilege table grants.
-- anon (logged-out visitors) gets nothing on public tables/sequences;
-- authenticated keeps select/insert/update/delete (RLS still decides rows)
-- but loses TRUNCATE (which bypasses RLS), TRIGGER and REFERENCES.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- Same rules for objects created in future migrations (tables are created by
-- postgres here). Functions created by postgres stop being executable by
-- PUBLIC/anon by default; authenticated + service_role still get EXECUTE via
-- the schema-level default.
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from authenticated;
-- NOTE: this one is global. Functions postgres creates in schemas OTHER than
-- public get no EXECUTE for anyone but postgres, so future migrations must
-- `grant execute on function <schema>.<fn>(...) to authenticated;` explicitly
-- (e.g. a helper in a private schema used by RLS).
alter default privileges for role postgres revoke execute on functions from public;

-- supabase_admin also has default ACLs on public, but only a superuser /
-- member of supabase_admin can change them. The postgres role normally can't;
-- skip quietly rather than failing the migration (objects in this project are
-- created by postgres, so the defaults above are the ones that matter).
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke truncate, trigger, references on tables from authenticated';
exception when insufficient_privilege then
  raise notice 'Skipped supabase_admin default privileges (not permitted for %)', current_user;
end
$$;

-- ---------------------------------------------------------------------------
-- DB-2: private admin notes move out of the member-readable firms row into a
-- platform-admin-only table.
-- ---------------------------------------------------------------------------
create table if not exists public.firm_admin_notes (
  firm_id    uuid primary key references public.firms(id) on delete cascade,
  notes      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.firm_admin_notes enable row level security;

revoke all on public.firm_admin_notes from anon;
revoke truncate, trigger, references on public.firm_admin_notes from authenticated;
grant select, insert, update, delete on public.firm_admin_notes to authenticated;

drop policy if exists firm_admin_notes_select on public.firm_admin_notes;
create policy firm_admin_notes_select on public.firm_admin_notes
  for select to authenticated using (public.is_platform_admin());

drop policy if exists firm_admin_notes_insert on public.firm_admin_notes;
create policy firm_admin_notes_insert on public.firm_admin_notes
  for insert to authenticated with check (public.is_platform_admin());

drop policy if exists firm_admin_notes_update on public.firm_admin_notes;
create policy firm_admin_notes_update on public.firm_admin_notes
  for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists firm_admin_notes_delete on public.firm_admin_notes;
create policy firm_admin_notes_delete on public.firm_admin_notes
  for delete to authenticated using (public.is_platform_admin());

-- Keep updated_at fresh on every write (shared trigger fn from 0001). Run as
-- the migration owner, so the EXECUTE revoke above doesn't affect it.
drop trigger if exists firm_admin_notes_touch_updated_at on public.firm_admin_notes;
create trigger firm_admin_notes_touch_updated_at
  before update on public.firm_admin_notes
  for each row execute function public.touch_updated_at();

-- Copy existing notes across, then blank them on firms so members can't read
-- them through `firms` even before 0011 drops the column. Guarded so a re-run
-- never overwrites a note edited in the new table, and a firm's note is only
-- blanked once an identical copy exists. The `notes` column check lets this
-- file still re-run cleanly after 0011.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firms' and column_name = 'notes'
  ) then
    insert into public.firm_admin_notes (firm_id, notes)
    select id, notes from public.firms
    where coalesce(notes, '') <> ''
    on conflict (firm_id) do nothing;

    update public.firms f
    set notes = ''
    where coalesce(f.notes, '') <> ''
      and exists (
        select 1 from public.firm_admin_notes n
        where n.firm_id = f.id and n.notes = f.notes
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- API-7 (database side): admin_delete_user also refuses to remove another
-- platform admin, matching /api/delete-user. Same signature + grants as 0007.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can delete users.';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;
  if exists (select 1 from public.profiles where id = target and role = 'platform_admin') then
    raise exception 'Platform admin accounts cannot be deleted here.';
  end if;
  delete from public.profiles where id = target;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant  execute on function public.admin_delete_user(uuid) to authenticated;
