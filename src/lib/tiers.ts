import type { BillingInterval, Tier } from "../types";

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

/** One-time setup fee on a firm's first MONTHLY subscription (display only). */
export const SETUP_FEE_USD = 150;

/** Yearly price: 11 months, i.e. one month free every year, no setup fee
 *  (the Stripe annual price). */
export function annualPriceUsd(tier: Tier): number {
  return TIER_PRICE_USD[tier] * 11;
}

/** What a firm's FIRST payment is, by billing interval. */
export function firstPaymentUsd(tier: Tier, interval: BillingInterval): number {
  return interval === "year" ? annualPriceUsd(tier) : TIER_PRICE_USD[tier] + SETUP_FEE_USD;
}

/** Inclusive account-count range per tier. Above the large max = custom quote. */
export const TIER_SEATS: Record<Tier, { min: number; max: number }> = {
  small: { min: 1, max: 5 },
  mid: { min: 6, max: 10 },
  large: { min: 11, max: 20 },
};

/** Largest firm the listed plans cover; bigger firms get a custom price. */
export const MAX_LISTED_SEATS = TIER_SEATS.large.max;

export const TIER_LABEL: Record<Tier, string> = {
  small: "Small",
  mid: "Mid",
  large: "Large",
};

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

/** "Small (1-5 accounts)" etc. */
export function tierDescription(tier: Tier): string {
  return `${TIER_LABEL[tier]} (${tierSeatsText(tier)})`;
}

/** "1-5 accounts". */
export function tierSeatsText(tier: Tier): string {
  const { min, max } = TIER_SEATS[tier];
  return `${min}-${max} accounts`;
}

function seatCount(seats: number): number {
  return Math.max(1, Math.floor(Number.isFinite(seats) ? seats : 1));
}

/** The tier a firm with this many accounts belongs in (large for 11 and up). */
export function tierForSeats(seats: number): Tier {
  const n = seatCount(seats);
  if (n <= TIER_SEATS.small.max) return "small";
  if (n <= TIER_SEATS.mid.max) return "mid";
  return "large";
}

/** More accounts than any listed plan covers (priced by hand). */
export function isCustomSize(seats: number): boolean {
  return seatCount(seats) > MAX_LISTED_SEATS;
}

/**
 * How a firm's account count compares with its tier: "over" means it has
 * outgrown the tier it pays for (including large past 20), "under" that it
 * would fit a smaller one.
 */
export function tierFit(tier: Tier, seats: number): "ok" | "over" | "under" {
  const n = seatCount(seats);
  const { min, max } = TIER_SEATS[tier];
  if (n > max) return "over";
  if (n < min) return "under";
  return "ok";
}
