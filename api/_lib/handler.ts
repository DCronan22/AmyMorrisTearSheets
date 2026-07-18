// Shared endpoint boundary for the Vercel serverless functions: method guard →
// Supabase auth → per-user rate limit → run function. One place to fix the
// limiter or auth flow for every endpoint.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { getUserId } from "./auth.js";

const WINDOW_MS = 60_000;

export function makeHandler<B>(opts: {
  run: (body: B, userId: string) => Promise<{ status: number; payload: unknown }>;
  maxPerWindow: number;
  failMessage: string;
}) {
  // Best-effort in-memory rate limiter (per warm instance, per endpoint).
  const buckets = new Map<string, { count: number; reset: number }>();
  function rateLimited(userId: string): boolean {
    const now = Date.now();
    const b = buckets.get(userId);
    if (!b || now > b.reset) {
      buckets.set(userId, { count: 1, reset: now + WINDOW_MS });
      return false;
    }
    b.count += 1;
    return b.count > opts.maxPerWindow;
  }

  return async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed." });
    }

    const userId = await getUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: "Not authenticated." });

    if (rateLimited(userId)) {
      return res
        .status(429)
        .json({ error: "Too many requests — slow down a moment." });
    }

    const body = (req.body ?? {}) as B;
    try {
      const { status, payload } = await opts.run(body, userId);
      return res.status(status).json(payload);
    } catch {
      return res.status(500).json({ error: opts.failMessage });
    }
  };
}
