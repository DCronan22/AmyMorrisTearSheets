import type { SyntheticEvent } from "react";
import type { Item } from "./types";

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

/** The product fields a catalog search/filter operates on. */
export interface Filterable {
  name: string;
  vendor: string;
  collection: string;
  category: string;
  sku: string;
  material: string;
  color: string;
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
    if (f.vendor && it.vendor !== f.vendor) return false;
    if (f.collection && it.collection !== f.collection) return false;
    if (f.category && it.category !== f.category) return false;
    if (q) {
      const hay =
        `${it.name} ${it.vendor} ${it.collection} ${it.sku} ${it.material} ${it.color}`.toLowerCase();
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
