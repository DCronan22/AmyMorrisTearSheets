import type { SyntheticEvent } from "react";
import type { Item } from "./types";
import { isCalendarDate } from "./types";
import { parseTags, tagsInclude } from "./lib/tags";

/** Format a price as USD; blank when null. */
export function formatPrice(p: number | null): string {
  if (p === null || p === undefined) return "";
  return p.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: p % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a stored ISO date (yyyy-mm-dd) for display, e.g. "Mar 4, 2026". Parsed
 * as UTC so a plain date never slips a day west of Greenwich; anything that
 * isn't an ISO date is shown exactly as typed.
 */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const v = iso.trim();
  // Shape alone isn't enough: Date.UTC happily rolls "2026-13-45" over into the
  // next year, which would display a date nobody typed.
  if (!isCalendarDate(v)) return iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)!;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Tear-sheet price line, e.g. "Price: $7,020 + Fabric + Freight". Upholstered
 * pieces get "+ Fabric + Freight"; everything else just "+ Freight" (matching
 * the Cameron/Century chairs+beds vs. the Jasper console). Returns null when
 * the item has no price, so the line is omitted entirely. Shared by the
 * print/PDF view and the PowerPoint export.
 */
export function priceLine(it: Item): string | null {
  if (it.price === null || it.price === undefined) return null;
  const suffix = it.upholstered === false ? "+ Freight" : "+ Fabric + Freight";
  return `Price: ${formatPrice(it.price)} ${suffix}`;
}

/** Extended price (unit price x quantity). */
export function lineTotal(item: Item): number | null {
  if (item.price === null) return null;
  return item.price * (item.quantity || 1);
}

/** Sum of all line totals; ignores items without a price. */
export function projectTotal(items: Item[]): number {
  return items.reduce((sum, it) => sum + (lineTotal(it) ?? 0), 0);
}

/** Distinct, sorted values of a string field across items. */
export function distinct<T>(items: T[], key: keyof T): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const v = String(it[key] ?? "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Distinct, sorted individual tags of a comma-separated multi-value field
 * (vendor, category) — ", "-joined values are split so each vendor/category
 * appears once. Case-insensitive de-dup, keeping the first-seen casing.
 */
export function distinctTags<T>(items: T[], key: keyof T): string[] {
  const byLower = new Map<string, string>();
  for (const it of items) {
    for (const t of parseTags(String(it[key] ?? ""))) {
      const k = t.toLowerCase();
      if (!byLower.has(k)) byLower.set(k, t);
    }
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

/** The product fields a catalog search/filter operates on. */
export interface Filterable {
  name: string;
  vendor: string;
  collection: string;
  category: string;
  sku: string;
  material: string;
  color: string;
  /** Inventory-only, so optional here: both are searchable when present. */
  inventoryNumber?: string;
  poNumber?: string;
}

/** Filter a catalog (project items or library items) by search + dropdowns.
 *  `room` only applies to items that have rooms (project items). */
export function filterCatalog<T extends Filterable & { room?: string }>(
  items: T[],
  f: {
    search: string;
    vendor: string;
    collection: string;
    category: string;
    room?: string;
  }
): T[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((it) => {
    if (f.room && it.room !== f.room) return false;
    // Vendor and category are multi-value: match when the item's tags include
    // the selected value (an item vendor of "A, B" matches a filter of "A").
    if (f.vendor && !tagsInclude(it.vendor, f.vendor)) return false;
    if (f.collection && it.collection !== f.collection) return false;
    if (f.category && !tagsInclude(it.category, f.category)) return false;
    if (q) {
      const hay =
        `${it.name} ${it.vendor} ${it.collection} ${it.sku} ${it.material} ${it.color} ${
          it.inventoryNumber ?? ""
        } ${it.poNumber ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** New Set with `id` toggled — the standard "toggle selection" state update. */
export function toggledSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Shared <img onError> fallback: swap a broken image for the placeholder. */
export function onImgError(e: SyntheticEvent<HTMLImageElement>): void {
  (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
}

/**
 * Only allow http(s) and uploaded image data URLs to reach an <img src>. Blocks
 * javascript:/data:text/html style stored-XSS payloads (vendor URLs and
 * spreadsheet imports are untrusted). Anything else falls back to the placeholder.
 */
export function safeImageUrl(u: string | undefined | null): string {
  if (!u) return PLACEHOLDER_IMG;
  const v = u.trim();
  if (v.startsWith("data:image/")) return v;
  try {
    const p = new URL(v);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : PLACEHOLDER_IMG;
  } catch {
    return PLACEHOLDER_IMG;
  }
}

/**
 * Like safeImageUrl, but for optional images (logos): returns "" instead of a
 * placeholder when the value is missing or unsafe, so the <img> is simply not
 * rendered.
 */
export function safeLogoUrl(u: string | undefined | null): string {
  if (!u) return "";
  const v = safeImageUrl(u);
  return v === PLACEHOLDER_IMG ? "" : v;
}

/** Validate an outbound link: http(s) only, else null (don't render it). */
export function safeLinkUrl(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    const p = new URL(u.trim());
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : null;
  } catch {
    return null;
  }
}

/** A neutral placeholder image (data URL) for items without a photo. */
export const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>
      <rect width='400' height='300' fill='#ece8e1'/>
      <text x='50%' y='50%' fill='#b3a995' font-family='Georgia,serif'
        font-size='20' text-anchor='middle' dominant-baseline='middle'>
        No image
      </text>
    </svg>`
  );
