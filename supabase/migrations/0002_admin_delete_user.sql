-- Lets a platform admin remove a user account from the app.
--
-- NOTE: On hosted Supabase the `postgres` role cannot delete rows from the
-- internal `auth.users` table, so we delete the user's PROFILE instead. Removing
-- the profile revokes all access: the person is detached from every firm and,
-- without a profile, can no longer load any data (they'd see the "account
-- pending setup" screen). They also disappear from the admin Users list.
--
-- (If you later want to fully delete the underlying login/email too, that
-- requires a Supabase Edge Function using the service_role key — see SETUP.md.)
--
-- This function is SECURITY DEFINER (runs as its owner) and guards that only a
-- platform admin can call it, and that you can't delete your own account.
--
-- Run this in the Supabase SQL editor after 0001_init.sql. Safe to re-run.

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
  delete from public.profiles where id = target;
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;
