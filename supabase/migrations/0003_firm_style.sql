-- Tear Sheets — per-firm export style (branding).
--
-- Adds a nullable `style` jsonb column to firms (null = "not configured yet",
-- which triggers the optional first-run setup prompt in the app) and a
-- SECURITY DEFINER RPC that lets a firm's own members edit ONLY their style —
-- never name, subscription_status, renewal_date, etc. (those stay platform-admin
-- only via the existing firms_admin_update policy). Mirrors the admin_delete_user
-- RPC pattern from migration 0002.
--
-- Run this once in the Supabase SQL editor against the existing project.

alter table public.firms add column if not exists style jsonb;

-- Set the calling user's OWN firm's style. The column-narrow, row-narrow surface
-- of this function is the security boundary: it can only ever write `style`, and
-- only on the caller's firm (resolved server-side via current_firm_id()).
create or replace function public.set_firm_style(new_style jsonb)
returns public.firms
language plpgsql security definer set search_path = public as $$
declare
  fid uuid;
  result public.firms;
begin
  -- The payload comes straight from the browser, so bound it: it must be a
  -- JSON object and small enough that nobody can stuff megabytes into the
  -- firms row (the inline logo data URL is the only big field; a compressed
  -- 480px logo stays well under this cap).
  if new_style is null or jsonb_typeof(new_style) <> 'object' then
    raise exception 'Style must be a JSON object';
  end if;
  if length(new_style::text) > 1200000 then
    raise exception 'Style is too large — try a smaller logo image';
  end if;
  fid := public.current_firm_id();
  if fid is null then
    raise exception 'No firm for current user';
  end if;
  -- Members may only edit while their firm is active; a platform_admin always may.
  if not public.firm_is_active(fid) and not public.is_platform_admin() then
    raise exception 'Firm is not active';
  end if;
  update public.firms set style = new_style where id = fid
    returning * into result;
  return result;
end;
$$;

revoke all on function public.set_firm_style(jsonb) from public;
grant execute on function public.set_firm_style(jsonb) to authenticated;
