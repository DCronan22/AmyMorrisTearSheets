import { useCallback, useState } from "react";
import "./App.css";
import { isSupabaseConfigured } from "./lib/supabase";
import { useAuth } from "./auth/AuthProvider";
import { useConfirm } from "./components/ConfirmProvider";
import Login from "./auth/Login";
import UpdatePassword from "./auth/UpdatePassword";
import {
  SetupNeeded,
  FullScreenLoader,
  AuthLoadError,
  NoFirm,
  SubscriptionInactive,
} from "./auth/Gates";
import AdminPanel from "./admin/AdminPanel";
import Workspace from "./Workspace";

/**
 * Top-level router/gate. Decides — based on Supabase config, auth session,
 * profile, firm, and subscription status — which screen to show. All of these
 * checks are also enforced server-side by Row-Level Security; this layer just
 * provides the right UX for each state.
 */
export default function App() {
  const {
    session,
    profile,
    firm,
    loading,
    loadError,
    recovering,
    isPlatformAdmin,
    refresh,
    finishRecovery,
    signOut,
  } = useAuth();
  const confirm = useConfirm();
  const [showAdmin, setShowAdmin] = useState(false);

  // Every sign-out (workspace menu, admin panel, every gate screen) routes
  // through here, so they all get the same confirmation prompt.
  const guardedSignOut = useCallback(async () => {
    const ok = await confirm({
      title: "Sign out?",
      message: "You'll need to sign in again to get back to your tear sheets.",
      confirmLabel: "Sign out",
    });
    if (ok) await signOut();
  }, [confirm, signOut]);

  if (!isSupabaseConfigured) return <SetupNeeded />;
  // A password-recovery link takes precedence over every other state: the user
  // must set a new password before continuing, even though they have a session.
  if (recovering) return <UpdatePassword onDone={finishRecovery} />;
  if (loading) return <FullScreenLoader />;
  if (!session) return <Login />;

  const email = session.user.email ?? "";

  // The session exists but the profile/firm fetch failed (e.g. offline).
  // Without this gate the user would wrongly see "account pending setup".
  if (loadError) {
    return (
      <AuthLoadError message={loadError} onRetry={refresh} onSignOut={guardedSignOut} />
    );
  }

  // Platform admin: can always reach the admin panel. They only drop into the
  // tear-sheet workspace if they themselves belong to an active firm.
  if (isPlatformAdmin) {
    const canUseWorkspace = !!firm && firm.subscription_status === "active";
    if (showAdmin || !canUseWorkspace) {
      return (
        <AdminPanel
          adminEmail={email}
          onSignOut={guardedSignOut}
          onClose={canUseWorkspace ? () => setShowAdmin(false) : undefined}
        />
      );
    }
    return (
      <Workspace
        firm={firm}
        userEmail={email}
        isPlatformAdmin
        onOpenAdmin={() => setShowAdmin(true)}
        onSignOut={guardedSignOut}
      />
    );
  }

  // Regular members need a firm and an active subscription.
  if (!profile || !firm) {
    return <NoFirm email={email} onSignOut={guardedSignOut} />;
  }
  if (firm.subscription_status !== "active") {
    return (
      <SubscriptionInactive firm={firm} email={email} onSignOut={guardedSignOut} />
    );
  }

  return (
    <Workspace
      firm={firm}
      userEmail={email}
      isPlatformAdmin={false}
      onOpenAdmin={() => setShowAdmin(true)}
      onSignOut={guardedSignOut}
    />
  );
}
