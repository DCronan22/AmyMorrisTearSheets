import * as XLSX from "xlsx";
import type { Item } from "./types";
import { emptyItem, ITEM_FIELDS } from "./types";
import { triggerDownload } from "./storage";

// Map many possible spreadsheet header spellings onto our item fields, so a
// designer's existing sheet usually imports with zero manual mapping.
const HEADER_ALIASES: Record<keyof Item, string[]> = {
  id: [],
  name: ["item", "name", "product", "description", "item name", "product name", "item description"],
  vendor: ["vendor", "manufacturer", "supplier", "brand", "source"],
  collection: ["collection", "line", "product line", "series", "family", "pattern"],
  category: ["category", "type", "item type", "class"],
  room: ["room", "space", "location", "area"],
  sku: ["sku", "item number", "item #", "model", "model number", "item no", "style", "style #", "style no", "style number"],
  price: ["price", "cost", "unit price", "unit cost", "retail", "msrp", "amount", "price each"],
  quantity: ["qty", "quantity", "count", "qty."],
  dimensions: ["dimensions", "dims", "size", "dimension"],
  material: ["material", "finish", "fabric", "materials", "material/finish"],
  color: ["color", "colour", "colorway", "finish color"],
  leadTime: ["lead time", "leadtime", "availability", "lead"],
  notes: ["notes", "note", "comments", "remarks", "spec notes"],
  imageUrl: ["image", "image url", "photo", "image link", "picture", "img"],
  productUrl: ["product url", "url", "link", "product link", "website", "web"],
  // Not imported from spreadsheets; set via the item editor (defaults to true).
  upholstered: [],
};

// Defensive caps so a pathological upload (a 500k-row export, a cell holding a
// pasted essay or a base64 blob) can't lock up the browser tab or the editor.
const MAX_DATA_ROWS = 20000; // import at most this many data rows
const MAX_SCAN_ROWS = 12; // how far down we'll look for the real header row
const MAX_CELL_LEN = 1000; // trim absurdly long text cells
// URLs (signed S3/Shopify links, pasted data: URLs) routinely run past the
// free-text cap; use Excel's own cell ceiling so we never chop a link mid-string.
const MAX_URL_LEN = 32000;

/**
 * Fold a header (or alias) to a comparable key. Designers' headers are messy:
 * leading BOM, trailing units in parens ("Price ($)", "Dimensions (WxDxH)"),
 * non-breaking spaces, slashes/hyphens as separators ("Material / Finish",
 * "Lead-Time"), and trailing punctuation ("Qty.", "Price:"). We deliberately
 * KEEP "#" so "Item #" (sku) never collapses onto "Item" (name).
 */
function normalize(s: unknown): string {
  return String(s ?? "")
    .replace(/\uFEFF/g, "") // strip byte-order marks (common in CSV exports)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop parenthetical units/currency
    .replace(/[\\/|]+/g, " ") // treat slashes/pipes as separators
    .replace(/[-–—]+/g, " ") // treat hyphens/dashes as separators
    .replace(/\s+/g, " ") // collapse whitespace (\s incl. nbsp)
    .trim()
    .replace(/[.:;,]+$/, "") // strip trailing punctuation (keep "#")
    .trim();
}

// Pre-normalize every alias once into a flat lookup. First alias to claim a
// normalized key wins, so an accidental cross-field collision can't silently
// remap a column.
const ALIAS_LOOKUP: Map<string, keyof Item> = (() => {
  const m = new Map<string, keyof Item>();
  for (const field of Object.keys(HEADER_ALIASES) as (keyof Item)[]) {
    for (const alias of HEADER_ALIASES[field]) {
      const key = normalize(alias);
      if (key && !m.has(key)) m.set(key, field);
    }
  }
  return m;
})();

/** Resolve a sheet's header row to our field keys. */
function buildColumnMap(headers: unknown[]): Map<number, keyof Item> {
  const map = new Map<number, keyof Item>();
  const used = new Set<keyof Item>(); // first column wins a duplicated header
  headers.forEach((h, i) => {
    const norm = normalize(h);
    if (!norm) return; // blank header cell
    const field = ALIAS_LOOKUP.get(norm);
    if (field && !used.has(field)) {
      map.set(i, field);
      used.add(field);
    }
  });
  return map;
}

// Values that mean "no price yet" rather than a number.
const PRICE_PLACEHOLDERS = new Set([
  "",
  "-",
  "--",
  "–", // en dash
  "—", // em dash
  "n/a",
  "na",
  "tbd",
  "tba",
  "none",
  "pending",
  "quote",
  "?",
]);

/** Shared price parser (also used by the PowerPoint importer). */
export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (PRICE_PLACEHOLDERS.has(s.toLowerCase())) return null;
  // Accounting-style negatives, e.g. "(1,234.00)" or a leading minus/en-dash.
  const negative = /^\(.*\)$/.test(s) || /^[-–—−]/.test(s);
  // Grab the FIRST numeric token so a range like "$3,599-$4,999" yields the
  // low/start value (matching how the app shows price ranges).
  const m = s.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function parseQty(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 1;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  }
  // First run of digits (with optional decimals); floats round down to a whole
  // count. Commas are stripped first so "1,000" reads as 1000, not 1. Anything
  // unparseable, zero or negative falls back to 1.
  const m = String(raw).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return 1;
  const n = Math.floor(parseFloat(m[0]));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export interface ImportResult {
  items: Item[];
  matchedColumns: string[];
  skippedRows: number;
}

/** Read the first sheet that actually contains data (skip empty lead sheets). */
function readFirstNonEmptySheet(wb: XLSX.WorkBook): unknown[][] {
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    if (rows.some((r) => r.some((c) => String(c ?? "").trim() !== ""))) {
      return rows;
    }
  }
  return [];
}

/**
 * Find the most likely header row. Designers often put a title/logo/date row
 * (or a few) above the real column headers, so blindly trusting row 0 drops
 * every column. We scan the first few rows and pick the one that maps the most
 * known fields. Strict ">" keeps the earliest row on a tie, so a plain sheet
 * whose headers are on row 0 is never regressed.
 */
function detectHeaderRow(rows: unknown[][]): number {
  let best = 0;
  let bestScore = 0;
  const limit = Math.min(rows.length, MAX_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const score = buildColumnMap(rows[i]).size;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Parse an uploaded spreadsheet (xlsx/xls/csv) into items. */
export async function parseSpreadsheet(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  // sheetRows caps how much SheetJS parses up front, so a giant file never
  // fully materializes in memory.
  const wb = XLSX.read(buf, {
    type: "array",
    sheetRows: MAX_DATA_ROWS + MAX_SCAN_ROWS + 1,
  });
  const rows = readFirstNonEmptySheet(wb);
  if (rows.length === 0) {
    return { items: [], matchedColumns: [], skippedRows: 0 };
  }

  const headerRow = detectHeaderRow(rows);
  const colMap = buildColumnMap(rows[headerRow]);
  const matchedColumns = [...colMap.values()].map(
    (f) => ITEM_FIELDS.find((x) => x.key === f)?.label ?? f
  );

  const items: Item[] = [];
  let skippedRows = 0;

  const end = Math.min(rows.length, headerRow + 1 + MAX_DATA_ROWS);
  for (let r = headerRow + 1; r < end; r++) {
    const row = rows[r];
    // Truly empty rows (structural spacers) are dropped silently; a row with
    // only stray whitespace still has cell strings, so it falls through to the
    // skipped count rather than producing a blank item.
    if (row.every((c) => c === "" || c === null || c === undefined)) continue;

    const item = emptyItem();
    colMap.forEach((field, colIndex) => {
      const raw = row[colIndex];
      const val = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!val) return;
      if (field === "price") item.price = parsePrice(raw);
      else if (field === "quantity") item.quantity = parseQty(raw);
      else if (field === "imageUrl" || field === "productUrl")
        (item[field] as string) = val.slice(0, MAX_URL_LEN);
      else (item[field] as string) = val.slice(0, MAX_CELL_LEN);
    });

    if (item.name || item.sku || item.vendor) items.push(item);
    else skippedRows++;
  }

  return { items, matchedColumns, skippedRows };
}

/** Download a blank, correctly-headed template the user can fill in. */
export function downloadTemplate(): void {
  const headers = ITEM_FIELDS.filter((f) => f.key !== "id").map((f) => f.label);
  const example = [
    "Lawson Sofa",
    "Lee Industries",
    "Aspen",
    "Seating",
    "Living Room",
    "3935-03",
    4280,
    1,
    '90"W x 40"D x 33"H',
    "Performance linen",
    "Oatmeal",
    "10-12 weeks",
    "Brass nailhead trim",
    "https://example.com/sofa.jpg",
    "https://example.com/product",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Items");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  triggerDownload(
    new Blob([out], { type: "application/octet-stream" }),
    "tear-sheet-template.xlsx"
  );
}

/** Export the current items to an .xlsx spreadsheet. */
export function exportItemsToSpreadsheet(items: Item[], projectName: string): void {
  const fields = ITEM_FIELDS.filter((f) => f.key !== "id");
  const headers = fields.map((f) => f.label);
  const data = items.map((it) =>
    fields.map((f) => {
      const v = it[f.key];
      if (v === null || v === undefined) return "";
      // Uploaded photos are stored as huge base64 data URLs that blow Excel's
      // 32,767-character cell limit and corrupt the export -- leave those blank.
      if (f.key === "imageUrl" && typeof v === "string" && v.startsWith("data:"))
        return "";
      return typeof v === "string" ? v.slice(0, 32000) : v;
    })
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws["!cols"] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Items");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const safe = projectName.replace(/[^\w-]+/g, "-") || "tear-sheet";
  triggerDownload(
    new Blob([out], { type: "application/octet-stream" }),
    `${safe}.xlsx`
  );
}
