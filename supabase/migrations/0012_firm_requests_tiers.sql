-- 0012: size tiers + self-serve firm requests with admin approval.
--
-- Pricing is per firm, by size: small (1-4 accounts), mid (5-10), large (11+).
-- The platform admin assigns each firm's tier; Checkout charges that tier's
-- Stripe price. (Replaces the monthly/annual `plan` column from 0008, which no
-- firm ever used.)
--
-- Onboarding: a new user with no firm submits a request (firm name + every
-- account email). The admin approves it (choosing the tier) or declines it.
-- Approval creates the firm (status 'trial' until its first payment), makes
-- the requester its billing contact, and records the approved emails. People
-- on that list are attached to the firm automatically once their email
-- address is CONFIRMED (now, or when they sign up / confirm later).

-- ---------------------------------------------------------------------------
-- Tiers
-- ---------------------------------------------------------------------------
alter table public.firms
  add column if not exists tier text check (tier in ('small', 'mid', 'large'));
alter table public.firms drop column if exists plan;

-- ---------------------------------------------------------------------------
-- Approved account emails per firm (admin-only)
-- ---------------------------------------------------------------------------
create table if not exists public.firm_approved_emails (
  email      text primary key
               check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists firm_approved_emails_firm_idx
  on public.firm_approved_emails (firm_id);

alter table public.firm_approved_emails enable row level security;
revoke all on public.firm_approved_emails from anon;
revoke truncate, trigger, references on public.firm_approved_emails from authenticated;
grant select, insert, update, delete on public.firm_approved_emails to authenticated;

drop policy if exists firm_approved_emails_admin on public.firm_approved_emails;
create policy firm_approved_emails_admin on public.firm_approved_emails
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Firm requests
-- ---------------------------------------------------------------------------
create table if not exists public.firm_requests (
  id              uuid primary key default gen_random_uuid(),
  requester_id    uuid not null references auth.users(id) on delete cascade,
  requester_email text not null,
  firm_name       text not null check (char_length(btrim(firm_name)) between 1 and 120),
  member_emails   text[] not null check (cardinality(member_emails) between 1 and 100),
  message         text not null default '' check (char_length(message) <= 1000),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined')),
  firm_id         uuid references public.firms(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
-- One open request per person.
create unique index if not exists firm_requests_one_pending
  on public.firm_requests (requester_id) where status = 'pending';

alter table public.firm_requests enable row level security;
revoke all on public.firm_requests from anon;
revoke truncate, trigger, references on public.firm_requests from authenticated;
-- Writes go through the functions below (security definer); members may only
-- read and withdraw their own pending request.
revoke insert, update on public.firm_requests from authenticated;
grant select, delete on public.firm_requests to authenticated;

drop policy if exists firm_requests_select on public.firm_requests;
create policy firm_requests_select on public.firm_requests
  for select to authenticated
  using (requester_id = (select auth.uid()) or public.is_platform_admin());

drop policy if exists firm_requests_withdraw on public.firm_requests;
create policy firm_requests_withdraw on public.firm_requests
  for delete to authenticated
  using (requester_id = (select auth.uid()) and status = 'pending');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Lower-cased, trimmed, de-duplicated, validated email list. Raises on a bad one.
create or replace function public.normalize_email_list(p_emails text[])
returns text[]
language plpgsql immutable set search_path = public as $$
declare
  out_emails text[];
  bad text;
begin
  select coalesce(array_agg(distinct e order by e), '{}') into out_emails
  from (
    select lower(btrim(x)) as e
    from unnest(coalesce(p_emails, '{}')) as x
    where btrim(coalesce(x, '')) <> ''
  ) s;
  select e into bad from unnest(out_emails) as e
  where e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  limit 1;
  if bad is not null then
    raise exception 'This doesn''t look like an email address: %', bad
      using errcode = '22023';
  end if;
  return out_emails;
end;
$$;

-- First email in the list already tied to a firm other than p_firm (null = any).
create or replace function public.email_taken_elsewhere(p_emails text[], p_firm uuid)
returns text
language sql stable security definer set search_path = public as $$
  select e from unnest(p_emails) as e
  where exists (
          select 1 from public.firm_approved_emails a
          where a.email = e and a.firm_id is distinct from p_firm)
     or exists (
          select 1 from public.profiles p
          where lower(btrim(p.email)) = e
            and p.firm_id is not null and p.firm_id is distinct from p_firm)
  limit 1
$$;

-- Attach confirmed, firm-less members whose email is on p_firm's approved list.
create or replace function public.attach_approved_members(p_firm uuid)
returns void
language sql security definer set search_path = public as $$
  update public.profiles p
  set firm_id = a.firm_id
  from public.firm_approved_emails a, auth.users u
  where a.firm_id = p_firm
    and lower(btrim(p.email)) = a.email
    and p.firm_id is null
    and p.role = 'member'
    and u.id = p.id
    and u.email_confirmed_at is not null
$$;

-- ---------------------------------------------------------------------------
-- Member-facing: submit a request
-- ---------------------------------------------------------------------------
create or replace function public.submit_firm_request(
  p_firm_name text,
  p_emails    text[],
  p_message   text default ''
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  my_firm uuid;
  my_email text;
  emails text[];
  rid uuid;
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select firm_id, lower(btrim(email)) into my_firm, my_email
  from public.profiles where id = uid;
  if not found then
    raise exception 'Your account isn''t set up yet.' using errcode = '42501';
  end if;
  if my_firm is not null then
    raise exception 'Your account already belongs to a firm.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_firm_name, ''))) not between 1 and 120 then
    raise exception 'Enter your firm''s name (up to 120 characters).' using errcode = '22023';
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'Keep the note under 1,000 characters.' using errcode = '22023';
  end if;
  -- The requester is always one of the accounts.
  emails := public.normalize_email_list(coalesce(p_emails, '{}') || my_email);
  if cardinality(emails) > 100 then
    raise exception 'That''s more than 100 accounts. Email us and we''ll set you up directly.'
      using errcode = '22023';
  end if;
  begin
    insert into public.firm_requests (requester_id, requester_email, firm_name, member_emails, message)
    values (uid, my_email, btrim(p_firm_name), emails, coalesce(p_message, ''))
    returning id into rid;
  exception when unique_violation then
    raise exception 'You already have a request waiting for review.' using errcode = '23505';
  end;
  return rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: approve / decline / edit a firm's approved emails
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_firm_request(
  p_request   uuid,
  p_tier      text,
  p_firm_name text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.firm_requests;
  fid uuid;
  taken text;
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if p_tier is null or p_tier not in ('small', 'mid', 'large') then
    raise exception 'Pick a plan size.' using errcode = '22023';
  end if;
  select * into r from public.firm_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'That request isn''t pending any more.' using errcode = '22023';
  end if;
  taken := public.email_taken_elsewhere(r.member_emails, null);
  if taken is not null then
    raise exception '% already belongs to another firm. Remove it from that firm first, or decline this request.', taken
      using errcode = '23505';
  end if;

  insert into public.firms (name, tier, billing_email, subscription_status)
  values (coalesce(nullif(btrim(p_firm_name), ''), r.firm_name), p_tier, r.requester_email, 'trial')
  returning id into fid;

  insert into public.firm_approved_emails (email, firm_id)
  select e, fid from unnest(r.member_emails) as e;

  -- The requester proved they own their sign-in; attach them even if their
  -- address isn't confirmed (they're also the billing contact).
  update public.profiles set firm_id = fid
  where id = r.requester_id and firm_id is null;
  perform public.attach_approved_members(fid);

  update public.firm_requests
  set status = 'approved', firm_id = fid, decided_at = now()
  where id = r.id;
  return fid;
end;
$$;

create or replace function public.admin_decline_firm_request(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  update public.firm_requests
  set status = 'declined', decided_at = now()
  where id = p_request and status = 'pending';
  if not found then
    raise exception 'That request isn''t pending any more.' using errcode = '22023';
  end if;
end;
$$;

-- Replace a firm's approved-email list (doesn't remove existing members —
-- detach people in the Users table). Newly listed, confirmed sign-ups are
-- attached straight away.
create or replace function public.admin_set_firm_emails(p_firm uuid, p_emails text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  emails text[];
  taken text;
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.firms where id = p_firm) then
    raise exception 'Firm not found.' using errcode = '22023';
  end if;
  emails := public.normalize_email_list(p_emails);
  taken := public.email_taken_elsewhere(emails, p_firm);
  if taken is not null then
    raise exception '% already belongs to another firm.', taken using errcode = '23505';
  end if;
  delete from public.firm_approved_emails
  where firm_id = p_firm and email <> all (emails);
  insert into public.firm_approved_emails (email, firm_id)
  select e, p_firm from unnest(emails) as e
  on conflict (email) do nothing;
  perform public.attach_approved_members(p_firm);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up / email confirmation → attach to an approved firm
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, firm_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    -- Only a CONFIRMED address may claim a seat on an approved list.
    case when new.email_confirmed_at is not null then
      (select a.firm_id from public.firm_approved_emails a
       where a.email = lower(btrim(coalesce(new.email, ''))))
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p
  set firm_id = a.firm_id
  from public.firm_approved_emails a
  where p.id = new.id
    and p.firm_id is null
    and p.role = 'member'
    and a.email = lower(btrim(coalesce(new.email, '')));
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.normalize_email_list(text[])           from public, anon;
revoke execute on function public.email_taken_elsewhere(text[], uuid)     from public, anon, authenticated;
revoke execute on function public.attach_approved_members(uuid)           from public, anon, authenticated;
revoke execute on function public.handle_user_confirmed()                 from public, anon, authenticated;
revoke execute on function public.handle_new_user()                       from public, anon, authenticated;
revoke execute on function public.submit_firm_request(text, text[], text) from public, anon;
revoke execute on function public.admin_approve_firm_request(uuid, text, text) from public, anon;
revoke execute on function public.admin_decline_firm_request(uuid)        from public, anon;
revoke execute on function public.admin_set_firm_emails(uuid, text[])     from public, anon;
grant  execute on function public.submit_firm_request(text, text[], text) to authenticated;
grant  execute on function public.admin_approve_firm_request(uuid, text, text) to authenticated;
grant  execute on function public.admin_decline_firm_request(uuid)        to authenticated;
grant  execute on function public.admin_set_firm_emails(uuid, text[])     to authenticated;
grant  execute on function public.normalize_email_list(text[])           to authenticated;
