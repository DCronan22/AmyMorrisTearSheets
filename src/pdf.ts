import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
  ImageKind,
} from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
// Vite bundles the worker as a hashed asset and hands us its URL. This keeps the
// PDF importer fully client-side (no server round-trip, matching the pptx/xlsx
// importers) while running the heavy parsing off the main thread.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Item } from "./types";
import { emptyItem } from "./types";
import { compressImageFile } from "./lib/extract";
import { parseTearSheetLines } from "./pptx";
import type { ImportResult } from "./spreadsheet";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Import a PDF tear-sheet document. Each page becomes one item: the page text is
 * parsed for name / dimensions / price / lead time / room (the same logic the
 * PowerPoint importer uses), and the largest non-banner image on the page
 * becomes the product photo. Pages with no image fall back to a rendered picture
 * of the page so there's always a visual. A PDF has no server round-trip — pdf.js
 * reads it entirely in the browser.
 */
export async function parsePdf(file: File): Promise<ImportResult> {
  let loadingTask: ReturnType<typeof getDocument>;
  let doc: PDFDocumentProxy;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    loadingTask = getDocument({ data: buf });
    doc = await loadingTask.promise;
  } catch {
    // Not a readable PDF (corrupt, truncated, encrypted, or the wrong file
    // type): nothing to import, so return empty rather than throwing.
    return { items: [], matchedColumns: [], skippedRows: 0 };
  }

  const items: Item[] = [];
  const fieldsSeen = new Set<string>();
  let skipped = 0;

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      let page: PDFPageProxy | null = null;
      try {
        page = await doc.getPage(n);
        const lines = await pageLines(page);
        const parsed = parseTearSheetLines(lines);

        const imageUrl = await pageImage(page);
        // A usable tear sheet needs at least a name or a product photo.
        if (!parsed.name && !imageUrl) {
          skipped++;
          continue;
        }

        const item = emptyItem();
        if (parsed.name) {
          item.name = parsed.name;
          fieldsSeen.add("Item");
        }
        if (parsed.room) {
          item.room = parsed.room;
          fieldsSeen.add("Room");
        }
        if (parsed.dimensions) {
          item.dimensions = parsed.dimensions;
          fieldsSeen.add("Dimensions");
        }
        if (parsed.leadTime) {
          item.leadTime = parsed.leadTime;
          fieldsSeen.add("Lead Time");
        }
        if (parsed.price !== null) {
          item.price = parsed.price;
          fieldsSeen.add("Price");
        }
        item.upholstered = parsed.upholstered;
        if (imageUrl) {
          item.imageUrl = imageUrl;
          fieldsSeen.add("Photo");
        }

        items.push(item);
      } catch {
        // A single malformed page shouldn't abort the whole document.
        skipped++;
      } finally {
        // Release the page's decoded resources before moving on.
        page?.cleanup();
      }
    }
  } finally {
    // Tear down the worker transport and free the document's resources.
    await loadingTask.destroy();
  }

  return { items, matchedColumns: [...fieldsSeen], skippedRows: skipped };
}

/**
 * Reconstruct a page's logical text lines in reading order. pdf.js hands back
 * individually positioned text runs; we bucket them into lines by their vertical
 * position (PDF y grows upward, so top-to-bottom is descending y) and order each
 * line left-to-right, inserting a space where runs sit far enough apart to be
 * separate words.
 */
async function pageLines(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent();
  const rows: { y: number; glyphs: { x: number; w: number; str: string }[] }[] =
    [];
  for (const raw of content.items) {
    const it = raw as TextItem;
    if (typeof it.str !== "string" || it.str.length === 0) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    // First row within ~3 user units of this baseline; otherwise a new line.
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) {
      row = { y, glyphs: [] };
      rows.push(row);
    }
    row.glyphs.push({ x, w: it.width ?? 0, str: it.str });
  }

  rows.sort((a, b) => b.y - a.y);
  const lines: string[] = [];
  for (const row of rows) {
    row.glyphs.sort((a, b) => a.x - b.x);
    let s = "";
    let prevEnd: number | null = null;
    for (const g of row.glyphs) {
      if (
        prevEnd !== null &&
        g.x - prevEnd > 1 &&
        !/\s$/.test(s) &&
        !/^\s/.test(g.str)
      ) {
        s += " ";
      }
      s += g.str;
      prevEnd = g.x + g.w;
    }
    const line = s.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Choose the product photo for a page. Prefers the largest embedded raster image
 * that isn't a wide logo/banner strip (mirroring the PowerPoint importer); if the
 * page embeds no usable image, renders the whole page as a fallback picture. The
 * result is a compressed JPEG data URL, or "" if nothing could be produced.
 */
async function pageImage(page: PDFPageProxy): Promise<string> {
  const best = await largestEmbeddedImage(page);
  const canvas = best ?? (await renderPage(page));
  if (!canvas) return "";
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
    );
    if (!blob) return "";
    const file = new File([blob], "page.jpg", { type: "image/jpeg" });
    // Downscale/re-compress through the shared pipeline so the stored row stays
    // small, exactly like the pptx and screenshot paths.
    return await compressImageFile(file);
  } catch {
    return "";
  }
}

interface RawImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap;
}

/**
 * Find the largest embedded raster image drawn on the page and paint it onto a
 * canvas. Banner-shaped strips (very wide or very tall aspect ratios) are treated
 * as logos and skipped, matching the pptx image chooser. Returns null when the
 * page has no usable embedded image.
 */
async function largestEmbeddedImage(
  page: PDFPageProxy
): Promise<HTMLCanvasElement | null> {
  const ops = await page.getOperatorList();
  const candidates: RawImage[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    try {
      if (fn === OPS.paintImageXObject) {
        const name = ops.argsArray[i][0] as string;
        const img = await getPageObject(page, name);
        if (img) candidates.push(img);
      } else if (fn === OPS.paintInlineImageXObject) {
        // The image object is passed inline as the argument itself.
        const img = ops.argsArray[i][0] as RawImage;
        if (img && img.width && img.height) candidates.push(img);
      }
    } catch {
      // Skip an image that can't be resolved; keep scanning the rest.
    }
  }

  let best: RawImage | null = null;
  let bestArea = 0;
  for (const img of candidates) {
    const { width: w, height: h } = img;
    if (!w || !h) continue;
    const aspect = w / h;
    // Drop wide logo/banner strips and razor-thin rules; keep genuine product
    // shots (including tall lamps/mirrors), same bounds as the pptx chooser.
    if (aspect > 3 || aspect < 1 / 5) continue;
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = img;
    }
  }
  return best ? rawImageToCanvas(best) : null;
}

/** Resolve a named page object (image), with a guard so a stuck object can't hang. */
function getPageObject(
  page: PDFPageProxy,
  name: string
): Promise<RawImage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: RawImage | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    // If the object never resolves, don't leave the import hanging on this page.
    const timer = setTimeout(() => done(null), 4000);
    try {
      page.objs.get(name, (obj: unknown) => {
        clearTimeout(timer);
        done((obj as RawImage) ?? null);
      });
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/** Paint a decoded pdf.js image (bitmap or raw pixel buffer) onto a canvas. */
function rawImageToCanvas(img: RawImage): HTMLCanvasElement | null {
  const w = img.width;
  const h = img.height;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }

  const data = img.data;
  if (!data) return null;
  const rgba = new Uint8ClampedArray(w * h * 4);
  if (img.kind === ImageKind.RGBA_32BPP || data.length === w * h * 4) {
    rgba.set(data.subarray(0, w * h * 4));
  } else if (img.kind === ImageKind.RGB_24BPP || data.length === w * h * 3) {
    for (let i = 0, j = 0; i < w * h; i++) {
      rgba[j++] = data[i * 3];
      rgba[j++] = data[i * 3 + 1];
      rgba[j++] = data[i * 3 + 2];
      rgba[j++] = 255;
    }
  } else if (img.kind === ImageKind.GRAYSCALE_1BPP) {
    // 1 bit per pixel, rows padded to whole bytes; expand to opaque grayscale.
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const j = (y * w + x) * 4;
        rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
        rgba[j + 3] = 255;
      }
    }
  } else {
    return null;
  }
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas;
}

/**
 * Render an entire page to a canvas as a fallback photo — used when a page draws
 * its artwork in a way we can't pull out as a single image (vector art, tiled
 * patterns, or an image-only scan). The text is still parsed separately for the
 * item's fields.
 */
async function renderPage(page: PDFPageProxy): Promise<HTMLCanvasElement | null> {
  try {
    // ~1.5x device scale gives a crisp photo; compressImageFile downsizes after.
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas;
  } catch {
    return null;
  }
}
