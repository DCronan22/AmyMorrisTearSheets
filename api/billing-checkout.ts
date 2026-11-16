// POST /api/billing-checkout — start a Stripe Checkout for a firm, priced by its tier.
// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runCheckout } from "./_lib/billing.js";
import type { CheckoutBody } from "./_lib/billing.js";

export default makeHandler<CheckoutBody>({
  endpoint: "billing-checkout",
  fields: {
    firmId: { type: "string", maxLength: 64 },
  },
  run: runCheckout,
  // An inactive/unpaid firm must still reach this to pay; billing.ts checks
  // the caller is the firm's billing contact (or a platform admin).
  requireActiveFirm: false,
  failMessage: "Couldn't start checkout.",
});
