// POST /api/billing-portal — open Stripe's customer portal for a firm.
// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runPortal } from "./_lib/billing.js";
import type { PortalBody } from "./_lib/billing.js";

export default makeHandler<PortalBody>({
  endpoint: "billing-portal",
  fields: {
    firmId: { type: "string", maxLength: 64 },
  },
  run: runPortal,
  // An inactive/unpaid firm must still reach this to pay; billing.ts checks
  // the caller is the firm's billing contact (or a platform admin).
  requireActiveFirm: false,
  failMessage: "Couldn't open billing.",
});
