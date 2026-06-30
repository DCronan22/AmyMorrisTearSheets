import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { normalizeFirmStyle } from "../types";
import type { Firm, Profile } from "../types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  firm: Firm | null;
  loading: boolean; // true during the initial session + profile load
  /** Set when the profile/firm couldn't be loaded (e.g. network down). */
  loadError: string | null;
  /** True when the user arrived from a password-recovery email link and must
   *  choose a new password before using the app. */
  recovering: boolean;
  isPlatformAdmin: boolean;
  /** Re-fetch profile + firm (e.g. after an admin change or a load error). */
  refresh: () => Promise<void>;
  /** Replace the cached firm row (e.g. after saving the firm's style). */
  applyFirm: (firm: Firm) => void;
  /** Leave the password-recovery flow and resume the normal app. */
  finishRecovery: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** The firm's `style` jsonb is member-writable and therefore untrusted —
 *  normalize it once here so every consumer gets a complete, safe shape. */
function withSafeStyle(firm: Firm | null): Firm | null {
  if (!firm) return null;
  return {
    ...firm,
    style: firm.style == null ? null : normalizeFirmStyle(firm.style),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [firm, setFirm] = useState<Firm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Detect a recovery link synchronously on first render so we never flash the
  // workspace before the "set a new password" screen. The Supabase client also
  // emits a PASSWORD_RECOVERY event (handled below) as a backup for PKCE links.
  const [recovering, setRecovering] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.location.hash.includes("type=recovery");
  });
  // The user id the current profile/firm state belongs to, so the auth
  // listener can tell real account changes apart from token refreshes.
  const loadedUserIdRef = useRef<string | undefined>(undefined);

  // Pull the current user's profile and (if any) their firm.
  const loadProfile = useCallback(async (userId: string | undefined) => {
    loadedUserIdRef.current = userId;
    if (!userId) {
      setProfile(null);
      setFirm(null);
      setLoadError(null);
      return;
    }
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (profErr) {
      setProfile(null);
      setFirm(null);
      setLoadError(
        "We couldn't load your account. Check your internet connection and try again."
      );
      return;
    }
    const profileRow = (prof as Profile) ?? null;
    setProfile(profileRow);

    if (profileRow?.firm_id) {
      const { data: firmRow, error: firmErr } = await supabase
        .from("firms")
        .select("*")
        .eq("id", profileRow.firm_id)
        .maybeSingle();
      if (firmErr) {
        setFirm(null);
        setLoadError(
          "We couldn't load your firm's details. Check your internet connection and try again."
        );
        return;
      }
      setFirm(withSafeStyle((firmRow as Firm) ?? null));
    } else {
      setFirm(null);
    }
    setLoadError(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadProfile(data.session?.user.id);
  }, [loadProfile]);

  useEffect(() => {
    let active = true;
    let didInit = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (!active) return;
      didInit = true;
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      // A recovery link establishes a temporary session and fires this event —
      // handle it before the didInit guard so it's never missed, and show the
      // reset-password screen instead of dropping the user into the app.
      if (event === "PASSWORD_RECOVERY") {
        setSession(sess);
        setRecovering(true);
        setLoading(false);
        return;
      }
      // Skip the initial emission, which races the getSession() load above.
      if (!didInit) return;
      // Same user (token refresh / user-metadata update): just adopt the new
      // session. Reloading + flashing the loader here would unmount the whole
      // workspace every time the access token rotates (~hourly).
      if (sess?.user.id && sess.user.id === loadedUserIdRef.current) {
        setSession(sess);
        return;
      }
      setSession(sess);
      setLoading(true);
      loadProfile(sess?.user.id).finally(() => {
        if (active) setLoading(false);
      });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const applyFirm = useCallback((next: Firm) => {
    setFirm(withSafeStyle(next));
  }, []);

  const finishRecovery = useCallback(async () => {
    setRecovering(false);
    // Strip the recovery token from the URL so a reload can't re-trigger the
    // flow, then load the profile/firm the recovery session belongs to.
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Even if the server call fails (offline, already-expired session),
      // fall through and clear local state so the user isn't stuck.
    }
    loadedUserIdRef.current = undefined;
    setSession(null);
    setProfile(null);
    setFirm(null);
    setLoadError(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      firm,
      loading,
      loadError,
      recovering,
      isPlatformAdmin: profile?.role === "platform_admin",
      refresh,
      applyFirm,
      finishRecovery,
      signOut,
    }),
    [
      session,
      profile,
      firm,
      loading,
      loadError,
      recovering,
      refresh,
      applyFirm,
      finishRecovery,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
