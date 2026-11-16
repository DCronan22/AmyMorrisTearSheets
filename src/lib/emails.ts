/** Split a pasted list (commas, semicolons, spaces, new lines) into unique,
 *  lower-cased emails. The database re-validates (normalize_email_list). */
export function parseEmailList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen];
}

// Same shape the database accepts (normalize_email_list); it re-checks anyway.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function looksLikeEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** Trimmed, lower-cased, de-duplicated, non-empty emails from input rows. */
export function cleanEmails(rows: string[]): string[] {
  return [...new Set(rows.map((r) => r.trim().toLowerCase()).filter(Boolean))];
}

/** First row that isn't a valid email address, or null. Blank rows are fine;
 *  duplicates are fine too (they're merged). */
export function firstBadEmail(rows: string[]): string | null {
  for (const r of rows) if (r.trim() && !looksLikeEmail(r)) return r.trim();
  return null;
}
