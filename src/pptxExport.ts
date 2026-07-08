import type { Item } from "./types";
import { priceLine } from "./util";
import { triggerDownload } from "./storage";
import logoSrc from "./assets/amy-morris-logo.png";

// PowerPoint tear-sheet export — one slide per item, replicating the print/PDF
// layout (TearSheetPrint + the .ts-page rules in App.css) exactly: a 7.5in x
// 13.333in portrait page with the logo at top, an optional room label, the
// product photo centered in the remaining space, and the taupe Calibri details
// block (name / dimensions / price / lead time) at the bottom.

// Geometry in inches, mirroring the @media print CSS.
const PAGE_W = 7.5;
const PAGE_H = 13.333;
const PAD_TOP = 0.5; // .ts-page padding-top
const PAD_SIDE = 0.36; // .ts-page side padding
const PAD_BOTTOM = 0.85; // .ts-page padding-bottom
const LOGO_W = 4.6; // .ts-logo width
const ROOM_GAP = 0.55; // .ts-room margin-top
const PHOTO_GAP = 0.45; // .ts-photo-wrap vertical margins
const PHOTO_MAX = 5.9; // .ts-photo max-width/max-height

const FONT = "Calibri";
const TAUPE = "907C67"; // .ts-page color
const FONT_PT = 18; // .ts-room / .ts-details font-size
const LINE_SPACING_PT = FONT_PT * 1.5; // .ts-details line-height
const LINE_IN = LINE_SPACING_PT / 72;

// The print view renders images at their natural CSS-pixel size (96/in),
// capped at PHOTO_MAX and never upscaled.
const CSS_DPI = 96;

// Placeholder card matching util.PLACEHOLDER_IMG (400x300 SVG); drawn as a
// shape because PowerPoint can't embed that SVG data URL.
const PH_W = 400 / CSS_DPI;
const PH_H = 300 / CSS_DPI;
const PH_FILL = "ECE8E1";
const PH_TEXT_COLOR = "B3A995";

/** A decoded image ready for embedding: data URL + natural pixel size. */
interface EmbeddableImage {
  data: string;
  w: number;
  h: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read image data."));
    r.readAsDataURL(blob);
  });
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      img.naturalWidth > 0
        ? resolve(img)
        : reject(new Error("Image decoded to zero size."));
    img.onerror = () => reject(new Error("Image could not be decoded."));
    img.src = dataUrl;
  });
}

// PowerPoint reliably renders JPEG/PNG/GIF; anything else (webp/avif/svg from a
// vendor CDN) is re-encoded to PNG via canvas. The pixels came from our own
// fetch/data URL, so the canvas is never tainted.
const PPTX_SAFE_MIME = new Set(["image/jpeg", "image/png", "image/gif"]);

function reencodeToPng(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Resolve an item image (stored data URL or remote product photo) into an
 * embeddable image. Remote fetches are best-effort: vendor CDNs without CORS
 * headers fail here, and the slide falls back to the "No image" placeholder
 * (mirroring the print view's onImgError fallback). Returns null on failure.
 */
async function loadImage(src: string): Promise<EmbeddableImage | null> {
  try {
    let dataUrl: string;
    if (src.startsWith("data:image/")) {
      dataUrl = src;
    } else {
      const url = new URL(src, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const res = await fetch(url.href, { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return null;
      dataUrl = await blobToDataUrl(blob);
    }
    const img = await decodeImage(dataUrl);
    const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
    if (!PPTX_SAFE_MIME.has(mime)) dataUrl = reencodeToPng(img);
    return { data: dataUrl, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

export interface PptxExportResult {
  slides: number;
  /** Items whose image URL couldn't be fetched/embedded (placeholder used). */
  missingImages: number;
}

/** Build and download a .pptx with one tear-sheet slide per item. */
export async function exportItemsToPptx(
  items: Item[],
  projectName: string
): Promise<PptxExportResult> {
  if (items.length === 0) return { slides: 0, missingImages: 0 };

  // Loaded on demand so the (large) pptx generator stays out of the main bundle.
  const { default: PptxGenJS } = await import("pptxgenjs");

  // Fetch the logo and every distinct item photo up front, in parallel.
  const cache = new Map<string, Promise<EmbeddableImage | null>>();
  const getImage = (u: string) => {
    let p = cache.get(u);
    if (!p) {
      p = loadImage(u);
      cache.set(u, p);
    }
    return p;
  };
  const [logo, ...images] = await Promise.all([
    getImage(logoSrc),
    ...items.map((it) => {
      const u = it.imageUrl.trim();
      return u ? getImage(u) : Promise.resolve(null);
    }),
  ]);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "TEAR_SHEET", width: PAGE_W, height: PAGE_H });
  pptx.layout = "TEAR_SHEET";
  pptx.title = projectName || "Tear Sheets";

  let missingImages = 0;

  items.forEach((it, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };

    // Logo, centered at the top.
    let contentTop = PAD_TOP;
    if (logo) {
      const h = (LOGO_W * logo.h) / logo.w;
      slide.addImage({
        data: logo.data,
        x: (PAGE_W - LOGO_W) / 2,
        y: contentTop,
        w: LOGO_W,
        h,
      });
      contentTop += h;
    }

    // Optional room label below the logo.
    const room = it.room.trim();
    if (room) {
      contentTop += ROOM_GAP;
      slide.addText(room, {
        x: PAD_SIDE,
        y: contentTop,
        w: PAGE_W - PAD_SIDE * 2,
        h: LINE_IN,
        fontFace: FONT,
        fontSize: FONT_PT,
        color: TAUPE,
        align: "center",
        valign: "top",
      });
      contentTop += LINE_IN;
    }

    // Details block, anchored to the bottom padding line.
    const lines = [it.name.trim() || "Untitled item"];
    const dims = it.dimensions.trim();
    if (dims) lines.push(`Dimensions: ${dims}`);
    const price = priceLine(it);
    if (price) lines.push(price);
    const lead = it.leadTime.trim();
    if (lead) lines.push(`Lead Time: ${lead}`);
    const detailsH = lines.length * LINE_IN;
    const detailsTop = PAGE_H - PAD_BOTTOM - detailsH;
    slide.addText(lines.join("\n"), {
      x: PAD_SIDE,
      y: detailsTop,
      w: PAGE_W - PAD_SIDE * 2,
      h: detailsH,
      fontFace: FONT,
      fontSize: FONT_PT,
      color: TAUPE,
      align: "center",
      valign: "middle",
      lineSpacing: LINE_SPACING_PT,
    });

    // Photo, centered in the space between the header block and the details.
    const areaTop = contentTop + PHOTO_GAP;
    const areaH = detailsTop - PHOTO_GAP - areaTop;
    const maxW = Math.min(PHOTO_MAX, PAGE_W - PAD_SIDE * 2);
    const maxH = Math.min(PHOTO_MAX, areaH);
    const img = images[i];
    if (img) {
      const natW = img.w / CSS_DPI;
      const natH = img.h / CSS_DPI;
      const scale = Math.min(maxW / natW, maxH / natH, 1);
      const w = natW * scale;
      const h = natH * scale;
      slide.addImage({
        data: img.data,
        x: (PAGE_W - w) / 2,
        y: areaTop + (areaH - h) / 2,
        w,
        h,
      });
    } else {
      if (it.imageUrl.trim()) missingImages++;
      // A filled text box (not a shape): text boxes default to no outline, so
      // no theme can draw a stray border around the placeholder.
      slide.addText("No image", {
        x: (PAGE_W - PH_W) / 2,
        y: areaTop + (areaH - PH_H) / 2,
        w: PH_W,
        h: PH_H,
        fill: { color: PH_FILL },
        fontFace: "Georgia",
        fontSize: 15,
        color: PH_TEXT_COLOR,
        align: "center",
        valign: "middle",
      });
    }
  });

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  const safe = projectName.replace(/[^\w-]+/g, "-") || "tear-sheet";
  triggerDownload(
    new Blob([blob], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
    `${safe}.pptx`
  );
  return { slides: items.length, missingImages };
}
