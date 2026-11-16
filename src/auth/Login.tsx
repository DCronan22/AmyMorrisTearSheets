import { useState } from "react";
import "../landing/landing.css";
import { SiteFooter, SiteHeader } from "../landing/SiteChrome";
import { linkTo, navigate, pathFor } from "../lib/router";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { authLinkErrorMessage } from "../lib/authErrors";
import { MIN_NEW_PASSWORD_LENGTH } from "../lib/passwordPolicy";

type Mode = "signin" | "signup" | "reset";

/** Where Supabase should send the recovery link back to. Matches the project's
 *  Site URL / allowed redirect URLs (works in dev and on Vercel alike). */
const resetRedirectTo = () =>
  `${window.location.origin}${import.meta.env.BASE_URL}`;

/**
 * Email + password sign-in (/login) and sign-up (/signup), shown inside the
 * public site's header and footer. The password-reset form is a third mode of
 * the sign-in page.
 */
export default function Login({ initialMode = "signin" }: { initialMode?: "signin" | "signup" }) {
  const { recoveryError, clearRecoveryError } = useAuth();
  const [mode, setModeState] = useState<Mode>(initialMode);
  // Follow the address bar (Log in / Get started links, back/forward).
  const [routeMode, setRouteMode] = useState(initialMode);
  if (routeMode !== initialMode) {
    setRouteMode(initialMode);
    setModeState(initialMode);
  }
  const setMode = (m: Mode) => {
    setModeState(m);
    if (m === "signin" && initialMode !== "signin") navigate("login", { replace: true });
    if (m === "signup" && initialMode !== "signup") navigate("signup", { replace: true });
  };
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
        // New accounts only — existing users can still sign in with an older,
        // shorter password.
        if (password.length < MIN_NEW_PASSWORD_LENGTH) {
          setError(
            `Please choose a password of at least ${MIN_NEW_PASSWORD_LENGTH} characters.`
          );
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        setNotice(
          "Account created. Check your inbox for a link to confirm your email address, then sign in here."
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
    <div className="site">
      <SiteHeader />
      <main className="site-auth">
      <div className="auth-card">
        <h1 className="auth-title">
          {mode === "signin"
            ? "Log in"
            : mode === "signup"
              ? "Create your account"
              : "Reset your password"}
        </h1>

        {mode === "signup" && (
          <ol className="auth-steps">
            <li>Create your account and confirm your email.</li>
            <li>Tell us your firm's name and who needs access.</li>
            <li>Once we approve it, choose monthly or annual billing.</li>
          </ol>
        )}
        {mode === "signup" && (
          <p className="muted small auth-join">
            Joining a firm that already uses Sorted Sheets? Sign up with the
            email address your firm gave us and you'll be let in automatically.
          </p>
        )}

        {mode === "reset" && (
          <p className="muted small">
            Enter your account email and we'll send you a link to set a new
            password.
          </p>
        )}

        {recoveryError && mode === "signin" && (
          <p className="status-err" role="alert">
            {/* Fixed, app-authored text only: the raw value comes from the URL
                and is attacker-controlled (phishing via crafted links). */}
            {authLinkErrorMessage(recoveryError)} Reset links can only be used
            once and expire quickly, so open the new one right away.
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
                minLength={
                  mode === "signup" ? MIN_NEW_PASSWORD_LENGTH : undefined
                }
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
                ? "Log in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
          {mode === "signup" && (
            <p className="auth-legal">
              By creating an account you agree to our{" "}
              <a href={pathFor("terms")} onClick={linkTo("terms")}>
                Terms of Service
              </a>{" "}
              and{" "}
              <a href={pathFor("privacy")} onClick={linkTo("privacy")}>
                Privacy Policy
              </a>
              .
            </p>
          )}
        </form>

        <p className="auth-switch muted">
          {mode === "signin" ? (
            <>
              New to Sorted Sheets?{" "}
              <button className="link-btn" onClick={() => setMode("signup")}>
                Create an account
              </button>
            </>
          ) : (
            <>
              {mode === "reset" ? "Remembered it? " : "Already have an account? "}
              <button className="link-btn" onClick={() => setMode("signin")}>
                Log in
              </button>
            </>
          )}
        </p>
      </div>
      </main>
      <SiteFooter />
    </div>
  );
}
