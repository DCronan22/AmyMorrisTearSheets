// POST /api/stripe-webhook — Stripe → firm access. Signature-verified, so it
// takes no user auth. Uses the Web Request signature (not VercelRequest) so the
// body arrives untouched: Stripe signs the exact raw bytes.
// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { handleWebhook } from "./_lib/billing.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const { status, body } = await handleWebhook(
      await request.text(),
      request.headers.get("stripe-signature")
    );
    return new Response(body, { status });
  } catch (e) {
    // 500 makes Stripe retry the delivery later.
    console.error("stripe webhook failed:", e);
    return new Response("error", { status: 500 });
  }
}
