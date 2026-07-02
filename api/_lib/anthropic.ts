// Shared Anthropic plumbing for the AI endpoints (ai-extract.ts, style-ai.ts).
// SERVER-SIDE ONLY: reads ANTHROPIC_API_KEY from process.env, never the client.
import Anthropic from "@anthropic-ai/sdk";

// Haiku is the deliberate, cost-driven choice for extraction/detection.
export const MODEL = "claude-haiku-4-5";

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI is not configured on the server.");
  client ??= new Anthropic({ apiKey: key });
  return client;
}

/** True when the server has an Anthropic key configured. */
export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// A model can occasionally leak its own tool-call delimiters (e.g.
// "<parameter name=...>", "</antml...parameter>") as literal text inside a
// string value. Strict tool use guarantees JSON shape, not clean string
// contents. Legitimate product specs / style text never contain tag markup, so
// cut the value at the first tag-like fragment ("<" + optional "/" + a letter)
// and trim.
export function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.split(/<\s*\/?\s*[A-Za-z]/)[0].trim();
  return s ? s : undefined;
}

// Stable system block carries a cache breakpoint; tool lists are deterministic.
// (Prefix may be below Haiku's 4K cache minimum, in which case caching is a
//  no-op — harmless, and it kicks in for free if the prompt grows.)
export function systemBlocks(prompt: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }];
}

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const IMAGE_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Validate an uploaded data-URL image for the vision endpoints and enforce a
 * decoded-size cap. Returns the parts Anthropic needs, or an HTTP-ready error.
 */
export function parseImageDataUrl(
  dataUrl: string,
  maxBytes: number
):
  | { mediaType: ImageMediaType; base64: string }
  | { error: string; status: number } {
  const m = IMAGE_RE.exec(dataUrl.trim());
  if (!m) return { error: "Unsupported image format.", status: 400 };
  if ((m[2].length * 3) / 4 > maxBytes) {
    return {
      error: `Image is too large (max ~${Math.round(maxBytes / 1e6)} MB).`,
      status: 413,
    };
  }
  return { mediaType: m[1] as ImageMediaType, base64: m[2] };
}
