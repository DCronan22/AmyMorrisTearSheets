-- 0008: Stripe billing.
--
-- Each firm is either billed MANUALLY (invoice / prepaid, the admin flips
-- subscription_status by hand, exactly as before) or through STRIPE (the
-- webhook at /api/stripe-webhook keeps subscription_status and renewal_date in
-- step with the Stripe subscription). Existing firms default to 'manual', so
-- nothing changes for them until the admin opts a firm in.
--
-- Only the service role (the serverless functions) writes the stripe_* columns;
-- the firms_admin_update policy already stops members writing any firm column.

alter table public.firms
  add column if not exists billing_mode text not null default 'manual'
    check (billing_mode in ('manual', 'stripe')),
  -- The one member allowed to subscribe / open the billing portal, and the
  -- address Stripe sends receipts to.
  add column if not exists billing_email text not null default '',
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  -- Stripe's own status ('active', 'past_due', ...), shown in the admin panel.
  add column if not exists stripe_status text,
  add column if not exists plan text check (plan in ('monthly', 'annual')),
  add column if not exists cancel_at_period_end boolean not null default false;

-- Webhook idempotency: Stripe retries deliveries, so remember what was handled.
-- RLS on with no policies = only the service role can touch it.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
