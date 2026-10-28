// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runExtraction } from "./_lib/run.js";
import type { ExtractRequest } from "./_lib/run.js";

export default makeHandler<ExtractRequest>({
  endpoint: "extract",
  fields: {
    url: { type: "string", maxLength: 2048 },
    text: { type: "string", maxLength: 100_000 }, // AI only reads the first 8k chars
    image: { type: "string", maxLength: 8_000_000 }, // data URL; decoded size checked in run
    aiFallback: { type: "boolean" },
  },
  run: runExtraction,
  failMessage: "Extraction failed unexpectedly.",
});
