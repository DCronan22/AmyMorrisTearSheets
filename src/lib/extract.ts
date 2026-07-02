import { authedPostJson, apiErrorMessage } from "./api";

// Fields the extractor may return (mirrors the server's ExtractedFields).
export interface AutofillFields {
  name?: string;
  vendor?: string;
  collection?: string;
  category?: string;
  sku?: string;
  price?: number | null;
  dimensions?: string;
  material?: string;
  color?: string;
  imageUrl?: string;
  productUrl?: string;
}

export interface AutofillResult {
  fields: AutofillFields;
  source: "structured" | "ai" | "none";
  warnings: string[];
}

/** Call the server-side extractor with the current user's access token. */
export async function autofill(input: {
  url?: string;
  image?: string;
  text?: string;
  aiFallback?: boolean;
}): Promise<AutofillResult> {
  const { res, json } = await authedPostJson("/api/extract", input);
  if (!res.ok) {
    throw new Error(apiErrorMessage(json, "Auto-fill failed. Try again."));
  }
  return json as AutofillResult;
}

/** Shared downscale-to-data-URL pipeline for the two compressors below. */
function compressImage(
  file: File,
  opts: { maxDim: number; mime: "image/png" | "image/jpeg"; quality?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        const scale = Math.min(1, opts.maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Image processing unavailable."));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL(opts.mime, opts.quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale a logo to a small PNG data URL, preserving transparency (unlike the
 * JPEG path below). Logos are small, so this stays well within the row budget.
 */
export function compressLogoFile(file: File, maxDim = 480): Promise<string> {
  return compressImage(file, { maxDim, mime: "image/png" });
}

/**
 * Downscale + compress an image file to a small JPEG data URL before storing.
 * Keeps the database row tiny (the cost auditor's #1 issue) and the upload fast.
 */
export function compressImageFile(
  file: File,
  maxDim = 1280,
  quality = 0.82
): Promise<string> {
  return compressImage(file, { maxDim, mime: "image/jpeg", quality });
}
