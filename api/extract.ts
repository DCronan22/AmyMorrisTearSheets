// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runExtraction } from "./_lib/run.js";

export default makeHandler({
  run: runExtraction,
  maxPerWindow: 20,
  failMessage: "Extraction failed unexpectedly.",
});
