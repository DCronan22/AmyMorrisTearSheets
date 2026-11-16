import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { BillingInterval, Firm, Tier } from "../types";
import { checkoutUrl, isBillingContact, portalUrl } from "../data/billing";
import EmailRows from "../components/EmailRows";
import {
  fetchMyRequest,
  submitFirmRequest,
  withdrawFirmRequest,
} from "../data/requests";
import type { FirmRequest } from "../data/requests";
import {
  annualPriceUsd,
  isCustomSize,
  isTier,
  tierDescription,
  tierForSeats,
  tierSeatsText,
  MAX_LISTED_SEATS,
  SETUP_FEE_USD,
  TIER_LABEL,
  TIER_PRICE_USD,
  TIERS,
} from "../lib/tiers";
import { cleanEmails, firstBadEmail } from "../lib/emails";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Shown when the Supabase env vars are missing (pre-setup). */
export function SetupNeeded() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Almost there</h1>
        <p className="muted">
          This app needs its Supabase connection configured. Create a{" "}
          <code>.env.local</code> file with <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        </p>
        <p className="muted small">
          See <code>SETUP.md</code> for the full, step-by-step guide.
        </p>
      </div>
    </div>
  );
}

/** Full-screen centered spinner for the initial auth load. */
export function FullScreenLoader() {
  return (
    <div className="auth-screen">
      <div className="loader" aria-label="Loading">
        <span className="spinner" />
      </div>
    </div>
  );
}

/** Shown when the profile/firm couldn't be loaded (network problem etc.). */
export function AuthLoadError({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Connection problem</h1>
        <p className="muted">{message}</p>
        <p>
          <button className="btn primary" onClick={onRetry}>
            Try again
          </button>{" "}
          <button className="btn ghost" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

/**
 * A signed-in user who isn't attached to any firm yet. They can ask for their
 * firm to be set up (name + every account email); the platform admin approves
 * it, and approval attaches them. Someone already on an approved firm's list
 * is attached automatically once their email is confirmed.
 */
export function NoFirm({
  userId,
  email,
  onSignOut,
  onRefresh,
}: {
  userId: string;
  email: string;
  onSignOut: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [request, setRequest] = useState<FirmRequest | null | undefined>(undefined);
  const [firmName, setFirmName] = useState("");
  const [emails, setEmails] = useState<string[]>([""]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once an approved request's firm reload has finished. If we're still
  // here after that, the person was removed from that firm later, so let them
  // ask again instead of waiting on "Loading your firm…" forever.
  const [approvedStale, setApprovedStale] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequest(await fetchMyRequest(userId));
    } catch {
      setRequest(null);
    }
  }, [userId]);

  useEffect(() => {
    // Initial fetch on mount; load() sets state after the async read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // An approved request means the firm exists: reload the session's firm.
  useEffect(() => {
    if (request?.status !== "approved") return;
    let live = true;
    void onRefresh().finally(() => {
      if (live) setApprovedStale(true);
    });
    return () => {
      live = false;
    };
  }, [request?.status, onRefresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!firmName.trim()) {
      setError("Enter your firm's name.");
      return;
    }
    const bad = firstBadEmail(emails);
    if (bad) {
      setError(`"${bad}" doesn't look like an email address.`);
      return;
    }
    setBusy(true);
    try {
      await submitFirmRequest(firmName.trim(), cleanEmails(emails), note.trim());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    setBusy(true);
    setError(null);
    try {
      await withdrawFirmRequest(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't withdraw the request.");
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    setBusy(true);
    await load();
    await onRefresh();
    setBusy(false);
  }

  const signOut = (
    <button className="btn ghost" onClick={onSignOut}>
      Sign out ({email})
    </button>
  );

  if (request === undefined) return <FullScreenLoader />;

  if (request?.status === "pending" || (request?.status === "approved" && !approvedStale)) {
    const n = request.member_emails.length;
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">
            {request.status === "pending" ? "Request sent" : "Approved"}
          </h1>
          <p className="muted">
            {request.status === "pending" ? (
              <>
                We've got your request to set up <strong>{request.firm_name}</strong>{" "}
                with {n} {n === 1 ? "account" : "accounts"}. You'll get access as
                soon as it's approved.
              </>
            ) : (
              <>
                <strong>{request.firm_name}</strong> is set up. Loading your firm…
              </>
            )}
          </p>
          <p className="billing-actions">
            <button className="btn primary" disabled={busy} onClick={checkAgain}>
              {busy ? "Checking…" : "Check again"}
            </button>{" "}
            {request.status === "pending" && (
              <button className="btn ghost" disabled={busy} onClick={() => withdraw(request.id)}>
                Withdraw request
              </button>
            )}
          </p>
          {error && <p className="status-err">{error}</p>}
          {signOut}
        </div>
      </div>
    );
  }

  const others = cleanEmails(emails).filter((x) => x !== email.trim().toLowerCase());
  const seats = others.length + 1;
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Set up your firm</h1>
        <p className="muted">
          You're signed in as <strong>{email}</strong>. If your firm already uses
          Tear Sheets, ask whoever set it up to add your email. Otherwise, request
          a new firm below and we'll review it.
        </p>
        {request?.status === "approved" && (
          <p className="muted small">
            Your account isn't connected to {request.firm_name} any more. Ask
            whoever runs it to add you back, or request a new firm.
          </p>
        )}
        {request?.status === "declined" && (
          <p className="status-err">
            Your earlier request for {request.firm_name} wasn't approved. Contact
            us if you think that's a mistake, or send a new one.
          </p>
        )}
        <form className="auth-form request-form" onSubmit={submit} noValidate>
          <label>
            Firm name
            <input
              value={firmName}
              maxLength={120}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="Your design firm"
            />
          </label>
          <fieldset className="request-emails">
            <legend>Who needs an account?</legend>
            <p className="muted small">
              Add everyone at your firm who'll use Tear Sheets. Once we approve
              your firm, they can sign up with these addresses and they'll be
              let in automatically.
            </p>
            <EmailRows
              rows={emails}
              onChange={(next) => {
                setEmails(next);
                setError(null);
              }}
              lockedEmail={email}
            />
          </fieldset>
          <p className="muted small">
            {seats} {seats === 1 ? "account" : "accounts"} including you. Plans
            are priced by firm size:
          </p>
          <PricingTiers seats={seats} />
          {isCustomSize(seats) && (
            <p className="muted small pricing-custom">
              Over {MAX_LISTED_SEATS} accounts? Send the request anyway and
              we'll quote you a custom price.
            </p>
          )}
          <p className="muted small">
            Pay monthly (the first month includes a one-time {usd(SETUP_FEE_USD)}{" "}
            setup fee) or annually: one month free every year and no setup fee.
            You'll choose when you subscribe, after your request is approved.
          </p>
          <label>
            Anything we should know? (optional)
            <textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p className="status-err">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
        {signOut}
      </div>
    </div>
  );
}

/** The three plans, with the one matching `seats` highlighted. */
function PricingTiers({ seats }: { seats: number }) {
  const current = isCustomSize(seats) ? null : tierForSeats(seats);
  return (
    <ul className="pricing-tiers" aria-label="Plans">
      {TIERS.map((t) => (
        <li key={t} className={t === current ? "is-current" : undefined}>
          <span className="pricing-name">{TIER_LABEL[t]}</span>
          <span className="pricing-seats">{tierSeatsText(t)}</span>
          <span className="pricing-price">
            {usd(TIER_PRICE_USD[t])}
            <span className="pricing-per">/month</span>
          </span>
          <span className="pricing-annual">or {usd(annualPriceUsd(t))}/year</span>
          {t === current && <span className="pricing-tag">Your size</span>}
        </li>
      ))}
    </ul>
  );
}

/** Monthly vs annual, with what the first payment will be for each. */
function IntervalChoice({
  tier,
  first,
  value,
  onChange,
}: {
  tier: Tier;
  first: boolean;
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) {
  const monthly = TIER_PRICE_USD[tier];
  const options: { id: BillingInterval; title: string; price: string; detail: string; tag?: string }[] = [
    {
      id: "year",
      title: "Annual",
      price: `${usd(annualPriceUsd(tier))}/year`,
      detail: first
        ? "One month free every year, and no setup fee."
        : "One month free every year.",
      tag: "1 month free",
    },
    {
      id: "month",
      title: "Monthly",
      price: `${usd(monthly)}/month`,
      detail: first
        ? `First payment ${usd(monthly + SETUP_FEE_USD)}, including a one-time ${usd(SETUP_FEE_USD)} setup fee.`
        : "Billed every month.",
    },
  ];
  return (
    <div className="interval-choice" role="radiogroup" aria-label="Billing">
      {options.map((o) => (
        <label key={o.id} className={`interval-option${value === o.id ? " is-selected" : ""}`}>
          <input
            type="radio"
            name="billing-interval"
            value={o.id}
            checked={value === o.id}
            onChange={() => onChange(o.id)}
          />
          <span className="interval-head">
            <span className="interval-title">{o.title}</span>
            {o.tag && <span className="interval-tag">{o.tag}</span>}
          </span>
          <span className="interval-price">{o.price}</span>
          <span className="interval-detail">{o.detail}</span>
        </label>
      ))}
    </div>
  );
}

/** True right after Stripe Checkout sends the user back here. Read once, then
 *  stripped so a later reload doesn't show "activating" again. */
const returnedFromCheckout = (() => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const billing = params.get("billing");
  if (billing) {
    params.delete("billing");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
  }
  return billing === "success";
})();

/** A firm whose subscription is not active. */
export function SubscriptionInactive({
  firm,
  email,
  onSignOut,
  onRefresh,
}: {
  firm: Firm;
  email: string;
  onSignOut: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(returnedFromCheckout);
  const [interval, setInterval_] = useState<BillingInterval>("year");
  const canPay = isBillingContact(firm, email);

  // Stripe confirms payment to our webhook a moment after redirecting back,
  // so re-check the firm for a little while instead of showing "inactive".
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      void onRefresh();
      if (tries >= 15) {
        clearInterval(t);
        setWaiting(false);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting, onRefresh]);

  async function go(kind: "checkout" | "portal") {
    setBusy(kind);
    setError(null);
    try {
      window.location.href =
        kind === "portal" ? await portalUrl() : await checkoutUrl(undefined, interval);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  }

  if (waiting) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Payment received</h1>
          <p className="muted">
            Thanks! We're activating <strong>{firm.name}</strong> — this
            usually takes a few seconds.
          </p>
          <div className="loader" aria-label="Activating">
            <span className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  const label: Record<string, string> = {
    trial: "on trial (not yet activated)",
    suspended: "paused",
    canceled: "canceled",
  };
  // A Stripe-billed firm that's paused/canceled has a card on file to fix in
  // the portal; everyone else starts a fresh subscription.
  const hasStripe = firm.billing_mode === "stripe" && !!firm.stripe_customer_id;
  const fixInPortal = hasStripe && firm.stripe_status === "unpaid";
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Subscription {label[firm.subscription_status] ?? "inactive"}</h1>
        <p className="muted">
          Access to <strong>{firm.name}</strong>'s tear sheets is currently
          unavailable because the subscription is{" "}
          {label[firm.subscription_status] ?? "inactive"}. Your data is safe —
          access is restored as soon as the subscription is active again.
        </p>
        {canPay ? (
          <div className="billing-actions subscribe-actions">
            {fixInPortal ? (
              <button className="btn primary" disabled={!!busy} onClick={() => go("portal")}>
                {busy === "portal" ? "Opening…" : "Update payment method"}
              </button>
            ) : (
              isTier(firm.tier) ? (
                <>
                  <span className="muted small">
                    Your plan: {tierDescription(firm.tier)}.
                  </span>
                  <IntervalChoice
                    tier={firm.tier}
                    // Server rule (owesSetupFee): first subscription only.
                    first={!firm.stripe_subscription_id}
                    value={interval}
                    onChange={setInterval_}
                  />
                  <button className="btn primary" disabled={!!busy} onClick={() => go("checkout")}>
                    {busy === "checkout"
                      ? "Opening…"
                      : interval === "year"
                        ? "Subscribe annually"
                        : "Subscribe monthly"}
                  </button>
                </>
              ) : (
                <span className="muted small">
                  Your plan size hasn't been set yet. We'll be in touch as soon
                  as it's ready.
                </span>
              )
            )}
          </div>
        ) : (
          <p className="muted small">
            Questions about billing? Contact{" "}
            {firm.billing_email ? (
              <strong>{firm.billing_email}</strong>
            ) : (
              "your account manager"
            )}
            .
          </p>
        )}
        {error && <p className="status-err">{error}</p>}
        <button className="btn ghost" onClick={onSignOut}>
          Sign out ({email})
        </button>
      </div>
    </div>
  );
}
