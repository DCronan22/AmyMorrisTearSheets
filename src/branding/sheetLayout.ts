import type { FirmStyle, Item, SheetTextKey, TextStyle } from "../types";
import { PAIRING_FONTS } from "../types";
import { priceLine, safeImageUrl, safeLogoUrl } from "../util";

// The tear-sheet page, in the units the layout is measured against.
export const PAGE_W_IN = 7.5;
export const PAGE_H_IN = 13.333;
export const PAGE_H_PT = PAGE_H_IN * 72; // 960pt tall — line heights advance in this

/** A laid-out text element, positioned as page fractions with a resolved style. */
export interface TextEl {
  t: "text";
  key: SheetTextKey;
  /** Which draggable box owns this element (detail lines all move as "details"). */
  group: "logo" | "room" | "details" | "footer";
  text: string;
  x: number;
  y: number;
  w: number;
  font: string;
  sizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}

/** A laid-out image element (logo scales to width; photo contain-fits its box). */
export interface ImageEl {
  t: "image";
  key: "logo" | "photo";
  group: "logo" | "photo";
  src: string;
  x: number;
  y: number;
  w: number;
  h?: number;
  fit: "width" | "contain";
}

export type SheetEl = TextEl | ImageEl;

/**
 * Resolve a firm's custom `sheet` layout + an item into a flat, fully-resolved
 * list of positioned elements (fonts, colors, and inheritance already applied).
 * Shared by the print/PDF renderer, the on-screen preview/editor, and the
 * PowerPoint export, so all three place things identically. Caller guarantees
 * `style.sheet` is non-null.
 */
export function layoutSheet(it: Item, style: FirmStyle, firmName: string): SheetEl[] {
  const sheet = style.sheet!;
  const pair = PAIRING_FONTS[style.font];
  const els: SheetEl[] = [];

  const resolveFont = (ts: TextStyle, slot: "head" | "body") =>
    ts.font || (slot === "head" ? pair.head : pair.body);
  const resolveColor = (ts: TextStyle, inherit: string) =>
    ts.color && /^#[0-9a-fA-F]{3,8}$/.test(ts.color) ? ts.color : inherit;

  // Logo image, or the firm-name wordmark when no logo is uploaded.
  const logo = safeLogoUrl(style.logoUrl);
  if (logo) {
    els.push({
      t: "image",
      key: "logo",
      group: "logo",
      src: logo,
      x: sheet.logo.x,
      y: sheet.logo.y,
      w: sheet.logo.w,
      fit: "width",
    });
  } else {
    const ts = sheet.text.wordmark;
    els.push({
      t: "text",
      key: "wordmark",
      group: "logo",
      text: style.coverTitle.trim() || firmName,
      x: sheet.logo.x,
      y: sheet.logo.y,
      w: sheet.logo.w,
      font: resolveFont(ts, "head"),
      sizePt: ts.size,
      color: resolveColor(ts, style.accentColor),
      bold: ts.bold,
      italic: ts.italic,
      align: ts.align,
    });
  }

  // Optional room label.
  if (style.showRoom && it.room.trim()) {
    const ts = sheet.text.room;
    els.push({
      t: "text",
      key: "room",
      group: "room",
      text: it.room.trim(),
      x: sheet.room.x,
      y: sheet.room.y,
      w: sheet.room.w,
      font: resolveFont(ts, "body"),
      sizePt: ts.size,
      color: resolveColor(ts, style.accentColor),
      bold: ts.bold,
      italic: ts.italic,
      align: ts.align,
    });
  }

  // Product photo (contain-fit within its box).
  els.push({
    t: "image",
    key: "photo",
    group: "photo",
    src: safeImageUrl(it.imageUrl),
    x: sheet.photo.x,
    y: sheet.photo.y,
    w: sheet.photo.w,
    h: sheet.photo.h,
    fit: "contain",
  });

  // Details — a stack of independently-styled lines that all move as one group.
  const lines: { key: SheetTextKey; text: string }[] = [
    { key: "name", text: it.name.trim() || "Untitled item" },
  ];
  if (style.showSku && it.sku.trim()) lines.push({ key: "sku", text: `SKU: ${it.sku.trim()}` });
  if (style.showDimensions && it.dimensions.trim())
    lines.push({ key: "dimensions", text: `Dimensions: ${it.dimensions.trim()}` });
  const pl = priceLine(it);
  if (style.showPrice && pl) lines.push({ key: "price", text: pl });
  if (it.leadTime.trim()) lines.push({ key: "leadTime", text: `Lead Time: ${it.leadTime.trim()}` });

  let cursorY = sheet.details.y;
  for (const ln of lines) {
    const ts = sheet.text[ln.key];
    els.push({
      t: "text",
      key: ln.key,
      group: "details",
      text: ln.text,
      x: sheet.details.x,
      y: cursorY,
      w: sheet.details.w,
      font: resolveFont(ts, "body"),
      sizePt: ts.size,
      color: resolveColor(ts, style.textColor),
      bold: ts.bold,
      italic: ts.italic,
      align: ts.align,
    });
    cursorY += ts.size / PAGE_H_PT; // advance one (single-spaced) line
  }

  // Optional footer tagline.
  const footer = style.footerText.trim();
  if (footer) {
    const ts = sheet.text.footer;
    els.push({
      t: "text",
      key: "footer",
      group: "footer",
      text: footer,
      x: sheet.footer.x,
      y: sheet.footer.y,
      w: sheet.footer.w,
      font: resolveFont(ts, "body"),
      sizePt: ts.size,
      color: resolveColor(ts, style.accentColor),
      bold: ts.bold,
      italic: ts.italic,
      align: ts.align,
    });
  }

  return els;
}

/** A representative sample item for the editor/preview canvas. */
export function sampleSheetItem(): Item {
  return {
    id: "sample",
    name: "Lawson Sofa",
    vendor: "Vanguard",
    collection: "",
    category: "Seating",
    room: "Living Room",
    sku: "LS-204",
    price: 3200,
    quantity: 1,
    dimensions: '84"W × 38"D × 31"H',
    material: "Performance linen",
    color: "Flax",
    leadTime: "8–10 weeks",
    notes: "",
    imageUrl: "",
    productUrl: "",
    upholstered: true,
  };
}
