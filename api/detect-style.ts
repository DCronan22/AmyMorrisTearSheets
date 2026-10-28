// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runStyleDetect } from "./_lib/style-run.js";
import type { StyleDetectRequest } from "./_lib/style-run.js";

export default makeHandler<StyleDetectRequest>({
  endpoint: "detect-style",
  fields: {
    image: { type: "string", maxLength: 8_000_000 }, // data URL; decoded size checked in run
  },
  run: runStyleDetect,
  failMessage: "Style detection failed unexpectedly.",
});
