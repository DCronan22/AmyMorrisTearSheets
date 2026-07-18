// POST /api/delete-user — platform-admin-only true account deletion.
// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { makeHandler } from "./_lib/handler.js";
import { runDeleteUser } from "./_lib/delete-user-run.js";
import type { DeleteUserBody } from "./_lib/delete-user-run.js";

export default makeHandler<DeleteUserBody>({
  run: runDeleteUser,
  maxPerWindow: 10,
  failMessage: "Deleting the account failed.",
});
