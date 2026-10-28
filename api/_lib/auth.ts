// Verify a Supabase access token server-side so /api/extract is not an open
// proxy (the cost auditor's #2 risk + the security auditor's auth requirement),
// and load the caller's role + firm status so only members of an active firm
// (or a platform admin) can spend AI credits / use the URL fetcher.
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { timedFetch } from "./timed-fetch.js";

function env(name: string): string | undefined {
  // On Vercel, project env vars (including VITE_-prefixed) are available to
  // serverless functions via process.env.
  return process.env[name] ?? process.env[`VITE_${name}`];
}

// One client per warm instance; each getUser call still hits the network.
let sb: SupabaseClient | null = null;

function bearerToken(authHeader?: string): string | null {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  return token ? token : null;
}

async function verifyToken(token: string): Promise<string | null> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  try {
    sb ??= createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: timedFetch },
    });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/** Returns the authenticated user's id, or null if the token is missing/invalid. */
export async function getUserId(authHeader?: string): Promise<string | null> {
  const token = bearerToken(authHeader);
  return token ? verifyToken(token) : null;
}

export interface CallerAccess {
  userId: string;
  role: "member" | "platform_admin";
  firmId: string | null;
  /** firms.subscription_status === 'active' (mirrors the DB's firm_is_active()). */
  firmActive: boolean;
}

export type CallerResult =
  | { kind: "ok"; access: CallerAccess }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" }; // couldn't load the profile — fail closed

/** The JWT's `sub` claim, read WITHOUT verifying (verification happens elsewhere). */
function unverifiedSub(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof claims?.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Normalize the `profiles` row (with its embedded `firms` row) into
 * CallerAccess. Exported for unit tests.
 */
export function toCallerAccess(userId: string, row: unknown): CallerAccess | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const role = r.role === "platform_admin" ? "platform_admin" : "member";
  const firmId = typeof r.firm_id === "string" ? r.firm_id : null;
  // PostgREST returns a to-one embed as an object; tolerate an array too.
  const firmRaw = Array.isArray(r.firms) ? r.firms[0] : r.firms;
  const status =
    firmRaw && typeof firmRaw === "object"
      ? (firmRaw as Record<string, unknown>).subscription_status
      : undefined;
  return { userId, role, firmId, firmActive: firmId !== null && status === "active" };
}

/**
 * Verify the bearer token AND load the caller's profile + firm status.
 *
 * The profile read uses a client authenticated AS THE USER (anon key + their
 * JWT), so RLS limits it to their own profile and own firm — no service role
 * needed. It runs in parallel with the token verification: PostgREST checks
 * the JWT signature itself, and the result is only used if getUser() agrees on
 * the user id.
 */
export async function getCaller(authHeader?: string): Promise<CallerResult> {
  const token = bearerToken(authHeader);
  if (!token) return { kind: "unauthenticated" };
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  const sub = unverifiedSub(token);
  if (!url || !key || !sub) return { kind: "unauthenticated" };

  const userClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: timedFetch },
  });
  const profileQuery = (async () => {
    try {
      const { data, error } = await userClient
        .from("profiles")
        .select("role, firm_id, firms(subscription_status)")
        .eq("id", sub)
        .maybeSingle();
      return error ? { failed: true as const } : { failed: false as const, data };
    } catch {
      return { failed: true as const };
    }
  })();

  const [userId, profile] = await Promise.all([verifyToken(token), profileQuery]);
  if (!userId || userId !== sub) return { kind: "unauthenticated" };
  if (profile.failed) return { kind: "unavailable" };
  // A verified user with no profile row (deleted/orphaned) gets role
  // 'member', no firm → denied by the caller's gate.
  const access =
    toCallerAccess(userId, profile.data) ??
    { userId, role: "member" as const, firmId: null, firmActive: false };
  return { kind: "ok", access };
}

/**
 * Who may use the API at all: a platform admin, or a member of a firm whose
 * subscription_status is 'active' (the DB's firm_is_active()). Returns the
 * client-facing denial message, or null when allowed.
 */
export function accessDenial(a: CallerAccess): string | null {
  if (a.role === "platform_admin") return null;
  if (a.firmId !== null && a.firmActive) return null;
  return "Your account isn't active yet. Ask your administrator to activate your firm's subscription.";
}
