// Stripe billing core, shared by /api/billing-checkout, /api/billing-portal and
// /api/stripe-webhook.
//
// Model: one Stripe customer + one subscription per FIRM, priced by the firm's
// size TIER (small 1-4 accounts, mid 5-10, large 11+). The platform admin sets
// firms.tier; Checkout charges that tier's Stripe price. The webhook is the only thing that turns Stripe state
// into access: it writes firms.subscription_status, which RLS already enforces.
// Firms with billing_mode = 'manual' (invoiced / prepaid) are never touched by
// Stripe until a checkout for them completes.
//
// Server env (never VITE_-prefixed):
//   STRIPE_SECRET_KEY       sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET   whsec_… (from the webhook endpoint in Stripe)
//   STRIPE_PRICE_SMALL      price_… monthly price for the small tier (1-4)
//   STRIPE_PRICE_MID        price_… monthly price for the mid tier (5-10)
//   STRIPE_PRICE_LARGE      price_… monthly price for the large tier (11+)
//   STRIPE_PRICE_SETUP      price_… ONE-TIME setup fee, added to a firm's
//                           first checkout only (any tier)
//   APP_URL                 where Checkout/Portal send people back
//                           (defaults to https://sortedsheets.site)
//   SUPABASE_SERVICE_ROLE_KEY (already set for account deletion)
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase-admin.js";

export type Tier = "small" | "mid" | "large";
export const TIERS: readonly Tier[] = ["small", "mid", "large"];

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

type Result = { status: number; payload: unknown };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let stripe: Stripe | null = null;

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripe ??= new Stripe(key);
  return stripe;
}

const PRICE_ENV: Record<Tier, string> = {
  small: "STRIPE_PRICE_SMALL",
  mid: "STRIPE_PRICE_MID",
  large: "STRIPE_PRICE_LARGE",
};

/** The Stripe price a tier is charged (from env; never hardcoded). */
export function priceForTier(tier: Tier): string | undefined {
  return process.env[PRICE_ENV[tier]] || undefined;
}

/** The one-time setup fee price (from env). */
export function setupFeePrice(): string | undefined {
  return process.env.STRIPE_PRICE_SETUP || undefined;
}

/**
 * The setup fee is charged once, on a firm's first subscription. A firm that
 * has had a subscription before (stripe_subscription_id is kept after it
 * ends) re-subscribes without it.
 */
export function owesSetupFee(firm: { stripe_subscription_id: string | null }): boolean {
  return !firm.stripe_subscription_id;
}

/** Which tier a Stripe price belongs to, or null if it isn't one of ours. */
export function tierForPrice(priceId: string | undefined): Tier | null {
  if (!priceId) return null;
  return TIERS.find((t) => priceForTier(t) === priceId) ?? null;
}

function appUrl(): string {
  return (process.env.APP_URL || "https://sortedsheets.site").replace(
    /\/+$/,
    ""
  );
}

interface FirmBillingRow {
  id: string;
  name: string;
  billing_mode: "manual" | "stripe";
  billing_email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_status: string | null;
  tier: Tier | null;
}

const FIRM_COLS =
  "id, name, billing_mode, billing_email, stripe_customer_id, stripe_subscription_id, stripe_status, tier";

const notConfigured: Result = {
  status: 501,
  payload: { error: "Online billing isn't set up yet." },
};

/**
 * Which firm the caller may manage billing for. The platform admin may act for
 * any firm (body.firmId); a member only for their own firm, and only if they
 * are that firm's billing contact — so a junior designer can't cancel the
 * firm's plan.
 */
async function authorizedFirm(
  sb: SupabaseClient,
  userId: string,
  firmId: unknown
): Promise<{ firm: FirmBillingRow } | { error: Result }> {
  const { data: caller, error } = await sb
    .from("profiles")
    .select("role, firm_id, email")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    return { error: { status: 500, payload: { error: "Could not verify permissions." } } };
  }
  if (!caller) {
    return { error: { status: 403, payload: { error: "Your account isn't set up yet." } } };
  }
  const isAdmin = caller.role === "platform_admin";
  // Refuse outright rather than quietly substituting the caller's own firm.
  if (!isAdmin && firmId != null && firmId !== caller.firm_id) {
    return { error: { status: 403, payload: { error: "Not your firm." } } };
  }
  const target =
    isAdmin && typeof firmId === "string" && UUID_RE.test(firmId)
      ? firmId
      : caller.firm_id;
  if (!target) {
    return { error: { status: 400, payload: { error: "No firm selected." } } };
  }

  const { data: firm, error: firmErr } = await sb
    .from("firms")
    .select(FIRM_COLS)
    .eq("id", target)
    .maybeSingle();
  if (firmErr) {
    return { error: { status: 500, payload: { error: "Could not load the firm." } } };
  }
  if (!firm) {
    return { error: { status: 404, payload: { error: "Firm not found." } } };
  }
  const row = firm as FirmBillingRow;
  const isBillingContact =
    !!row.billing_email &&
    row.billing_email.trim().toLowerCase() ===
      String(caller.email ?? "").trim().toLowerCase();
  if (!isAdmin && !isBillingContact) {
    return {
      error: {
        status: 403,
        payload: {
          error: "Only your firm's billing contact can manage the subscription.",
        },
      },
    };
  }
  return { firm: row };
}

/** The firm's Stripe customer, created on first use. */
async function ensureCustomer(
  sb: SupabaseClient,
  st: Stripe,
  firm: FirmBillingRow
): Promise<string> {
  if (firm.stripe_customer_id) return firm.stripe_customer_id;
  const customer = await st.customers.create({
    name: firm.name,
    email: firm.billing_email || undefined,
    metadata: { firm_id: firm.id },
  });
  // Only claim the slot if it's still empty: two quick clicks must not leave
  // the firm pointing at whichever customer happened to be written last.
  const { data: claimed } = await sb
    .from("firms")
    .update({ stripe_customer_id: customer.id })
    .eq("id", firm.id)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id");
  if (claimed && claimed.length) return customer.id;
  const { data: again } = await sb
    .from("firms")
    .select("stripe_customer_id")
    .eq("id", firm.id)
    .single();
  return (again?.stripe_customer_id as string) ?? customer.id;
}

export interface CheckoutBody {
  firmId?: string;
}

/** Start a Stripe Checkout for the firm's subscription; returns its URL. */
export async function runCheckout(body: CheckoutBody, userId: string): Promise<Result> {
  const sb = adminClient();
  const st = stripeClient();
  if (!sb || !st) return notConfigured;

  const auth = await authorizedFirm(sb, userId, body.firmId);
  if ("error" in auth) return auth.error;
  const { firm } = auth;

  // The price comes only from the firm's tier, which only the admin can set,
  // so a client can never pick a cheaper plan than the one it was given.
  if (!isTier(firm.tier)) {
    return {
      status: 400,
      payload: {
        error: "This firm's plan size hasn't been set yet. Contact us and we'll set it up.",
      },
    };
  }
  const tier = firm.tier;
  const price = priceForTier(tier);
  if (!price) {
    return {
      status: 400,
      payload: { error: `The ${tier} plan isn't available yet.` },
    };
  }

  // One live subscription per firm: changes go through the billing portal.
  if (
    firm.stripe_subscription_id &&
    ["active", "trialing", "past_due"].includes(firm.stripe_status ?? "")
  ) {
    return {
      status: 409,
      payload: {
        error:
          "This firm already has a subscription. Use Manage billing to change it.",
      },
    };
  }

  // First subscription: the one-time setup fee goes on the first invoice.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price, quantity: 1 }];
  if (owesSetupFee(firm)) {
    const setup = setupFeePrice();
    if (!setup) {
      return { status: 400, payload: { error: "Online sign-up isn't available yet." } };
    }
    lineItems.push({ price: setup, quantity: 1 });
  }

  const customer = await ensureCustomer(sb, st, firm);
  const session = await st.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: lineItems,
    client_reference_id: firm.id,
    metadata: { firm_id: firm.id, tier },
    subscription_data: { metadata: { firm_id: firm.id, tier } },
    allow_promotion_codes: true,
    success_url: `${appUrl()}/?billing=success`,
    cancel_url: `${appUrl()}/?billing=canceled`,
  });
  if (!session.url) {
    return { status: 500, payload: { error: "Stripe didn't return a checkout link." } };
  }
  return { status: 200, payload: { url: session.url } };
}

export interface PortalBody {
  firmId?: string;
}

/** Open Stripe's customer portal (card, invoices, cancel); returns its URL. */
export async function runPortal(body: PortalBody, userId: string): Promise<Result> {
  const sb = adminClient();
  const st = stripeClient();
  if (!sb || !st) return notConfigured;

  const auth = await authorizedFirm(sb, userId, body.firmId);
  if ("error" in auth) return auth.error;
  const { firm } = auth;
  if (!firm.stripe_customer_id) {
    return {
      status: 400,
      payload: { error: "This firm isn't billed through Stripe yet." },
    };
  }
  const session = await st.billingPortal.sessions.create({
    customer: firm.stripe_customer_id,
    return_url: appUrl(),
  });
  return { status: 200, payload: { url: session.url } };
}

// ---------------------------------------------------------------------------
// Webhook → firm access
// ---------------------------------------------------------------------------

/**
 * Stripe status → app access. past_due keeps access while Stripe retries the
 * card (its own dunning emails go out meanwhile); once retries are exhausted
 * Stripe moves the subscription to unpaid/canceled and access follows.
 * null = leave the firm's access as it is (checkout not finished yet).
 */
export function accessFor(status: Stripe.Subscription.Status): string | null {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
      return "active";
    case "unpaid":
    case "paused":
      return "suspended";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

/** Latest period end across the subscription's items (unix seconds). */
function periodEnd(sub: Stripe.Subscription): number | null {
  const ends = sub.items.data
    .map((i) => i.current_period_end)
    .filter((n): n is number => typeof n === "number");
  return ends.length ? Math.max(...ends) : null;
}

const TERMINAL = new Set(["canceled", "incomplete_expired"]);

/**
 * True when the subscription is set to end later. The billing portal (current
 * API versions) records this as a `cancel_at` date rather than the older
 * `cancel_at_period_end` flag, so either one counts. Stored in
 * firms.cancel_at_period_end.
 */
export function cancelScheduled(
  sub: Pick<Stripe.Subscription, "status" | "cancel_at_period_end" | "cancel_at">
): boolean {
  if (TERMINAL.has(sub.status)) return false;
  return sub.cancel_at_period_end || sub.cancel_at != null;
}

/** Write the subscription's current state onto its firm. */
async function syncSubscription(
  sb: SupabaseClient,
  sub: Stripe.Subscription
): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const metaFirm = sub.metadata?.firm_id;
  const query = sb.from("firms").select(FIRM_COLS);
  const { data } = await (metaFirm && UUID_RE.test(metaFirm)
    ? query.eq("id", metaFirm)
    : query.eq("stripe_customer_id", customerId)
  ).maybeSingle();
  const firm = data as FirmBillingRow | null;
  if (!firm) {
    console.warn("stripe webhook: no firm for subscription", sub.id);
    return;
  }

  // A stale subscription ending (e.g. an abandoned one after the firm
  // re-subscribed) must not cancel the firm's current one.
  if (
    TERMINAL.has(sub.status) &&
    firm.stripe_subscription_id &&
    firm.stripe_subscription_id !== sub.id
  ) {
    return;
  }

  const end = periodEnd(sub);
  const patch: Record<string, unknown> = {
    billing_mode: "stripe",
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_status: sub.status,
    cancel_at_period_end: cancelScheduled(sub),
  };
  // firms.tier is the admin's decision and is never overwritten from Stripe;
  // a subscription on a different tier's price is only flagged.
  const paidTier = tierForPrice(sub.items.data[0]?.price?.id);
  if (paidTier && firm.tier && paidTier !== firm.tier) {
    console.warn(`stripe webhook: firm ${firm.id} pays ${paidTier} but is set to ${firm.tier}`);
  }
  if (end) patch.renewal_date = new Date(end * 1000).toISOString().slice(0, 10);
  const access = accessFor(sub.status);
  if (access) patch.subscription_status = access;

  const { error } = await sb.from("firms").update(patch).eq("id", firm.id);
  if (error) throw new Error(`firm update failed: ${error.message}`);
}

/**
 * Verify and apply one webhook delivery. Always re-reads the subscription from
 * Stripe rather than trusting the event body, so retried or out-of-order
 * deliveries converge on Stripe's current state.
 */
export async function handleWebhook(
  rawBody: string,
  signature: string | null
): Promise<{ status: number; body: string }> {
  const st = stripeClient();
  const sb = adminClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!st || !sb || !secret) return { status: 501, body: "billing not configured" };
  if (!signature) return { status: 400, body: "missing signature" };

  let event: Stripe.Event;
  try {
    event = await st.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return { status: 400, body: "bad signature" };
  }

  const { data: seen } = await sb
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  if (seen) return { status: 200, body: "duplicate" };

  let subscriptionId: string | null = null;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.subscription) {
        subscriptionId =
          typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      subscriptionId = (event.data.object as Stripe.Subscription).id;
      break;
    default:
      break; // not an event we act on
  }

  if (subscriptionId) {
    const sub = await st.subscriptions.retrieve(subscriptionId);
    await syncSubscription(sb, sub);
  }

  await sb
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true });
  return { status: 200, body: "ok" };
}
