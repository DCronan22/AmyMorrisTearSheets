// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runStyleDetect } from "./_lib/style-run.js";

export default makeHandler({
  run: runStyleDetect,
  maxPerWindow: 10,
  failMessage: "Style detection failed unexpectedly.",
});
