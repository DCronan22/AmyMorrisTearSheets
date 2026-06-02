// Verify a Supabase access token server-side so /api/extract is not an open
// proxy (the cost auditor's #2 risk + the security auditor's auth requirement).
import { createClient } from "@supabase/supabase-js";

function env(name: string): string | undefined {
  // On Vercel, project env vars (including VITE_-prefixed) are available to
  // serverless functions via process.env.
  return process.env[name] ?? process.env[`VITE_${name}`];
}

/** Returns the authenticated user's id, or null if the token is missing/invalid. */
export async function getUserId(authHeader?: string): Promise<string | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}
