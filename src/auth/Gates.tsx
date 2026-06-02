import type { Firm } from "../types";

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

/** A signed-in user who isn't attached to any firm yet. */
export function NoFirm({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Account pending setup</h1>
        <p className="muted">
          You're signed in as <strong>{email}</strong>, but your account hasn't
          been connected to a design firm yet. Your administrator will finish
          setting you up shortly.
        </p>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/** A firm whose subscription is not active. */
export function SubscriptionInactive({
  firm,
  email,
  onSignOut,
}: {
  firm: Firm;
  email: string;
  onSignOut: () => void;
}) {
  const label: Record<string, string> = {
    trial: "on trial (not yet activated)",
    suspended: "paused",
    canceled: "canceled",
  };
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
        <p className="muted small">
          Questions about billing? Contact your account manager.
        </p>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out ({email})
        </button>
      </div>
    </div>
  );
}
