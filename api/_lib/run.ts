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

// Fields we consider "key" for deciding whether AI gap-filling is worthwhile.
const KEY_FIELDS: (keyof ExtractedFields)[] = [
  "vendor",
  "category",
  "sku",
  "price",
  "dimensions",
  "material",
  "color",
];

/** Count how many key fields are still empty/null in a structured result. */
function missingKeyCount(f: ExtractedFields): number {
  return KEY_FIELDS.filter((k) => {
    const v = f[k];
    return v === undefined || v === null || v === "";
  }).length;
}

/** Merge AI fields into the structured result: structured wins; AI fills blanks. */
function fillBlanks(
  structured: ExtractedFields,
  ai: ExtractedFields
): ExtractedFields {
  const out: ExtractedFields = { ...structured };
  for (const [k, v] of Object.entries(ai)) {
    if (v === undefined || v === null || v === "") continue;
    const cur = (out as Record<string, unknown>)[k];
    if (cur === undefined || cur === null || cur === "") {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
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
    // After free structured extraction, optionally have the AI fill blanks
    // when several key fields are still missing. The structured value always
    // wins; the AI only fills fields that are empty.
    if (
      missingKeyCount(result.fields) >= 3 &&
      body.aiFallback &&
      aiExtractAvailable()
    ) {
      try {
        const { text, finalUrl } = await fetchReadableText(body.url);
        const aiFields = await aiExtractFromText(text);
        const merged = fillBlanks(result.fields, aiFields);
        merged.productUrl = result.fields.productUrl ?? finalUrl;
        return {
          status: 200,
          payload: {
            fields: merged,
            source: hasData(result.fields) ? "structured" : "ai",
            warnings: hasData(merged)
              ? []
              : ["Couldn't find product details on that page."],
          },
        };
      } catch {
        // Fall through to the (improved) structured result.
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
