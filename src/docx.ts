import { unzipSync } from "fflate";
import type { Item } from "./types";
import { emptyItem, isCalendarDate, syncStockPricing } from "./types";
import { compressImageFile } from "./lib/extract";
import { parsePrice } from "./spreadsheet";
import type { ImportResult } from "./spreadsheet";

/**
 * Import the firm's Word inventory paperwork (.docx). One document is normally
 * one filled-in "INVENTORY DETAIL FORM": the labelled lines become the item's
 * description / date / quantity / vendor / net + retail price / sidemark /
 * notes / inventory + PO number, and the photo in the form's picture box
 * becomes the product image. If a document happens to hold several forms
 * (the title repeats), each one becomes its own item. A .docx is just a ZIP of
 * XML + media, so we unzip it and read the parts directly — no server
 * round-trip, exactly like the PowerPoint importer.
 */
export async function parseDocx(file: File): Promise<ImportResult> {
  let files: Record<string, Uint8Array>;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    files = unzipSync(buf);
  } catch {
    // Not a readable ZIP / .docx (corrupt, truncated, or wrong file type):
    // there's nothing to import, so return empty rather than throwing.
    return { items: [], matchedColumns: [], skippedRows: 0 };
  }

  const body = files["word/document.xml"];
  if (!body) {
    // A ZIP without a Word body part — nothing to read.
    return { items: [], matchedColumns: [], skippedRows: 0 };
  }

  const { lines, embeds } = flattenBody(textOf(body));
  const idToTarget = imageRels(files);
  const forms = splitForms(lines);

  const items: Item[] = [];
  const fieldsSeen = new Set<string>();
  let skipped = 0;

  for (const form of forms) {
    try {
      const parsed = parseFormLines(form.lines.map((l) => l.text));
      const imgPath = chooseFormImage(files, idToTarget, embeds, form);

      // A usable form needs at least one recognised field or a photo. This is
      // what keeps a letterhead-only document (or a stray page of prose) from
      // importing as one blank item.
      if (!hasAnyField(parsed) && !imgPath) {
        skipped++;
        continue;
      }

      const item = emptyItem();
      if (parsed.name) {
        item.name = parsed.name;
        fieldsSeen.add("Item");
      }
      if (parsed.vendor) {
        item.vendor = parsed.vendor;
        fieldsSeen.add("Vendor");
      }
      if (parsed.notes) {
        item.notes = parsed.notes;
        fieldsSeen.add("Notes");
      }
      if (parsed.quantity !== null) {
        item.quantity = parsed.quantity;
        fieldsSeen.add("Qty");
      }
      if (parsed.acquiredDate) {
        item.acquiredDate = parsed.acquiredDate;
        fieldsSeen.add("Date");
      }
      if (parsed.netPrice !== null) {
        item.netPrice = parsed.netPrice;
        fieldsSeen.add("Net Price");
      }
      if (parsed.retailPrice !== null) {
        item.retailPrice = parsed.retailPrice;
        fieldsSeen.add("Retail Price");
      }
      if (parsed.sidemark) {
        item.sidemark = parsed.sidemark;
        fieldsSeen.add("Purchased For");
      }
      if (parsed.inventoryNumber) {
        item.inventoryNumber = parsed.inventoryNumber;
        fieldsSeen.add("Inventory Number");
      }
      if (parsed.poNumber) {
        item.poNumber = parsed.poNumber;
        fieldsSeen.add("PO Number");
      }
      // The form says nothing about upholstery, so the blank-item default
      // (upholstered) stands, same as it would for a hand-added piece.

      if (imgPath && files[imgPath]) {
        try {
          const bytes = files[imgPath];
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
          const blob = new File([ab], baseName(imgPath), {
            type: mimeFor(imgPath),
          });
          item.imageUrl = await compressImageFile(blob);
          fieldsSeen.add("Photo");
        } catch {
          // Leave the photo blank if the image can't be decoded.
        }
      }

      // Retail is the client-facing number and `price` mirrors it, so cards,
      // tear sheets and exports keep reading the one price field they always
      // have.
      items.push(syncStockPricing(item));
    } catch {
      // A single malformed form shouldn't abort the whole document; skip it and
      // keep parsing the rest.
      skipped++;
    }
  }

  return { items, matchedColumns: [...fieldsSeen], skippedRows: skipped };
}

export interface ParsedForm {
  name: string;
  /** ISO yyyy-mm-dd, or "" when the form's date is blank or unreadable. */
  acquiredDate: string;
  quantity: number | null;
  vendor: string;
  netPrice: number | null;
  retailPrice: number | null;
  sidemark: string;
  notes: string;
  inventoryNumber: string;
  poNumber: string;
}

type FormField = keyof ParsedForm;

/**
 * The form's printed labels, in the order they're tried. Matching is
 * case-insensitive and whitespace-flexible (`\s*` between words) because the
 * labels are typed by hand on some copies of the paperwork, and because
 * flattening a paragraph turns Word's tab characters into ordinary spaces.
 * "Notes" carries a long parenthetical on the real form, so the parenthetical
 * is optional and its contents are ignored.
 */
const LABELS: { field: FormField; pattern: string }[] = [
  { field: "name", pattern: "item\\s*description" },
  { field: "poNumber", pattern: "purchase\\s*order\\s*number" },
  { field: "inventoryNumber", pattern: "inventory\\s*number" },
  { field: "sidemark", pattern: "purchased\\s*for[\\s/]*client[\\s/]*sidemark" },
  { field: "sidemark", pattern: "sidemark" },
  { field: "notes", pattern: "notes(?:\\s*\\([^)]*\\))?" },
  { field: "retailPrice", pattern: "retail\\s*price" },
  { field: "netPrice", pattern: "net\\s*price" },
  { field: "quantity", pattern: "(?:quantity|qty)" },
  { field: "vendor", pattern: "vendor" },
  { field: "acquiredDate", pattern: "date" },
];

// One pass finds every label on a line, which is what makes the rows that
// carry two pairs work ("Date: … Quantity: …", "Net Price: … Retail Price: …").
// The leading group is a poor man's word boundary — a lookbehind would read
// better but isn't safe on older Safari — so "Update:" can't match "Date:".
const LABEL_RE = new RegExp(
  `(^|[^A-Za-z])(${LABELS.map((l) => l.pattern).join("|")})\\s*:`,
  "gi"
);

// The form's own title, used to tell one form from the next in the rare
// document that holds several.
const TITLE_RE = /^inventory\s+detail\s+form$/i;

/**
 * Turn one form's flattened lines into structured fields. Labels may sit
 * anywhere on a line and a line may carry two of them, so we locate every
 * label first and take each value as the text running up to the next label (or
 * the end of the line) — that way an empty value stays empty instead of
 * swallowing the next label's text. The first non-blank value wins if a label
 * somehow repeats. Exported for testing.
 */
export function parseFormLines(lines: string[]): ParsedForm {
  const raw = new Map<FormField, string>();

  for (const line of lines) {
    const marks: { field: FormField; labelAt: number; valueAt: number }[] = [];
    LABEL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LABEL_RE.exec(line)) !== null) {
      const field = fieldForLabel(m[2]);
      if (field) {
        marks.push({
          field,
          labelAt: m.index + m[1].length,
          valueAt: m.index + m[0].length,
        });
      }
      // A zero-width match can't happen (every pattern needs a colon), so the
      // loop always advances.
    }
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].labelAt : line.length;
      const value = collapse(line.slice(marks[i].valueAt, end));
      // Free text after the last label on the line is the value; nothing is
      // pulled from the following line, so a wrapped note keeps only its first
      // line rather than absorbing the next field.
      if (value && !raw.has(marks[i].field)) raw.set(marks[i].field, value);
    }
  }

  return {
    name: raw.get("name") ?? "",
    acquiredDate: parseFormDate(raw.get("acquiredDate") ?? ""),
    quantity: parseQuantity(raw.get("quantity") ?? ""),
    vendor: raw.get("vendor") ?? "",
    // parsePrice is the shared spreadsheet parser: it already strips "$" and
    // thousands separators, reads the first numeric token, and returns null for
    // blanks and placeholders like "TBD" — exactly what this form needs.
    netPrice: parsePrice(raw.get("netPrice") ?? ""),
    retailPrice: parsePrice(raw.get("retailPrice") ?? ""),
    sidemark: raw.get("sidemark") ?? "",
    notes: raw.get("notes") ?? "",
    inventoryNumber: raw.get("inventoryNumber") ?? "",
    poNumber: raw.get("poNumber") ?? "",
  };
}

// Same patterns again, anchored, to tell which label a match was.
const LABEL_TESTS = LABELS.map((l) => ({
  field: l.field,
  re: new RegExp(`^(?:${l.pattern})$`, "i"),
}));

/** Which field a matched label belongs to (first pattern that fits wins). */
function fieldForLabel(label: string): FormField | null {
  for (const l of LABEL_TESTS) {
    if (l.re.test(label)) return l.field;
  }
  return null;
}

function hasAnyField(f: ParsedForm): boolean {
  return (
    Boolean(
      f.name ||
        f.vendor ||
        f.notes ||
        f.sidemark ||
        f.inventoryNumber ||
        f.poNumber ||
        f.acquiredDate
    ) ||
    f.quantity !== null ||
    f.netPrice !== null ||
    f.retailPrice !== null
  );
}

/**
 * Convert the form's `MM/DD/YY` (or `MM/DD/YYYY`) date to the ISO `yyyy-mm-dd`
 * the app stores. Two-digit years follow the usual POSIX split: 00–68 are
 * 2000s, 69–99 are 1900s. Anything that isn't a real calendar date — "n/a",
 * "13/40/25", a stray word — yields "" so we never store junk in a field the
 * date picker has to read back.
 */
function parseFormDate(raw: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return "";
  const year =
    m[3].length === 2
      ? Number(m[3]) <= 68
        ? 2000 + Number(m[3])
        : 1900 + Number(m[3])
      : Number(m[3]);
  const iso = `${pad(year, 4)}-${pad(Number(m[1]), 2)}-${pad(Number(m[2]), 2)}`;
  return isCalendarDate(iso) ? iso : "";
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Read the quantity as a whole count. Mirrors the spreadsheet importer's
 * behaviour (first run of digits, commas ignored, floats round down) but that
 * helper isn't exported, and here a missing/unreadable quantity must stay null
 * so the blank item's default of 1 is left alone rather than overwritten.
 *
 * Zero is kept rather than treated as missing: this paperwork lands in the
 * inventory, where "0" is a real on-hand count ("we stock this, none right
 * now") and must not be silently rounded up to 1.
 */
function parseQuantity(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Math.floor(parseFloat(m[0]));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

interface Line {
  text: string;
  /** Offset in document.xml, used to tie photos to the form they sit in. */
  at: number;
}

interface Form {
  lines: Line[];
  start: number;
  end: number;
}

/**
 * Split the document into forms. The paperwork is one form per file, so the
 * common case is a single form covering everything; a document that repeats the
 * "INVENTORY DETAIL FORM" title (several forms pasted together) is split at
 * each repeat. Anything above the first title — blank leader paragraphs, a
 * letterhead line — belongs to the first form.
 */
function splitForms(lines: Line[]): Form[] {
  const titles: number[] = [];
  lines.forEach((l, i) => {
    if (TITLE_RE.test(l.text)) titles.push(i);
  });
  if (titles.length < 2) {
    return [{ lines, start: 0, end: Infinity }];
  }
  return titles.map((from, i) => {
    const to = i + 1 < titles.length ? titles[i + 1] : lines.length;
    return {
      lines: lines.slice(i === 0 ? 0 : from, to),
      // The first form starts at the top of the body so a photo placed above
      // the title still counts as its own.
      start: i === 0 ? 0 : lines[from].at,
      end: i + 1 < titles.length ? lines[titles[i + 1]].at : Infinity,
    };
  });
}

/**
 * Pick the product photo for a form: of the images `document.xml` actually
 * embeds inside that form's stretch of the body, take the largest by byte size.
 * Going through the embeds (rather than everything in `word/media/`) is what
 * excludes the letterhead — the logo and address graphics are referenced from
 * `header1.xml`/`footer1.xml` and declared in *their* .rels files, so they never
 * appear here. Returns the zip path, or "" when the form embeds no image.
 */
function chooseFormImage(
  files: Record<string, Uint8Array>,
  idToTarget: Map<string, string>,
  embeds: Embed[],
  form: Form
): string {
  let best = "";
  let bestBytes = 0;
  const seen = new Set<string>();
  for (const e of embeds) {
    if (e.at < form.start || e.at >= form.end) continue;
    const target = idToTarget.get(e.id);
    if (!target || !files[target] || seen.has(target)) continue;
    // The same picture is referenced twice (mc:Choice and its VML fallback), so
    // each target is only weighed once.
    seen.add(target);
    const bytes = files[target].byteLength;
    if (bytes > bestBytes) {
      bestBytes = bytes;
      best = target;
    }
  }
  return best;
}

/** Map relationship id → zip path for the body's raster image relationships. */
function imageRels(files: Record<string, Uint8Array>): Map<string, string> {
  const rels = files["word/_rels/document.xml.rels"]
    ? textOf(files["word/_rels/document.xml.rels"])
    : "";
  const idToTarget = new Map<string, string>();
  // Parse each <Relationship> element individually so attribute order doesn't
  // matter, external (TargetMode="External") images are skipped, and only
  // raster formats we can actually embed are kept (tiff/emf/wmf fall through).
  const relRe = /<Relationship\b[^>]*>/g;
  let r: RegExpExecArray | null;
  while ((r = relRe.exec(rels)) !== null) {
    const tag = r[0];
    if (/TargetMode\s*=\s*"External"/i.test(tag)) continue;
    const id = /\bId\s*=\s*"([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget\s*=\s*"([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(target)) continue;
    idToTarget.set(id, resolveRel(files, target));
  }
  return idToTarget;
}

/** Resolve a relationship target (relative to `word/`) to its zip path. */
function resolveRel(files: Record<string, Uint8Array>, target: string): string {
  const clean = target.replace(/^\/+/, "").replace(/^(?:\.\.\/)+/, "");
  // Word writes "media/image1.png"; a package-absolute or "../media/..." target
  // means the part sits at the root of the zip instead.
  return files[`word/${clean}`] ? `word/${clean}` : clean;
}

interface Embed {
  id: string;
  at: number;
}

/**
 * Flatten the document body into logical text lines plus the image references
 * that sit between them, both in document order.
 *
 * One `<w:p>` is one line: Word splits a single printed line such as
 * `Date:` + tab + `07/29/25` across many `<w:t>` runs, so the runs are
 * concatenated verbatim (each carries its own spacing, which is how
 * `xml:space="preserve"` runs keep the space between a label and its value) and
 * only the assembled line is whitespace-collapsed. `<w:tab/>` becomes a real
 * tab so a label and its value can't run together, and hard breaks split the
 * line. `<w:pPr>` is skipped wholesale — the paragraph's tab *stops* live there
 * as `<w:tab w:val="left"/>` elements and are not typed tabs.
 *
 * Text inside a text box (`w:txbxContent`) is kept: on this form the picture
 * lives in a text box, and anything the firm types into that box is part of the
 * paperwork. Its `<mc:Fallback>` twin is dropped first, since Word writes the
 * same text box twice (a DrawingML copy and a VML copy) and we'd otherwise read
 * every text-box line — and every picture reference — twice.
 */
function flattenBody(xml: string): { lines: Line[]; embeds: Embed[] } {
  const body = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
  const lines: Line[] = [];
  const embeds: Embed[] = [];
  let buf = "";

  const flush = (at: number) => {
    const text = collapse(buf);
    if (text) lines.push({ text, at });
    buf = "";
  };

  const re =
    /<w:pPr\b[^>]*\/>|<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:t\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:tab|br|cr)\b[^>]*\/?>|<\/w:p>|<v:imagedata\b[^>]*?\sr:id="([^"]+)"[^>]*>|r:embed="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) {
      buf += decodeEntities(m[1]);
      continue;
    }
    // A DrawingML picture (r:embed) or its VML equivalent (v:imagedata r:id).
    if (m[2] !== undefined || m[3] !== undefined) {
      embeds.push({ id: (m[2] ?? m[3]) as string, at: m.index });
      continue;
    }
    const tag = m[0];
    if (tag.startsWith("<w:tab")) {
      buf += "\t";
    } else if (
      tag.startsWith("<w:br") ||
      tag.startsWith("<w:cr") ||
      tag.startsWith("</w:p")
    ) {
      flush(m.index);
    }
    // Anything else here is <w:pPr>…</w:pPr> or an empty <w:t/>: no text.
  }
  // Markup that never closes its last paragraph still contributes its text.
  flush(body.length);

  return { lines, embeds };
}

/** Collapse runs of whitespace (including tabs) to single spaces and trim. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

const decoder = new TextDecoder("utf-8");
function textOf(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

// "&amp;" is decoded last so escaped markup such as "&amp;lt;" survives as the
// literal text "&lt;" instead of turning into "<".
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}
