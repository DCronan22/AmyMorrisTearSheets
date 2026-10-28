// Shared endpoint boundary for the Vercel serverless functions: method guard →
// Supabase auth → account/firm gate → body validation → rate limit → run
// function. One place to fix the limiter or auth flow for every endpoint.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// NOTE: relative imports MUST include the .js extension — Vercel emits each
// api/ file as a separate ESM module, and Node ESM requires explicit extensions.
import { accessDenial, getCaller } from "./auth.js";
import type { CallerAccess, CallerResult } from "./auth.js";
import { adminClient } from "./supabase-admin.js";

// --- Rate limits -----------------------------------------------------------
// Enforced in the database by public.api_consume (migration 0010) so they hold
// across every serverless instance. If that function isn't reachable (not yet
// migrated, service key missing, DB hiccup) the per-instance in-memory limiter
// below takes over for the per-minute limit — never fail open entirely.

/** Requests per user per minute, per endpoint. */
export const PER_MINUTE = {
  extract: 20,
  "detect-style": 10,
  "delete-user": 10,
} as const;

/**
 * Rolling-24h cap on AI-costing / URL-fetching calls, shared by every user of
 * one firm (or per user when they have no firm) across all metered endpoints.
 * Platform admins are exempt.
 */
export const DAILY_FIRM_CAP = 500;

/** Endpoints that spend Anthropic credits or use the URL fetcher. */
const METERED: ReadonlySet<Endpoint> = new Set<Endpoint>(["extract", "detect-style"]);

export type Endpoint = keyof typeof PER_MINUTE;

const WINDOW_MS = 60_000;

// --- Body validation -------------------------------------------------------

export type FieldSpec = { type: "string"; maxLength: number } | { type: "boolean" };

/**
 * Validate an untrusted request body against a field spec. Returns a fresh
 * object holding only the known fields (null/undefined fields are dropped),
 * or a client-facing error.
 */
export function parseBody<B>(
  raw: unknown,
  fields: Record<string, FieldSpec>
): { ok: true; body: B } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, body: {} as B };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid request." };
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(src, name)) continue;
    const v = src[name];
    if (v === undefined || v === null) continue;
    if (spec.type === "boolean") {
      if (typeof v !== "boolean") return { ok: false, error: `Invalid "${name}".` };
    } else {
      if (typeof v !== "string") return { ok: false, error: `Invalid "${name}".` };
      if (v.length > spec.maxLength) return { ok: false, error: `"${name}" is too long.` };
    }
    out[name] = v;
  }
  return { ok: true, body: out as B };
}

// --- Handler ---------------------------------------------------------------

type Verdict = "ok" | "minute" | "day";

export interface HandlerDeps {
  getCaller: (authHeader?: string) => Promise<CallerResult>;
  /** Shared (DB) limiter; resolves null when unavailable → in-memory fallback. */
  consumeShared: (args: {
    access: CallerAccess;
    endpoint: Endpoint;
    perMinute: number;
    perDay: number | null;
  }) => Promise<Verdict | null>;
}

let warnedFallback = false;

/** Shared limiter via public.api_consume; null → caller falls back. Exported for tests. */
export async function consumeViaDb(args: {
  access: CallerAccess;
  endpoint: Endpoint;
  perMinute: number;
  perDay: number | null;
}): Promise<Verdict | null> {
  const sb = adminClient();
  if (sb) {
    try {
      const { data, error } = await sb.rpc("api_consume", {
        p_user: args.access.userId,
        p_firm: args.access.firmId,
        p_endpoint: args.endpoint,
        p_per_minute: args.perMinute,
        p_per_day: args.perDay,
      });
      if (!error && (data === "ok" || data === "minute" || data === "day")) {
        return data;
      }
    } catch {
      /* fall through to the in-memory limiter */
    }
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn("api_consume unavailable; using the per-instance in-memory rate limiter.");
  }
  return null;
}

const defaultDeps: HandlerDeps = { getCaller, consumeShared: consumeViaDb };

export function makeHandler<B>(
  opts: {
    endpoint: Endpoint;
    /** Accepted body fields; anything else is dropped. */
    fields: Record<keyof B & string, FieldSpec>;
    run: (body: B, userId: string) => Promise<{ status: number; payload: unknown }>;
    failMessage: string;
    /** Default true. Set false only for endpoints a not-yet-active firm must
     *  still reach (e.g. billing checkout/portal) — they then do their own
     *  authorization in `run`. */
    requireActiveFirm?: boolean;
  },
  deps: HandlerDeps = defaultDeps
) {
  const perMinute = PER_MINUTE[opts.endpoint];
  const metered = METERED.has(opts.endpoint);

  // Fallback in-memory rate limiter (per warm instance, per endpoint).
  const buckets = new Map<string, { count: number; reset: number }>();
  function rateLimitedLocally(userId: string): boolean {
    const now = Date.now();
    const b = buckets.get(userId);
    if (!b || now > b.reset) {
      buckets.set(userId, { count: 1, reset: now + WINDOW_MS });
      return false;
    }
    b.count += 1;
    return b.count > perMinute;
  }

  return async function handler(req: VercelRequest, res: VercelResponse) {
    // Responses carry per-user data and must never be cached by the browser
    // or any intermediary.
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed." });
    }

    const caller = await deps.getCaller(req.headers.authorization);
    if (caller.kind === "unauthenticated") {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (caller.kind === "unavailable") {
      return res
        .status(503)
        .json({ error: "Couldn't verify your account right now. Try again." });
    }
    const access = caller.access;
    const denial = opts.requireActiveFirm === false ? null : accessDenial(access);
    if (denial) return res.status(403).json({ error: denial });

    let parsed: ReturnType<typeof parseBody<B>>;
    try {
      // Reading req.body throws on malformed JSON.
      parsed = parseBody<B>(req.body, opts.fields);
    } catch {
      parsed = { ok: false, error: "Invalid request." };
    }
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    let verdict = await deps.consumeShared({
      access,
      endpoint: opts.endpoint,
      perMinute,
      perDay: metered && access.role !== "platform_admin" ? DAILY_FIRM_CAP : null,
    });
    verdict ??= rateLimitedLocally(access.userId) ? "minute" : "ok";
    if (verdict === "minute") {
      return res.status(429).json({ error: "Too many requests — slow down a moment." });
    }
    if (verdict === "day") {
      return res
        .status(429)
        .json({ error: "Your firm has reached today's usage limit. Try again tomorrow." });
    }

    try {
      const { status, payload } = await opts.run(parsed.body, access.userId);
      return res.status(status).json(payload);
    } catch {
      return res.status(500).json({ error: opts.failMessage });
    }
  };
}
