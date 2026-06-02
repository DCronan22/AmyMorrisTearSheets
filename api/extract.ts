import type { VercelRequest, VercelResponse } from "@vercel/node";

// Best-effort in-memory rate limiter (per warm instance).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const buckets = new Map<string, { count: number; reset: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || now > b.reset) {
    buckets.set(userId, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed." });
    }

    // Imported lazily inside the handler so any load-time failure is caught and
    // surfaced as JSON instead of an opaque platform 500.
    const { getUserId } = await import("./_lib/auth");
    const { runExtraction } = await import("./_lib/run");

    const userId = await getUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: "Not authenticated." });

    if (rateLimited(userId)) {
      return res
        .status(429)
        .json({ error: "Too many requests — slow down a moment." });
    }

    const body = req.body ?? {};
    const { status, payload } = await runExtraction(body);
    return res.status(status).json(payload);
  } catch (e) {
    // TEMP DIAGNOSTIC: surface the real error so we can fix the deploy.
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
  }
}
