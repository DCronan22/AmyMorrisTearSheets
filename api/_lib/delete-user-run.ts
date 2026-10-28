// True account deletion: removes the target's auth.users login via the
// service-role key (profiles cascades away with it). This is the only place in
// the stack that can honor the privacy policy's deletion promise — the RPC
// admin_delete_user (migration 0002) can only remove the profile row, because
// hosted Supabase's `postgres` role cannot touch auth.users.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the server environment (never
// VITE_-prefixed — the service key must not reach the browser). Without it the
// endpoint answers 501 and the client falls back to the profile-only RPC.
// NOTE: relative imports MUST include the .js extension (Vercel ESM).
import { adminClient } from "./supabase-admin.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeleteUserBody {
  userId?: string;
}

export async function runDeleteUser(
  body: DeleteUserBody,
  callerId: string
): Promise<{ status: number; payload: unknown }> {
  const target = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!UUID_RE.test(target)) {
    return { status: 400, payload: { error: "Invalid user id." } };
  }

  const sb = adminClient();
  if (!sb) {
    return {
      status: 501,
      payload: {
        error:
          "Full account deletion isn't configured (SUPABASE_SERVICE_ROLE_KEY is not set).",
      },
    };
  }

  // The service role bypasses RLS, so re-check authorization explicitly.
  const { data: caller, error: profErr } = await sb
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .maybeSingle();
  if (profErr) {
    return { status: 500, payload: { error: "Could not verify permissions." } };
  }
  if (caller?.role !== "platform_admin") {
    return {
      status: 403,
      payload: { error: "Only a platform admin can delete users." },
    };
  }
  if (target === callerId) {
    return {
      status: 400,
      payload: { error: "You cannot delete your own account." },
    };
  }

  // Never let one platform admin remove another through this endpoint — an
  // admin account must be demoted by hand first. (A target with no profile
  // row is an orphaned login and may still be cleaned up.)
  const { data: targetProfile, error: targetErr } = await sb
    .from("profiles")
    .select("role")
    .eq("id", target)
    .maybeSingle();
  if (targetErr) {
    return { status: 500, payload: { error: "Could not verify permissions." } };
  }
  if (targetProfile?.role === "platform_admin") {
    return {
      status: 403,
      payload: { error: "Platform admin accounts can't be deleted here." },
    };
  }

  const { error } = await sb.auth.admin.deleteUser(target);
  if (error) {
    // An orphaned profile (login already removed by an earlier profile-only
    // delete) should still clean up rather than fail.
    if (/not.?found/i.test(error.message)) {
      await sb.from("profiles").delete().eq("id", target);
      return { status: 200, payload: { ok: true, note: "login was already removed" } };
    }
    return { status: 500, payload: { error: "Deleting the account failed." } };
  }
  return { status: 200, payload: { ok: true } };
}
