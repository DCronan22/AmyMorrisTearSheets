// fetch with a hard per-request timeout, handed to the server-side Supabase
// clients so a hung auth/DB call fails fast (→ 401/503) instead of holding the
// function open until Vercel's maxDuration kills it.
const SUPABASE_TIMEOUT_MS = 4_000;

export const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
