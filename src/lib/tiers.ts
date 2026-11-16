import type { Tier } from "../types";

// Firm-size tiers. Stripe is what actually charges (price ids in server env);
// the dollar amounts below are for DISPLAY only (sign-up form, plan screen).
// If a Stripe price changes, change it here too.

export const TIERS: readonly Tier[] = ["small", "mid", "large"];

/** Monthly price per tier in whole US dollars (display only). */
export const TIER_PRICE_USD: Record<Tier, number> = {
  small: 200,
  mid: 350,
  large: 600,
};

/** One-time setup fee added to a firm's first month (display only). */
export const SETUP_FEE_USD = 150;

/** Inclusive account-count range per tier (max null = no upper limit). */
export const TIER_SEATS: Record<Tier, { min: number; max: number | null }> = {
  small: { min: 1, max: 4 },
  mid: { min: 5, max: 10 },
  large: { min: 11, max: null },
};

export const TIER_LABEL: Record<Tier, string> = {
  small: "Small",
  mid: "Mid",
  large: "Large",
};

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

/** "Small (1-4 accounts)" etc. */
export function tierDescription(tier: Tier): string {
  const { min, max } = TIER_SEATS[tier];
  return `${TIER_LABEL[tier]} (${max === null ? `${min}+` : `${min}-${max}`} accounts)`;
}

/** "1-4 accounts" / "11+ accounts". */
export function tierSeatsText(tier: Tier): string {
  const { min, max } = TIER_SEATS[tier];
  return `${max === null ? `${min}+` : `${min}-${max}`} accounts`;
}

/** The tier a firm with this many accounts belongs in. */
export function tierForSeats(seats: number): Tier {
  const n = Math.max(1, Math.floor(Number.isFinite(seats) ? seats : 1));
  if (n <= (TIER_SEATS.small.max as number)) return "small";
  if (n <= (TIER_SEATS.mid.max as number)) return "mid";
  return "large";
}

/**
 * How a firm's account count compares with its tier: "over" means it has
 * outgrown the tier it pays for, "under" that it would fit a smaller one.
 */
export function tierFit(tier: Tier, seats: number): "ok" | "over" | "under" {
  const want = tierForSeats(seats);
  if (want === tier) return "ok";
  return TIERS.indexOf(want) > TIERS.indexOf(tier) ? "over" : "under";
}
