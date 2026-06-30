import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  /** Finish recovery and continue into the app (the recovery link signed the
   *  user in, so they're now authenticated). */
  onDone: () => void | Promise<void>;
}

/**
 * Shown when the user arrives from a password-recovery email link. Supabase has
 * already established a temporary recovery session via the URL token; here the
 * user picks a new password, which we save with auth.updateUser.
 */
export default function UpdatePassword({ onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Please choose a password of at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't update your password. The reset link may have expired — request a new one from the sign-in screen."
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">TS</span>
          <div>
            <div className="brand-name">Tear Sheets</div>
            <div className="brand-sub">for interior designers</div>
          </div>
        </div>

        <h1 className="auth-title">Choose a new password</h1>

        {done ? (
          <>
            <p className="status-ok">
              Your password has been updated. You're signed in.
            </p>
            <button
              className="btn primary auth-submit"
              onClick={() => void onDone()}
            >
              Continue to Tear Sheets
            </button>
          </>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>
              <span>New password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                autoFocus
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            {error && <p className="status-err">{error}</p>}

            <button className="btn primary auth-submit" disabled={busy}>
              {busy ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
