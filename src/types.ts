// Core data model for the Amy Morris Interiors tear sheet tool.

/**
 * Stock / purchasing details that belong to a physical inventory entry: when it
 * was acquired, what it cost, what it sells for, and the paperwork it came in
 * on. Optional on every item type so client-project items and database entries
 * are untouched — only the Inventory view reads or writes them.
 */
export interface StockFields {
  /** ISO yyyy-mm-dd — the date the piece was purchased / received. */
  acquiredDate?: string;
  /** What the firm paid per unit. */
  netPrice?: number | null;
  /**
   * Shipping / delivery cost per unit, kept separate from the net price so the
   * firm can see what a piece cost to get here. Internal like the net price —
   * it never crosses onto a client project or a tear sheet.
   */
  freight?: number | null;
  /**
   * The client-facing price per unit. `price` mirrors it, so cards, tear sheets
   * and exports keep reading the one existing price field.
   */
  retailPrice?: number | null;
  /** The firm's own stock tag, e.g. "INV-1042". Free text. */
  inventoryNumber?: string;
  /** The purchase order this piece arrived on. */
  poNumber?: string;
  /**
   * Who the piece was bought for — the client, job, or sidemark it's earmarked
   * against. Blank for stock bought on spec. Matches the "Purchased For /
   * Client / Sidemark" line on the firm's Word inventory form, so the field
   * survives a round trip through .docx import/export.
   */
  sidemark?: string;
}

/** A single specified product / furnishing on a tear sheet. */
export interface Item extends StockFields {
  id: string;
  name: string;        // Product name, e.g. "Lawson Sofa"
  vendor: string;      // Manufacturer / supplier
  collection: string;  // Vendor's product line / collection, e.g. "Aspen", "Cloud"
  category: string;    // e.g. Seating, Lighting, Rug, Table, Art
  room: string;        // e.g. Living Room, Primary Bath
  sku: string;         // Item / model number
  price: number | null;
  quantity: number;
  dimensions: string;  // Free text, e.g. 84"W x 38"D x 31"H
  material: string;    // Material / finish
  color: string;       // Color / colorway
  leadTime: string;    // e.g. "8-10 weeks"
  notes: string;
  imageUrl: string;    // URL or data URL
  productUrl: string;  // Link to vendor product page
  /**
   * Upholstered piece? Drives the tear-sheet price line: upholstered items read
   * "+ Fabric + Freight", everything else just "+ Freight". Optional for
   * backward-compat with items saved before this field existed (treated as
   * upholstered unless explicitly false).
   */
  upholstered?: boolean;
}

/** A project groups items for one client / installation. */
export interface Project {
  id: string;
  name: string;        // e.g. "Smith Residence"
  client: string;
  location: string;    // City / address line
  date: string;        // ISO date string
  logoUrl: string;     // Optional firm/client logo (data URL or URL)
  notes: string;
  items: Item[];
  // The row's `updated_at` exactly as the database returned it, used as a
  // "this is the version I loaded" token so a save can detect that a teammate
  // wrote to the project first (see saveProject). Treat it as opaque: never
  // parse or reformat it, or it will stop matching the stored timestamp.
  // Absent on projects that don't come from the database (backups, drafts).
  updatedAt?: string;
}

/** The full persisted application state. */
export interface AppData {
  version: 1;
  projects: Project[];
  activeProjectId: string | null;
}

/** Subscription state of a firm (tenant). Mirrors the DB check constraint. */
export type SubscriptionStatus = "trial" | "active" | "suspended" | "canceled";

/** Tear-sheet export layouts a firm can choose between. */
export type TearSheetLayout = "list" | "grid" | "spotlight";

/** Curated heading/body font pairings (uses only already-loaded web fonts). */
export type FontPairing =
  | "classic-serif"
  | "modern-sans"
  | "editorial"
  | "minimal";

/** Fonts offered per-element in the layout editor. All ship on Windows
 *  PowerPoint AND browsers, so print/PDF and .pptx render the same family.
 *  "" = inherit the firm's font pairing (head for the wordmark, body elsewhere). */
export type SheetFont =
  | ""
  | "Georgia"
  | "Times New Roman"
  | "Calibri"
  | "Segoe UI"
  | "Arial";

/** Per-element text styling on the tear-sheet template. */
export interface TextStyle {
  font: SheetFont;
  size: number; // points
  color: string; // hex, or "" to inherit (accent for header/footer, text for details)
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}

/** A block's placement, as fractions (0..1) of the 7.5 × 13.333in page. */
export interface SheetBox {
  x: number; // left edge
  y: number; // top edge
  w: number; // width
  h: number; // height (used by the photo box; height of text boxes follows content)
}

/** The text elements a firm can individually style. */
export type SheetTextKey =
  | "wordmark"
  | "room"
  | "name"
  | "sku"
  | "dimensions"
  | "price"
  | "leadTime"
  | "footer";

/**
 * An opt-in custom tear-sheet layout: where each block sits and how each text
 * element is styled. A firm whose style has no `sheet` (the default, incl. every
 * existing firm) keeps the fixed exact-match template — the absolute-positioned
 * renderer only kicks in once a firm customizes its layout.
 */
export interface SheetStyle {
  logo: SheetBox; // logo image, or the wordmark when no logo
  photo: SheetBox; // product photo (contain-fit within the box)
  details: SheetBox; // top-left anchor of the stacked detail lines
  room: SheetBox;
  footer: SheetBox;
  text: Record<SheetTextKey, TextStyle>;
}

/** Firm pairing → concrete fonts present on Windows PowerPoint AND browsers, so
 *  the print/PDF and .pptx exports resolve to the same family. */
export const PAIRING_FONTS: Record<FontPairing, { head: string; body: string }> = {
  "classic-serif": { head: "Georgia", body: "Calibri" },
  "modern-sans": { head: "Calibri", body: "Calibri" },
  editorial: { head: "Georgia", body: "Georgia" },
  minimal: { head: "Segoe UI", body: "Segoe UI" },
};

/**
 * A firm's reusable export branding. Drives the printable/PDF tear sheet (and a
 * touch of the on-screen accent). `null` on a firm means "not configured yet",
 * which triggers the optional first-run setup prompt.
 */
export interface FirmStyle {
  logoUrl: string; // firm logo, data URL or URL (manual upload)
  accentColor: string; // hex — headings, room titles, rules
  textColor: string; // hex — body text
  font: FontPairing;
  // Kept for stored-jsonb compatibility; the exports use one fixed
  // one-product-per-page layout, so nothing reads this today.
  layout: TearSheetLayout;
  showPrice: boolean; // include prices on the sheet
  showSku: boolean; // include SKU / model rows
  showDimensions: boolean; // include dimensions rows
  showRoom: boolean; // include the room label under the logo
  coverTitle: string; // overrides the cover heading (defaults to firm name)
  footerText: string; // footer tagline (defaults to "{firm} Tear Sheets")
  /** Opt-in custom layout. null/absent → the fixed exact-match template. */
  sheet?: SheetStyle | null;
}

/** The subset of style a sample sheet can be analyzed into (AI auto-detect). */
export type DetectedStyle = Partial<Omit<FirmStyle, "logoUrl">>;

/** Font-pairing → CSS stacks + label, shared by the editor preview and exports. */
export const FONT_STACKS: Record<
  FontPairing,
  { head: string; body: string; label: string }
> = {
  "classic-serif": {
    head: '"Cormorant Garamond", Georgia, serif',
    // Calibri first so the print/PDF details render in the same font the
    // PowerPoint export uses (Amy Morris's reference sheets are Calibri).
    body: 'Calibri, "Segoe UI", system-ui, sans-serif',
    label: "Classic serif",
  },
  "modern-sans": {
    head: '"Inter", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    label: "Modern sans",
  },
  editorial: {
    head: 'Georgia, "Times New Roman", serif',
    body: 'Georgia, "Times New Roman", serif',
    label: "Editorial serif",
  },
  minimal: {
    head: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    label: "Minimal",
  },
};

/** A sensible default style, matching Amy Morris's original tear sheets
 *  (taupe #907c67 throughout, no room label) in both export formats. */
export function defaultFirmStyle(): FirmStyle {
  return {
    logoUrl: "",
    accentColor: "#907c67",
    textColor: "#907c67",
    font: "classic-serif",
    layout: "list",
    showPrice: true,
    // Amy Morris's reference sheets have no SKU row (Name / Dimensions / Price /
    // Lead Time only). Firms that want model numbers can toggle SKU on.
    showSku: false,
    showDimensions: true,
    showRoom: false,
    coverTitle: "",
    footerText: "",
    sheet: null,
  };
}

/** A default text style (centered, inheriting font + color) at a given size. */
function defaultText(size: number): TextStyle {
  return { font: "", size, color: "", bold: false, italic: false, align: "center" };
}

/**
 * The default custom layout — the same geometry as the fixed exact-match
 * template (measured from Amy Morris's reference decks; page 7.5 × 13.333in),
 * expressed as page fractions. Seeded into a firm's `sheet` the moment they open
 * the layout editor, so "customize" starts from today's look.
 */
export function defaultSheet(): SheetStyle {
  return {
    // logo 4.72in wide, centered, top at 0.5in
    logo: { x: (7.5 - 4.72) / 2 / 7.5, y: 0.5 / 13.333, w: 4.72 / 7.5, h: 0.06 },
    // photo full width, upper-middle, ~5.87in tall box (contain-fit)
    photo: { x: 0, y: 0.3, w: 1, h: 0.44 },
    // details text box, top at 10.99in, side inset 0.49in
    details: { x: 0.49 / 7.5, y: 10.99 / 13.333, w: (7.5 - 0.98) / 7.5, h: 0.14 },
    room: { x: 0.49 / 7.5, y: 0.2, w: (7.5 - 0.98) / 7.5, h: 0.03 },
    footer: { x: 0.048, y: (13.333 - 0.55) / 13.333, w: 0.904, h: 0.02 },
    text: {
      wordmark: defaultText(42),
      room: defaultText(18),
      name: defaultText(18),
      sku: defaultText(18),
      dimensions: defaultText(18),
      price: defaultText(18),
      leadTime: defaultText(18),
      footer: defaultText(10),
    },
  };
}

const SHEET_TEXT_KEYS: SheetTextKey[] = [
  "wordmark",
  "room",
  "name",
  "sku",
  "dimensions",
  "price",
  "leadTime",
  "footer",
];

const SHEET_FONTS: SheetFont[] = [
  "",
  "Georgia",
  "Times New Roman",
  "Calibri",
  "Segoe UI",
  "Arial",
];

/** Per-element font options for the layout editor: [stored value, label]. */
export const SHEET_FONT_LABELS: [SheetFont, string][] = [
  ["", "Match firm font"],
  ["Georgia", "Georgia"],
  ["Times New Roman", "Times New Roman"],
  ["Calibri", "Calibri"],
  ["Segoe UI", "Segoe UI"],
  ["Arial", "Arial"],
];

/** Coerce an untrusted stored `sheet` into a safe SheetStyle, or null. Member-
 *  writable jsonb, so every field falls back to the default-sheet value. */
export function normalizeSheet(raw: unknown): SheetStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const d = defaultSheet();
  const num = (v: unknown, fb: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
  const box = (v: unknown, fb: SheetBox): SheetBox => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return {
      x: num(o.x, fb.x, -0.5, 1.5),
      y: num(o.y, fb.y, -0.5, 1.5),
      w: num(o.w, fb.w, 0.02, 2),
      h: num(o.h, fb.h, 0.01, 2),
    };
  };
  const text = (v: unknown, fb: TextStyle): TextStyle => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const font = SHEET_FONTS.includes(o.font as SheetFont) ? (o.font as SheetFont) : fb.font;
    const color =
      typeof o.color === "string" && (o.color === "" || /^#[0-9a-fA-F]{3,8}$/.test(o.color.trim()))
        ? o.color.trim()
        : fb.color;
    const align =
      o.align === "left" || o.align === "center" || o.align === "right" ? o.align : fb.align;
    return {
      font,
      size: num(o.size, fb.size, 5, 120),
      color,
      bold: typeof o.bold === "boolean" ? o.bold : fb.bold,
      italic: typeof o.italic === "boolean" ? o.italic : fb.italic,
      align,
    };
  };
  const rt = (r.text && typeof r.text === "object" ? r.text : {}) as Record<string, unknown>;
  const textOut = {} as Record<SheetTextKey, TextStyle>;
  for (const k of SHEET_TEXT_KEYS) textOut[k] = text(rt[k], d.text[k]);
  return {
    logo: box(r.logo, d.logo),
    photo: box(r.photo, d.photo),
    details: box(r.details, d.details),
    room: box(r.room, d.room),
    footer: box(r.footer, d.footer),
    text: textOut,
  };
}

/**
 * Coerce a firm's stored `style` jsonb into a complete, well-typed FirmStyle.
 * The column is written via an RPC any firm member can call, so its contents
 * are untrusted: missing/wrong-typed fields fall back to the default style
 * instead of crashing the workspace (e.g. FONT_STACKS[undefined]).
 */
export function normalizeFirmStyle(raw: unknown): FirmStyle {
  const d = defaultFirmStyle();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const color = (v: unknown, fb: string) =>
    typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())
      ? v.trim()
      : fb;
  const font: FontPairing =
    r.font === "classic-serif" ||
    r.font === "modern-sans" ||
    r.font === "editorial" ||
    r.font === "minimal"
      ? r.font
      : d.font;
  const layout: TearSheetLayout =
    r.layout === "list" || r.layout === "grid" || r.layout === "spotlight"
      ? r.layout
      : d.layout;
  return {
    logoUrl: str(r.logoUrl, d.logoUrl),
    accentColor: color(r.accentColor, d.accentColor),
    textColor: color(r.textColor, d.textColor),
    font,
    layout,
    showPrice: bool(r.showPrice, d.showPrice),
    showSku: bool(r.showSku, d.showSku),
    showDimensions: bool(r.showDimensions, d.showDimensions),
    showRoom: bool(r.showRoom, d.showRoom),
    coverTitle: str(r.coverTitle, d.coverTitle),
    footerText: str(r.footerText, d.footerText),
    sheet: normalizeSheet(r.sheet),
  };
}

/** The firm's `style` jsonb is member-writable and therefore untrusted —
 *  normalize it at every firm-fetch boundary so consumers get a safe shape. */
export function withSafeStyle(firm: Firm | null): Firm | null {
  if (!firm) return null;
  return {
    ...firm,
    style: firm.style == null ? null : normalizeFirmStyle(firm.style),
  };
}

/** A subscribing design company (tenant). */
export interface Firm {
  id: string;
  name: string;
  subscription_status: SubscriptionStatus;
  renewal_date: string | null;
  notes: string;
  style: FirmStyle | null;
  created_at: string;
}

/** An app user, linked to a firm. */
export interface Profile {
  id: string;
  firm_id: string | null;
  full_name: string;
  email: string;
  role: "member" | "platform_admin";
  created_at: string;
}

/** The fields a user can supply via spreadsheet, in display order. */
export const ITEM_FIELDS: { key: keyof Item; label: string }[] = [
  { key: "name", label: "Item" },
  { key: "vendor", label: "Vendor" },
  { key: "collection", label: "Collection" },
  { key: "category", label: "Category" },
  { key: "room", label: "Room" },
  { key: "sku", label: "SKU" },
  { key: "price", label: "Price" },
  { key: "quantity", label: "Qty" },
  { key: "dimensions", label: "Dimensions" },
  { key: "material", label: "Material" },
  { key: "color", label: "Color" },
  { key: "leadTime", label: "Lead Time" },
  { key: "notes", label: "Notes" },
  { key: "imageUrl", label: "Image URL" },
  { key: "productUrl", label: "Product URL" },
];

/** Build a blank item with a fresh id. */
export function emptyItem(): Item {
  return {
    id: newId(),
    name: "",
    vendor: "",
    collection: "",
    category: "",
    room: "",
    sku: "",
    price: null,
    quantity: 1,
    dimensions: "",
    material: "",
    color: "",
    leadTime: "",
    notes: "",
    imageUrl: "",
    productUrl: "",
    upholstered: true,
  };
}

/**
 * Coerce untrusted item data into a complete, well-typed Item — the sibling of
 * normalizeFirmStyle for the items jsonb. Sources: project rows written by any
 * firm member (possibly by older app versions) and backup .json files (possibly
 * hand-edited). Wrong-typed fields fall back to blank-item defaults; unknown
 * fields are dropped. `keepId` preserves a valid existing id (the DB load
 * boundary); without it a fresh id is generated (backup restore, so restored
 * copies never collide).
 */
export function sanitizeItem(raw: unknown, opts?: { keepId?: boolean }): Item {
  const item = emptyItem();
  if (!raw || typeof raw !== "object") return item;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (opts?.keepId && typeof r.id === "string" && r.id) item.id = r.id;
  item.name = str(r.name);
  item.vendor = str(r.vendor);
  item.collection = str(r.collection);
  item.category = str(r.category);
  item.room = str(r.room);
  item.sku = str(r.sku);
  item.price =
    typeof r.price === "number" && Number.isFinite(r.price) ? r.price : null;
  item.quantity =
    typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity >= 1
      ? Math.floor(r.quantity)
      : 1;
  item.dimensions = str(r.dimensions);
  item.material = str(r.material);
  item.color = str(r.color);
  item.leadTime = str(r.leadTime);
  item.notes = str(r.notes);
  item.imageUrl = str(r.imageUrl);
  item.productUrl = str(r.productUrl);
  item.upholstered = typeof r.upholstered === "boolean" ? r.upholstered : true;
  return { ...item, ...sanitizeStockFields(raw) };
}

/**
 * Pull the inventory stock fields out of untrusted data (a jsonb blob, an item
 * being converted between shapes). Blank / wrong-typed values are simply left
 * off, so an item that never had stock details stays exactly as it was.
 */
/** True for a real yyyy-mm-dd date — the shape AND the day actually existing,
 *  so "2026-02-30" and "2026-13-45" are rejected rather than rolling over. */
export function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

export function sanitizeStockFields(raw: unknown): StockFields {
  const out: StockFields = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const money = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  // Pinned to a real calendar date, matching how sanitizeProject treats a
  // project's date — the date picker only ever produces this, and a hand-edited
  // backup shouldn't be able to store "2026-13-45" (or arbitrary text) as one.
  if (typeof r.acquiredDate === "string" && isCalendarDate(r.acquiredDate.trim())) {
    out.acquiredDate = r.acquiredDate.trim();
  }
  if (money(r.netPrice) !== null) out.netPrice = money(r.netPrice);
  if (money(r.freight) !== null) out.freight = money(r.freight);
  if (money(r.retailPrice) !== null) out.retailPrice = money(r.retailPrice);
  if (typeof r.inventoryNumber === "string" && r.inventoryNumber.trim()) {
    out.inventoryNumber = r.inventoryNumber.trim();
  }
  if (typeof r.poNumber === "string" && r.poNumber.trim()) {
    out.poNumber = r.poNumber.trim();
  }
  if (typeof r.sidemark === "string" && r.sidemark.trim()) {
    out.sidemark = r.sidemark.trim();
  }
  return out;
}

/**
 * Keep an inventory entry's two prices consistent. `retailPrice` is the
 * client-facing number and `price` mirrors it, so the gallery cards, the
 * tear-sheet price line and the PowerPoint/PDF exports keep reading the single
 * `price` field they always have. Entries saved before the net/retail split —
 * and pieces copied in from the database — carry only `price`, so it is adopted
 * as the retail price.
 *
 * That fallback is why anything that clears the retail price MUST clear `price`
 * in the same update (see setRetailPrice in ItemEditor) — drop the retail price
 * on its own and the old number is resurrected here from its own mirror.
 */
export function syncStockPricing<T extends { price: number | null } & StockFields>(
  entry: T
): T {
  const retail = entry.retailPrice ?? entry.price ?? null;
  return { ...entry, retailPrice: retail, price: retail };
}

/**
 * A reusable entry in the firm's master tear-sheet library. It's a product
 * spec only — it deliberately omits `room` and `quantity`, which belong to a
 * client/project (the same chair can be "Living Room" for one client and "Den"
 * for another, in different quantities).
 */
export interface LibraryItem extends StockFields {
  id: string;
  name: string;
  vendor: string;
  collection: string;
  category: string;
  sku: string;
  price: number | null;
  dimensions: string;
  material: string;
  color: string;
  leadTime: string;
  notes: string;
  imageUrl: string;
  productUrl: string;
  upholstered?: boolean;
}

/** Promote a project item to a library entry (drops id/room/quantity). */
export function itemToLibrary(it: Item): Omit<LibraryItem, "id"> {
  return {
    // Stock details ride along so an inventory entry survives the round trip
    // through the shared item editor; client items simply have none.
    ...sanitizeStockFields(it),
    name: it.name,
    vendor: it.vendor,
    collection: it.collection,
    category: it.category,
    sku: it.sku,
    price: it.price,
    dimensions: it.dimensions,
    material: it.material,
    color: it.color,
    leadTime: it.leadTime,
    notes: it.notes,
    imageUrl: it.imageUrl,
    productUrl: it.productUrl,
    upholstered: it.upholstered,
  };
}

/**
 * Drop a library entry into a project as a fresh, independent item: new id,
 * empty room (lands under "Unassigned"), quantity 1. Edits to the project copy
 * never touch the library master.
 */
export function libraryToItem(li: LibraryItem): Item {
  return {
    ...emptyItem(),
    ...sanitizeStockFields(li),
    name: li.name,
    vendor: li.vendor,
    collection: li.collection,
    category: li.category,
    sku: li.sku,
    price: li.price,
    dimensions: li.dimensions,
    material: li.material,
    color: li.color,
    leadTime: li.leadTime,
    notes: li.notes,
    imageUrl: li.imageUrl,
    productUrl: li.productUrl,
    upholstered: li.upholstered ?? true,
  };
}

/**
 * A physical stock entry in the firm's inventory: the same product spec as a
 * LibraryItem plus how many units the firm has on hand. Quantity 0 is valid
 * ("we stock this but have none right now") — removing an entry is always an
 * explicit delete, never a side effect of stepping the count down.
 */
export interface InventoryItem extends LibraryItem {
  quantity: number;
}

/**
 * Turn an inventory entry into a printable/project-style Item. Out-of-stock
 * entries print as quantity 1 (an Item's quantity is at least 1).
 */
export function inventoryToItem(inv: InventoryItem): Item {
  return {
    ...libraryToItem(inv),
    quantity: Math.max(1, inv.quantity),
  };
}

/**
 * The product spec of an inventory entry, with the stock details left behind —
 * the shape a piece takes when it leaves the inventory for a client project or
 * the database.
 *
 * Deliberately NOT inventoryToItem: that keeps the stock fields (they ride
 * along so the shared editor can round-trip an entry), and those must not
 * follow a piece out of the inventory. The firm's **net price and freight** in
 * particular are internal — they would otherwise sit in the project's or
 * database's stored data and reappear if that piece were later exported as an
 * inventory form. Only the retail price crosses, as the item's `price`, which
 * is the field the tear sheets and every export already read.
 *
 * That's what makes a copied piece print and export exactly like anything else
 * in that project or the database: it carries no inventory-only data, so the
 * normal tear-sheet path is the only one that can apply to it.
 */
export function inventoryToSpec(inv: InventoryItem): Omit<LibraryItem, "id"> {
  return {
    name: inv.name,
    vendor: inv.vendor,
    collection: inv.collection,
    category: inv.category,
    sku: inv.sku,
    price: inv.retailPrice ?? inv.price ?? null,
    dimensions: inv.dimensions,
    material: inv.material,
    color: inv.color,
    leadTime: inv.leadTime,
    notes: inv.notes,
    imageUrl: inv.imageUrl,
    productUrl: inv.productUrl,
    upholstered: inv.upholstered ?? true,
  };
}

/**
 * Drop an inventory entry into a client project as a fresh, independent item
 * (see inventoryToSpec for what is and isn't carried across).
 *
 * Quantity starts at 1: the on-hand count is stock the firm holds, not how many
 * the client is specifying. Room is blank, so it lands under "Unassigned".
 */
export function inventoryToClientItem(inv: InventoryItem): Item {
  return { ...emptyItem(), ...inventoryToSpec(inv) };
}

/**
 * Open an inventory entry in the shared item editor. Unlike inventoryToItem
 * this keeps the entry's own id and its real on-hand count — including zero, which
 * the printable conversion floors at 1 — because the editor writes both back.
 */
export function inventoryToDraft(inv: InventoryItem): Item {
  return {
    ...inventoryToItem(inv),
    id: inv.id,
    quantity: Math.max(0, inv.quantity),
  };
}

/** Build a blank project with a fresh id. */
export function emptyProject(name = "Untitled Project"): Project {
  return {
    id: newId(),
    name,
    client: "",
    location: "",
    date: new Date().toISOString().slice(0, 10),
    logoUrl: "",
    notes: "",
    items: [],
  };
}

/** Short, collision-resistant id. */
export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}
