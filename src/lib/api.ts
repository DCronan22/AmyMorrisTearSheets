import { supabase } from "./supabase";

/**
 * POST JSON to a same-origin /api endpoint with the current user's Supabase
 * access token attached, tolerantly parsing the (possibly non-JSON) response.
 * Shared by every client → serverless call so the auth header scheme and error
 * contract live in one place.
 */
export async function authedPostJson(
  path: string,
  body: unknown
): Promise<{ res: Response; json: unknown }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON error */
  }
  return { res, json };
}

/** Best-effort error message from a parsed API error payload. */
export function apiErrorMessage(json: unknown, fallback: string): string {
  return (json as { error?: string }).error || fallback;
}
