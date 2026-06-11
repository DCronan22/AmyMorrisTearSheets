// Shared style-detection orchestrator, used by both the Vercel serverless
// handler (api/detect-style.ts) and the local Vite dev middleware. Auth + rate
// limiting are handled by the callers before this runs.
import {
  detectStyleAvailable,
  detectStyleFromImage,
} from "./style-ai.js";
import type { DetectedStyle } from "./style-ai.js";

export interface StyleDetectRequest {
  image?: string; // data URL of the sample tear sheet
}

export interface StyleDetectResult {
  style: DetectedStyle;
  warnings: string[];
}

const MAX_IMAGE_BYTES = 5_000_000; // ~5 MB decoded
const IMAGE_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export async function runStyleDetect(
  body: StyleDetectRequest
): Promise<{ status: number; payload: StyleDetectResult | { error: string; disabled?: boolean } }> {
  if (!body.image) {
    return { status: 400, payload: { error: "Provide a sample image." } };
  }
  // Dormant until the Anthropic key is configured — surface a clear flag.
  if (!detectStyleAvailable()) {
    return {
      status: 503,
      payload: {
        error: "AI style detection isn't enabled yet.",
        disabled: true,
      },
    };
  }
  const m = IMAGE_RE.exec(body.image.trim());
  if (!m) {
    return { status: 400, payload: { error: "Unsupported image format." } };
  }
  const mediaType = m[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  const base64 = m[2];
  if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return { status: 413, payload: { error: "Image is too large (max ~5 MB)." } };
  }
  try {
    const style = await detectStyleFromImage(base64, mediaType);
    return {
      status: 200,
      payload: {
        style,
        warnings: Object.keys(style).length
          ? []
          : ["Couldn't read a clear style from that sample."],
      },
    };
  } catch {
    return { status: 502, payload: { error: "That sample couldn't be analyzed." } };
  }
}
