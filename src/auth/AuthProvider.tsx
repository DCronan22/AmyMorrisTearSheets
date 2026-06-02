import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Firm, Profile } from "../types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  firm: Firm | null;
  loading: boolean; // true during the initial session + profile load
  isPlatformAdmin: boolean;
  /** Re-fetch profile + firm (e.g. after an admin change). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [firm, setFirm] = useState<Firm | null>(null);
  const [loading, setLoading] = useState(true);

  // Pull the current user's profile and (if any) their firm.
  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setFirm(null);
      return;
    }
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const profileRow = (prof as Profile) ?? null;
    setProfile(profileRow);

    if (profileRow?.firm_id) {
      const { data: firmRow } = await supabase
        .from("firms")
        .select("*")
        .eq("id", profileRow.firm_id)
        .maybeSingle();
      setFirm((firmRow as Firm) ?? null);
    } else {
      setFirm(null);
    }
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      // Skip the initial emission, which races the getSession() load above.
      if (!didInit) return;
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setFirm(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      firm,
      loading,
      isPlatformAdmin: profile?.role === "platform_admin",
      refresh,
      signOut,
    }),
    [session, profile, firm, loading, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
