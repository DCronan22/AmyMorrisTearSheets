import type { FirmStyle, InventoryItem } from "./types";
import { safeLogoUrl } from "./util";
import { loadImage } from "./pptxExport";
import type { EmbeddableImage, PptxExportResult } from "./pptxExport";
import {
  FORM,
  FORM_LAYOUT as L,
  FORM_TITLE,
  inventoryFormRows,
} from "./inventoryForm";

// PowerPoint rendering of the firm's "INVENTORY DETAIL FORM" — the same page
// the Word export (src/docxExport.ts) and the print/PDF layout
// (src/components/InventoryFormPrint.tsx) produce.
//
// All three read their wording, value formatting and geometry from
// src/inventoryForm.ts and place every block at the same absolute page
// coordinates, so the three outputs are one form rather than three
// approximations of it. Slides are US Letter portrait to match.

/** Georgia is what the firm's form is set in, run by run. */
const FONT = "Georgia";

/** Fit a photo to the reference width, keeping its aspect ratio. */
function photoSize(img: EmbeddableImage): { w: number; h: number } {
  const w = FORM.photoW;
  const h = (img.h / img.w) * w;
  // Never let a very tall photo escape the box.
  const maxH = FORM.boxH - (L.photoY - L.boxY) * 2;
  return h <= maxH ? { w, h } : { w: (img.w / img.h) * maxH, h: maxH };
}

/**
 * Build and download a .pptx with one inventory detail form per entry.
 * Returns how many entries fell back to an empty photo box because their
 * photo could not be fetched (a vendor CDN without CORS headers).
 */
export async function exportInventoryFormsToPptx(
  items: InventoryItem[],
  fileName: string,
  branding: { style: FirmStyle; firmName: string }
): Promise<PptxExportResult> {
  const { style, firmName } = branding;
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();

  pptx.defineLayout({
    name: "INVENTORY_FORM",
    width: FORM.pageW,
    height: FORM.pageH,
  });
  pptx.layout = "INVENTORY_FORM";

  // The letterhead logo is fetched once and reused on every slide.
  const logoSrc = safeLogoUrl(style.logoUrl);
  const logo = logoSrc ? await loadImage(logoSrc) : null;
  const footer = style.footerText.trim();

  let missingImages = 0;

  for (const item of items) {
    const slide = pptx.addSlide();

    // ── Letterhead ────────────────────────────────────────────────────────
    if (logo) {
      const h = FORM.logoH;
      const w = (logo.w / logo.h) * h;
      slide.addImage({
        data: logo.data,
        x: L.contentX + (L.contentW - w) / 2,
        y: L.logoY,
        w,
        h,
      });
    } else {
      // Same fallback as the Word and tear-sheet exports: the firm's name.
      slide.addText(firmName, {
        x: L.contentX,
        y: L.logoY,
        w: L.contentW,
        h: FORM.logoH,
        align: "center",
        valign: "middle",
        fontFace: FONT,
        fontSize: FORM.wordmarkPt,
        color: "000000",
        fit: "shrink",
      });
    }

    // ── Title ─────────────────────────────────────────────────────────────
    slide.addText(FORM_TITLE, {
      x: L.contentX,
      y: L.titleY,
      w: L.contentW,
      h: L.titleH,
      align: "center",
      valign: "middle",
      fontFace: FONT,
      fontSize: FORM.titlePt,
      bold: true,
      color: "000000",
      margin: 0,
    });

    // ── Field lines ───────────────────────────────────────────────────────
    // Each line is its own text box at its measured y, so the rows land on the
    // same baselines the print layout uses.
    inventoryFormRows(item).forEach((row, i) => {
      const y = L.fieldsY + i * L.lineH;
      const common = {
        h: L.lineH,
        valign: "middle" as const,
        fontFace: FONT,
        fontSize: FORM.bodyPt,
        color: "000000",
        margin: 0,
      };
      slide.addText(
        [
          { text: row.left.label, options: { bold: true } },
          { text: ` ${row.left.value}`, options: { bold: false } },
        ],
        { ...common, x: L.contentX, y, w: FORM.secondCol }
      );
      if (row.right) {
        slide.addText(
          [
            { text: row.right.label, options: { bold: true } },
            { text: ` ${row.right.value}`, options: { bold: false } },
          ],
          {
            ...common,
            x: L.contentX + FORM.secondCol,
            y,
            w: L.contentW - FORM.secondCol,
          }
        );
      }
    });

    // ── Photo box ─────────────────────────────────────────────────────────
    // Drawn as a rectangle with a hairline black outline and a white fill —
    // it prints even when the entry has no photo, like a blank form.
    slide.addShape(pptx.ShapeType.rect, {
      x: L.boxX,
      y: L.boxY,
      w: FORM.boxW,
      h: FORM.boxH,
      fill: { color: "FFFFFF" },
      line: { color: "000000", width: FORM.borderPt },
    });

    if (item.imageUrl) {
      const img = await loadImage(item.imageUrl);
      if (img) {
        const { w, h } = photoSize(img);
        slide.addImage({ data: img.data, x: L.photoX, y: L.photoY, w, h });
      } else {
        missingImages += 1;
      }
    }

    // ── Footer tagline ────────────────────────────────────────────────────
    if (footer) {
      slide.addText(footer, {
        x: L.contentX,
        y: L.footerY,
        w: L.contentW,
        h: FORM.footerPt / 72,
        align: "center",
        valign: "middle",
        fontFace: FONT,
        fontSize: FORM.footerPt,
        color: "000000",
        margin: 0,
      });
    }
  }

  await pptx.writeFile({ fileName: `${fileName}.pptx` });
  return { slides: items.length, missingImages };
}
