-- 0010_api_rate_limit.sql
-- Shared rate limiting for the /api serverless functions (ops finding API-4).
-- The previous limiter lived in each warm function instance's memory, so the
-- limit multiplied with every instance Vercel spun up. This moves the counters
-- into Postgres so they hold across instances.
--
-- Idempotent — safe to re-run. Safe to apply before OR after the matching API
-- deploy: the API falls back to its in-memory limiter while public.api_consume
-- doesn't exist, and nothing else reads this table.
--
-- Access: only the server (service_role) may call public.api_consume. The
-- table has RLS on and NO policies, and anon/authenticated have no grants, so
-- it is invisible over the Data API to every signed-in or anonymous user.

create table if not exists public.api_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  firm_id    uuid,                       -- null for users without a firm
  endpoint   text not null,
  metered    boolean not null default false, -- counts toward the daily cap
  created_at timestamptz not null default now()
);

-- Per-user, per-endpoint per-minute window.
create index if not exists api_usage_user_endpoint_created_idx
  on public.api_usage (user_id, endpoint, created_at);
-- Per-firm (or per-user when firm is null) rolling-day window, metered only.
create index if not exists api_usage_subject_created_idx
  on public.api_usage ((coalesce(firm_id, user_id)), created_at)
  where metered;
-- Pruning.
create index if not exists api_usage_created_idx
  on public.api_usage (created_at);

alter table public.api_usage enable row level security;
-- Deliberately no policies.
revoke all on table public.api_usage from public, anon, authenticated;

-- Atomically check and record one API call.
--   p_per_minute: max calls by this user to this endpoint in the last minute.
--   p_per_day:    max METERED calls by this firm (or by this user when p_firm
--                 is null) across all endpoints in the last 24 hours; null =
--                 this call is not metered (e.g. platform admins, delete-user).
-- Returns 'ok' (call recorded), 'minute' or 'day' (limit hit, nothing recorded).
create or replace function public.api_consume(
  p_user       uuid,
  p_firm       uuid,
  p_endpoint   text,
  p_per_minute integer,
  p_per_day    integer
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subject uuid := coalesce(p_firm, p_user);
  v_count   integer;
begin
  if p_user is null or p_endpoint is null or p_per_minute is null or p_per_minute < 1 then
    raise exception 'api_consume: invalid arguments';
  end if;

  -- Serialize concurrent calls for the same firm/user so count-then-insert is
  -- atomic. Transaction-scoped: released on commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('api_consume:' || v_subject::text, 0)
  );

  select count(*) into v_count
  from public.api_usage
  where user_id = p_user
    and endpoint = p_endpoint
    and created_at > pg_catalog.now() - interval '1 minute';
  if v_count >= p_per_minute then
    return 'minute';
  end if;

  if p_per_day is not null then
    select count(*) into v_count
    from public.api_usage
    where metered
      and coalesce(firm_id, user_id) = v_subject
      and created_at > pg_catalog.now() - interval '1 day';
    if v_count >= p_per_day then
      return 'day';
    end if;
  end if;

  insert into public.api_usage (user_id, firm_id, endpoint, metered)
  values (p_user, p_firm, p_endpoint, p_per_day is not null);

  -- Cheap amortized pruning: ~1 call in 100 deletes rows older than 2 days
  -- (indexed on created_at). Nothing older than 24h is ever read.
  if pg_catalog.random() < 0.01 then
    delete from public.api_usage
    where created_at < pg_catalog.now() - interval '2 days';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.api_consume(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_consume(uuid, uuid, text, integer, integer)
  to service_role;
