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
