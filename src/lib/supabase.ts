import { createClient } from "@supabase/supabase-js";

// Read Vite env vars. Both are required for the app to talk to Supabase.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True only when both env vars are present. When false, the app shows a setup
 * screen instead of crashing — useful before the Supabase project is wired up.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

// When unconfigured we still construct a client against harmless placeholders so
// imports don't throw at module load; the UI gates on `isSupabaseConfigured`.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
