// Vendor and category can hold more than one value. They stay a single
// comma-separated string on the Item/LibraryItem/InventoryItem so the rest of
// the app — display, search, spreadsheet import/export, the exports — keeps
// treating them as plain strings. These helpers parse/join/compare the
// individual tags for the chip editor and the token-aware catalog filters.

/** Split a stored multi-value string into trimmed, case-insensitively de-duped tags. */
export function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Join tags back into the stored ", "-separated form (trimmed + de-duped). */
export function joinTags(tags: string[]): string {
  return parseTags(tags.join(",")).join(", ");
}

/** True when a stored multi-value string contains `tag` (case-insensitive). An
 *  empty `tag` matches everything (an inactive filter). */
export function tagsInclude(value: string | null | undefined, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return parseTags(value).some((t) => t.toLowerCase() === needle);
}
