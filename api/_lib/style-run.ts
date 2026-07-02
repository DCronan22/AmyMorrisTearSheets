// Shared style-detection orchestrator, used by both the Vercel serverless
// handler (api/detect-style.ts) and the local Vite dev middleware. Auth + rate
// limiting are handled by the callers before this runs.
import { detectStyleFromImage } from "./style-ai.js";
import type { DetectedStyle } from "./style-ai.js";
import { aiAvailable, parseImageDataUrl } from "./anthropic.js";

export interface StyleDetectRequest {
  image?: string; // data URL of the sample tear sheet
}

export interface StyleDetectResult {
  style: DetectedStyle;
  warnings: string[];
}

const MAX_IMAGE_BYTES = 5_000_000; // ~5 MB decoded

export async function runStyleDetect(
  body: StyleDetectRequest
): Promise<{ status: number; payload: StyleDetectResult | { error: string; disabled?: boolean } }> {
  if (!body.image) {
    return { status: 400, payload: { error: "Provide a sample image." } };
  }
  // Dormant until the Anthropic key is configured — surface a clear flag.
  if (!aiAvailable()) {
    return {
      status: 503,
      payload: {
        error: "AI style detection isn't enabled yet.",
        disabled: true,
      },
    };
  }
  const img = parseImageDataUrl(body.image, MAX_IMAGE_BYTES);
  if ("error" in img) {
    return { status: img.status, payload: { error: img.error } };
  }
  try {
    const style = await detectStyleFromImage(img.base64, img.mediaType);
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
