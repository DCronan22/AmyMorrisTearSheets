// True account deletion: removes the target's auth.users login via the
// service-role key (profiles cascades away with it). This is the only place in
// the stack that can honor the privacy policy's deletion promise — the RPC
// admin_delete_user (migration 0002) can only remove the profile row, because
// hosted Supabase's `postgres` role cannot touch auth.users.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the server environment (never
// VITE_-prefixed — the service key must not reach the browser). Without it the
// endpoint answers 501 and the client falls back to the profile-only RPC.
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let admin: SupabaseClient | null = null;

function adminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  admin ??= createClient(url, key, { auth: { persistSession: false } });
  return admin;
}

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
