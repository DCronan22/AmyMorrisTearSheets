import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "signup" | "reset";

/** Where Supabase should send the recovery link back to. Matches the project's
 *  Site URL / allowed redirect URLs (works in dev and on Vercel alike). */
const resetRedirectTo = () =>
  `${window.location.origin}${import.meta.env.BASE_URL}`;

/** Email + password sign-in / sign-up screen shown when no user is logged in. */
export default function Login() {
  const { recoveryError, clearRecoveryError } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: resetRedirectTo() }
        );
        if (error) throw error;
        // Don't reveal whether the address has an account.
        setNotice(
          "If an account exists for that email, we've sent a link to reset your password. Check your inbox (and spam)."
        );
        setMode("signin");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        setNotice(
          "Account created. If email confirmation is on, check your inbox, then sign in. Your administrator will connect you to your firm."
        );
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // On success the AuthProvider's listener takes over.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
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

        <h1 className="auth-title">
          {mode === "signin"
            ? "Sign in"
            : mode === "signup"
              ? "Create your account"
              : "Reset your password"}
        </h1>

        {mode === "reset" && (
          <p className="muted small">
            Enter your account email and we'll send you a link to set a new
            password.
          </p>
        )}

        {recoveryError && mode === "signin" && (
          <p className="status-err" role="alert">
            {recoveryError} Reset links can only be used once and expire quickly
            — request a fresh one and open it right away.
          </p>
        )}

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>
              <span>Full name</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {mode !== "reset" && (
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                minLength={6}
                required
              />
            </label>
          )}

          {mode === "signin" && (
            <p className="auth-forgot">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setMode("reset");
                  setError(null);
                  setNotice(null);
                  clearRecoveryError();
                }}
              >
                Forgot password?
              </button>
            </p>
          )}

          {error && <p className="status-err">{error}</p>}
          {notice && <p className="status-ok">{notice}</p>}

          <button className="btn primary auth-submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>

        <p className="auth-switch muted">
          {mode === "signin" ? (
            <>
              No account yet?{" "}
              <button className="link-btn" onClick={() => setMode("signup")}>
                Create one
              </button>
            </>
          ) : (
            <>
              {mode === "reset" ? "Remembered it? " : "Already have an account? "}
              <button className="link-btn" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
