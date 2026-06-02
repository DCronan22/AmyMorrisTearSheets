import { useState } from "react";
import { supabase } from "../lib/supabase";

type Mode = "signin" | "signup";

/** Email + password sign-in / sign-up screen shown when no user is logged in. */
export default function Login() {
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
      if (mode === "signup") {
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
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>

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

          {error && <p className="status-err">{error}</p>}
          {notice && <p className="status-ok">{notice}</p>}

          <button className="btn primary auth-submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
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
              Already have an account?{" "}
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
