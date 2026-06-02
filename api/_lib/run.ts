// Shared extraction orchestrator, used by both the Vercel serverless handler
// (api/extract.ts) and the local Vite dev middleware. Auth + rate limiting are
// handled by the callers before this runs.
import { extractFromUrl, fetchReadableText } from "./extract-core";
import type { ExtractedFields, ExtractResult } from "./extract-core";
import {
  aiExtractAvailable,
  aiExtractFromImage,
  aiExtractFromText,
} from "./ai-extract";

export interface ExtractRequest {
  url?: string;
  text?: string;
  image?: string; // data URL
  aiFallback?: boolean; // allow paid AI fallback for messy URL pages
}

const MAX_IMAGE_BYTES = 4_000_000; // ~4 MB decoded
const IMAGE_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

function hasData(f: ExtractedFields): boolean {
  return Object.entries(f).some(
    ([k, v]) => k !== "productUrl" && v !== undefined && v !== null && v !== ""
  );
}

export async function runExtraction(
  body: ExtractRequest
): Promise<{ status: number; payload: ExtractResult | { error: string } }> {
  // --- Image upload → AI vision ---
  if (body.image) {
    if (!aiExtractAvailable()) {
      return { status: 503, payload: { error: "Image extraction isn't enabled on this server." } };
    }
    const m = IMAGE_RE.exec(body.image.trim());
    if (!m) {
      return { status: 400, payload: { error: "Unsupported image format." } };
    }
    const mediaType = m[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    const base64 = m[2];
    if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return { status: 413, payload: { error: "Image is too large (max ~4 MB)." } };
    }
    try {
      const fields = await aiExtractFromImage(base64, mediaType);
      return {
        status: 200,
        payload: {
          fields,
          source: "ai",
          warnings: hasData(fields) ? [] : ["Couldn't read product details from that image."],
        },
      };
    } catch {
      return { status: 502, payload: { error: "The image couldn't be analyzed." } };
    }
  }

  // --- URL → free structured data, optional AI fallback ---
  if (body.url) {
    let result: ExtractResult;
    try {
      result = await extractFromUrl(body.url);
    } catch (e) {
      return { status: 400, payload: { error: e instanceof Error ? e.message : "Couldn't read that link." } };
    }
    if (!hasData(result.fields) && body.aiFallback && aiExtractAvailable()) {
      try {
        const { text, finalUrl } = await fetchReadableText(body.url);
        const fields = await aiExtractFromText(text);
        fields.productUrl = finalUrl;
        return {
          status: 200,
          payload: {
            fields,
            source: "ai",
            warnings: hasData(fields) ? [] : ["Couldn't find product details on that page."],
          },
        };
      } catch {
        // Fall through to the (empty) structured result.
      }
    }
    return { status: 200, payload: result };
  }

  // --- Raw text → AI ---
  if (body.text) {
    if (!aiExtractAvailable()) {
      return { status: 503, payload: { error: "Text extraction isn't enabled on this server." } };
    }
    try {
      const fields = await aiExtractFromText(body.text);
      return {
        status: 200,
        payload: { fields, source: "ai", warnings: hasData(fields) ? [] : ["No product details found."] },
      };
    } catch {
      return { status: 502, payload: { error: "That text couldn't be analyzed." } };
    }
  }

  return { status: 400, payload: { error: "Provide a url, image, or text." } };
}
