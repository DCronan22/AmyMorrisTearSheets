import { authedPostJson, apiErrorMessage } from "../lib/api";
import type { BillingInterval, Firm } from "../types";

async function billingUrl(path: string, body: unknown, fallback: string): Promise<string> {
  const { res, json } = await authedPostJson(path, body).catch(() => {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  });
  const url = (json as { url?: string }).url;
  if (!res.ok || !url) throw new Error(apiErrorMessage(json, fallback));
  return url;
}

/**
 * A Stripe Checkout link for the firm's subscription, charged at the firm's
 * tier price (chosen on the server, never by the client). Members get their
 * own firm (billing contact only); the platform admin passes firmId to make a
 * link to send to a client.
 */
export function checkoutUrl(
  firmId?: string,
  interval: BillingInterval = "month"
): Promise<string> {
  return billingUrl("/api/billing-checkout", { firmId, interval }, "Couldn't start checkout.");
}

/** A Stripe customer-portal link (update card, invoices, cancel). */
export function portalUrl(firmId?: string): Promise<string> {
  return billingUrl("/api/billing-portal", { firmId }, "Couldn't open billing.");
}

/** Whether this signed-in email is the firm's billing contact. */
export function isBillingContact(firm: Firm, email: string): boolean {
  return (
    !!firm.billing_email &&
    firm.billing_email.trim().toLowerCase() === email.trim().toLowerCase()
  );
}
