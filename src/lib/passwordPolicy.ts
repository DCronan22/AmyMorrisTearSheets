/**
 * Minimum length for a NEW password (sign-up and password reset). Sign-in does
 * not enforce it, so existing users with shorter passwords can still log in.
 * Client-side only — the server-side minimum lives in the Supabase Auth config.
 */
export const MIN_NEW_PASSWORD_LENGTH = 10;
