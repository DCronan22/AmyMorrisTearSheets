/**
 * Turn an auth-link failure from the URL (`#error=…&error_code=…`) into one of a
 * fixed set of messages. Anything in the URL is attacker-controlled — a crafted
 * link like `/#error=x&error_description=Your account is locked. Call …` would
 * otherwise put phishing text on our own sign-in screen — so we NEVER render
 * the incoming text. It is only used as a lookup key; unknown values get a
 * generic message.
 */

const EXPIRED = "That link has expired or has already been used. Request a new one.";
const INVALID = "That link is invalid or has expired. Request a new one.";
const OTHER_BROWSER =
  "That link couldn't be completed in this browser. Open it in the same browser you requested it from, or request a new one.";
const DENIED = "That link is no longer valid. Request a new one.";
export const GENERIC_AUTH_LINK_ERROR =
  "Something went wrong with that link. Request a new one.";

/** Known Supabase / OAuth `error_code` / `error` values → fixed text. */
const BY_CODE: Record<string, string> = {
  otp_expired: EXPIRED,
  flow_state_expired: EXPIRED,
  one_time_token_not_found: EXPIRED,
  otp_disabled: INVALID,
  bad_jwt: INVALID,
  session_expired: EXPIRED,
  session_not_found: INVALID,
  flow_state_not_found: OTHER_BROWSER,
  bad_code_verifier: OTHER_BROWSER,
  bad_oauth_state: OTHER_BROWSER,
  access_denied: DENIED,
  unauthorized_client: DENIED,
  invalid_request: INVALID,
  server_error: GENERIC_AUTH_LINK_ERROR,
  temporarily_unavailable: GENERIC_AUTH_LINK_ERROR,
};

/** Exact (case-insensitive) descriptions Supabase itself sends, plus the app's
 *  own fallback string — only so today's AuthProvider (which still hands over
 *  the description) gets a specific message. Never echoed back. */
const BY_DESCRIPTION: Record<string, string> = {
  "email link is invalid or has expired": EXPIRED,
  "token has expired or is invalid": EXPIRED,
  "your reset link is invalid or has expired. please request a new one.": INVALID,
};

/**
 * Map an auth error code (preferred) or a raw description to a fixed,
 * app-authored message. Returns null when there's no error.
 */
export function authLinkErrorMessage(
  codeOrDescription: string | null | undefined
): string | null {
  if (codeOrDescription == null) return null;
  const key = String(codeOrDescription).trim().toLowerCase();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(BY_CODE, key)) return BY_CODE[key];
  if (Object.prototype.hasOwnProperty.call(BY_DESCRIPTION, key)) {
    return BY_DESCRIPTION[key];
  }
  return GENERIC_AUTH_LINK_ERROR;
}
