import type { InventoryItem } from "./types";

// The firm's "INVENTORY DETAIL FORM" — one shared description of the form, so
// the three ways it can leave the app (Word, print/PDF, PowerPoint) cannot
// drift apart. The Word exporter (src/docxExport.ts) was built by measuring the
// firm's own document; every number below is that measurement converted out of
// Word's units, and every label is the wording the firm's form prints.
//
// Change a label or a measurement here and all three outputs move together.

const EMU_PER_IN = 914400;
const TWIPS_PER_IN = 1440;

/** Geometry, in inches, measured from the reference document. */
export const FORM = {
  /** US Letter portrait. */
  pageW: 12240 / TWIPS_PER_IN, // 8.5
  pageH: 15840 / TWIPS_PER_IN, // 11
  /** w:pgMar — 0.5in on all four sides. */
  margin: 720 / TWIPS_PER_IN,
  /** The letterhead logo's height; its width follows the image's aspect. */
  logoH: 871220 / EMU_PER_IN, // 0.9528
  /** The hairline-bordered photo box. */
  boxW: 3305175 / EMU_PER_IN, // 3.6145
  boxH: 3057525 / EMU_PER_IN, // 3.3438
  /** Photo width inside the box; its height follows the photo's aspect. */
  photoW: 2286000 / EMU_PER_IN, // 2.5
  /** w:ind firstLine on the photo paragraph — the photo's inset in the box. */
  photoIndent: 720 / TWIPS_PER_IN, // 0.5
  /** a:ln w — the box's 0.75pt black rule. */
  borderPt: 9525 / 12700, // 0.75
  /** Half-point run sizes off the reference, as points. */
  titlePt: 36 / 2, // 18
  bodyPt: 22 / 2, // 11
  wordmarkPt: 84 / 2, // 42, when a firm has no logo
  footerPt: 22 / 2, // 11
  /**
   * Field paragraphs carry w:spacing line=480 lineRule=auto. Word's "auto"
   * rule counts 240 twips as one line, so 480 is exactly double spacing.
   */
  lineMultiple: 480 / 240, // 2
  /**
   * Where the second field on a shared line begins, measured from the left
   * margin. The reference reaches it with tab runs against Word's 720-twip
   * default tab stop; for the value lengths this form actually carries (a
   * MM/DD/YY date, a whole-dollar price) those tabs land on the 2in stop.
   */
  secondCol: 2,
} as const;

export const FORM_TITLE = "INVENTORY DETAIL FORM";

const PT_PER_IN = 72;
/** A double-spaced 11pt field line. */
const LINE_H = (FORM.bodyPt * FORM.lineMultiple) / PT_PER_IN;
/** The title's own line box. */
const TITLE_H = (FORM.titlePt * 1.15) / PT_PER_IN;
/** The two blank body lines the reference puts either side of the title. */
const BLANK_RUN = (2 * FORM.bodyPt * 1.15) / PT_PER_IN;
/** Eight field lines. */
const FIELD_COUNT = 8;

const contentW = FORM.pageW - 2 * FORM.margin;
const titleY = FORM.margin + FORM.logoH + BLANK_RUN;
const fieldsY = titleY + TITLE_H + BLANK_RUN;
const boxY = fieldsY + FIELD_COUNT * LINE_H + LINE_H;
const boxX = FORM.margin + (contentW - FORM.boxW) / 2;

/**
 * Absolute positions on the page, in inches from the top-left corner.
 *
 * The print/PDF layout and the PowerPoint layout both position from this, so
 * the two are the same page rather than two independent approximations of it.
 */
export const FORM_LAYOUT = {
  contentX: FORM.margin,
  contentW,
  lineH: LINE_H,
  logoY: FORM.margin,
  titleY,
  titleH: TITLE_H,
  fieldsY,
  fieldsH: FIELD_COUNT * LINE_H,
  boxX,
  boxY,
  /** The photo's inset inside the box. */
  photoX: boxX + FORM.photoIndent,
  photoY: boxY + FORM.bodyPt / 2 / PT_PER_IN,
  footerY: boxY + FORM.boxH + 12 / PT_PER_IN,
} as const;

/** The labels, exactly as the firm's form prints them. */
export const FORM_LABELS = {
  description: "Item Description:",
  date: "Date:",
  quantity: "Quantity:",
  vendor: "Vendor:",
  netPrice: "Net Price:",
  retailPrice: "Retail Price:",
  sidemark: "Purchased For / Client / Sidemark:",
  notes: "Notes (fabric info, finish, size, damages, etc.):",
  inventoryNumber: "Inventory Number:",
  poNumber: "Purchase Order Number:",
} as const;

/** Collapse whitespace; the form's fields are single-line. */
export function oneLine(v: string | undefined | null): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

/** MM/DD/YY, the way the firm fills the form in. */
export function formDate(iso: string | undefined): string {
  const v = oneLine(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : v;
}

/** Whole dollars, no thousands separator and no cents — as the form shows. */
export function formPrice(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n)
    ? ""
    : `$${Math.round(n)}`;
}

export interface FormField {
  /** Printed bold. */
  label: string;
  /** Printed at regular weight. Empty when the entry has no value. */
  value: string;
}

/** One printed line: one field, or two sharing the line. */
export interface FormRow {
  left: FormField;
  right?: FormField;
}

/**
 * The eight field lines, in the order the firm's form prints them. Retail
 * falls back to `price` for entries saved before the net/retail split, exactly
 * as the Word exporter does (see syncStockPricing).
 */
export function inventoryFormRows(item: InventoryItem): FormRow[] {
  return [
    { left: { label: FORM_LABELS.description, value: oneLine(item.name) } },
    {
      left: { label: FORM_LABELS.date, value: formDate(item.acquiredDate) },
      right: { label: FORM_LABELS.quantity, value: String(item.quantity) },
    },
    { left: { label: FORM_LABELS.vendor, value: oneLine(item.vendor) } },
    {
      left: { label: FORM_LABELS.netPrice, value: formPrice(item.netPrice) },
      right: {
        label: FORM_LABELS.retailPrice,
        value: formPrice(item.retailPrice ?? item.price),
      },
    },
    { left: { label: FORM_LABELS.sidemark, value: oneLine(item.sidemark) } },
    { left: { label: FORM_LABELS.notes, value: oneLine(item.notes) } },
    {
      left: {
        label: FORM_LABELS.inventoryNumber,
        value: oneLine(item.inventoryNumber),
      },
    },
    { left: { label: FORM_LABELS.poNumber, value: oneLine(item.poNumber) } },
  ];
}
