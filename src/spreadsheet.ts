import * as XLSX from "xlsx";
import type { Item } from "./types";
import { emptyItem, ITEM_FIELDS } from "./types";
import { triggerDownload } from "./storage";

// Map many possible spreadsheet header spellings onto our item fields, so a
// designer's existing sheet usually imports with zero manual mapping.
const HEADER_ALIASES: Record<keyof Item, string[]> = {
  id: [],
  name: ["item", "name", "product", "description", "item name", "product name"],
  vendor: ["vendor", "manufacturer", "supplier", "brand", "source"],
  collection: ["collection", "line", "product line", "series", "family", "pattern"],
  category: ["category", "type", "item type", "class"],
  room: ["room", "space", "location", "area"],
  sku: ["sku", "item number", "item #", "model", "model number", "item no", "style"],
  price: ["price", "cost", "unit price", "retail", "msrp", "amount", "price each"],
  quantity: ["qty", "quantity", "count", "qty."],
  dimensions: ["dimensions", "dims", "size", "dimension"],
  material: ["material", "finish", "fabric", "materials", "material/finish"],
  color: ["color", "colour", "colorway", "finish color"],
  leadTime: ["lead time", "leadtime", "availability", "lead"],
  notes: ["notes", "note", "comments", "remarks", "spec notes"],
  imageUrl: ["image", "image url", "photo", "image link", "picture", "img"],
  productUrl: ["product url", "url", "link", "product link", "website", "web"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

/** Resolve a sheet's header row to our field keys. */
function buildColumnMap(headers: string[]): Map<number, keyof Item> {
  const map = new Map<number, keyof Item>();
  headers.forEach((h, i) => {
    const norm = normalize(String(h ?? ""));
    if (!norm) return;
    for (const field of Object.keys(HEADER_ALIASES) as (keyof Item)[]) {
      if (HEADER_ALIASES[field].includes(norm)) {
        map.set(i, field);
        return;
      }
    }
  });
  return map;
}

function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseQty(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 1;
  const n = parseInt(String(raw).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface ImportResult {
  items: Item[];
  matchedColumns: string[];
  skippedRows: number;
}

/** Parse an uploaded spreadsheet (xlsx/xls/csv) into items. */
export async function parseSpreadsheet(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (rows.length === 0) {
    return { items: [], matchedColumns: [], skippedRows: 0 };
  }

  const headers = (rows[0] as unknown[]).map((c) => String(c ?? ""));
  const colMap = buildColumnMap(headers);
  const matchedColumns = [...colMap.values()].map(
    (f) => ITEM_FIELDS.find((x) => x.key === f)?.label ?? f
  );

  const items: Item[] = [];
  let skippedRows = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const item = emptyItem();
    let hasContent = false;

    colMap.forEach((field, colIndex) => {
      const raw = row[colIndex];
      if (raw === "" || raw === null || raw === undefined) return;
      hasContent = true;
      if (field === "price") item.price = parsePrice(raw);
      else if (field === "quantity") item.quantity = parseQty(raw);
      else (item[field] as string) = String(raw).trim();
    });

    if (hasContent && (item.name || item.sku || item.vendor)) items.push(item);
    else if (hasContent) skippedRows++;
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
      return v === null || v === undefined ? "" : v;
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
