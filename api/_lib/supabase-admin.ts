// Service-role Supabase client, shared by the server-only code that needs it
// (account deletion, the shared API rate limiter). The service role bypasses
// RLS, so every caller must do its own authorization checks.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the server environment (never
// VITE_-prefixed — the service key must not reach the browser).
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { timedFetch } from "./timed-fetch.js";

let admin: SupabaseClient | null = null;

/** The service-role client, or null when the key/URL isn't configured. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  admin ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch },
  });
  return admin;
}
