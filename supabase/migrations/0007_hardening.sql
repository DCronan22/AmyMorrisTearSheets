-- 0007: clear the Supabase security/performance advisor warnings.
-- Safe to re-run. Changes no data and no behaviour for signed-in users.

-- Pin the search_path so the trigger can't be pointed at a look-alike function.
alter function public.touch_updated_at() set search_path = public;

-- Trigger/event-trigger functions are never meant to be called over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Admin/style RPCs need a signed-in user anyway (they check internally), so
-- logged-out visitors don't need to be able to call them at all.
revoke execute on function public.admin_delete_user(uuid) from public, anon;
revoke execute on function public.set_firm_style(jsonb) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.set_firm_style(jsonb) to authenticated;

-- Evaluate auth.uid() once per query instead of once per row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = (select auth.uid()) or public.is_platform_admin());
