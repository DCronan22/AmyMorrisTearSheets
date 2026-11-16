-- 0013: annual billing + per-email approval.
--
-- Tiers are now small 1-5 / mid 6-10 / large 11-20 accounts (21+ is quoted by
-- hand). The tier check constraint is unchanged; the ranges live in the app.
--
-- Billing interval: a firm pays monthly or annually. The webhook records which
-- one its Stripe subscription uses, for display. null = not billed via Stripe.
--
-- Approval: the admin can approve a request for only some of its emails. The
-- requester is always included. Approved emails join the firm automatically
-- once the address is confirmed (unchanged from 0012).

alter table public.firms
  add column if not exists billing_interval text
    check (billing_interval in ('month', 'year'));

-- Replace the 3-argument approve with one that takes the approved emails.
drop function if exists public.admin_approve_firm_request(uuid, text, text);

create or replace function public.admin_approve_firm_request(
  p_request   uuid,
  p_tier      text,
  p_firm_name text   default null,
  p_emails    text[] default null  -- null = every email on the request
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.firm_requests;
  fid uuid;
  taken text;
  approved text[];
  stray text;
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

  if p_emails is null then
    approved := r.member_emails;
  else
    approved := public.normalize_email_list(p_emails || r.requester_email);
    -- Only emails the firm asked for; extra people are added on the firm later.
    select e into stray from unnest(approved) as e
    where e <> all (r.member_emails) limit 1;
    if stray is not null then
      raise exception '% wasn''t on this request.', stray using errcode = '22023';
    end if;
  end if;

  taken := public.email_taken_elsewhere(approved, null);
  if taken is not null then
    raise exception '% already belongs to another firm. Remove it from that firm first, or leave it unticked.', taken
      using errcode = '23505';
  end if;

  insert into public.firms (name, tier, billing_email, subscription_status)
  values (coalesce(nullif(btrim(p_firm_name), ''), r.firm_name), p_tier, r.requester_email, 'trial')
  returning id into fid;

  insert into public.firm_approved_emails (email, firm_id)
  select e, fid from unnest(approved) as e;

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

revoke execute on function public.admin_approve_firm_request(uuid, text, text, text[]) from public, anon;
grant  execute on function public.admin_approve_firm_request(uuid, text, text, text[]) to authenticated;
