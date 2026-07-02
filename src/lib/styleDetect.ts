import { authedPostJson, apiErrorMessage } from "./api";
import type { DetectedStyle } from "../types";

export interface DetectStyleResult {
  style: DetectedStyle;
  /** True when the server has no AI key configured yet (feature dormant). */
  disabled: boolean;
  warnings: string[];
}

/**
 * Ask the server to analyze an uploaded sample tear sheet and suggest a style.
 *
 * This is wired end-to-end but DORMANT until ANTHROPIC_API_KEY is set on the
 * server — until then the endpoint returns 503 and we surface `disabled: true`
 * so the UI can explain it nicely instead of throwing. The day the key is added
 * it starts working with no further code changes.
 */
export async function detectStyleFromSample(
  image: string
): Promise<DetectStyleResult> {
  const { res, json } = await authedPostJson("/api/detect-style", { image });

  if (res.status === 503) {
    const msg = apiErrorMessage(json, "AI style detection isn't enabled yet.");
    return { style: {}, disabled: true, warnings: [msg] };
  }
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(json, "Couldn't analyze that sample. Try another image.")
    );
  }
  const body = json as { style?: DetectedStyle; warnings?: string[] };
  return {
    style: body.style ?? {},
    disabled: false,
    warnings: body.warnings ?? [],
  };
}
