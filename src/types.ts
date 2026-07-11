// Core data model for the Amy Morris Interiors tear sheet tool.

/** A single specified product / furnishing on a tear sheet. */
export interface Item {
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
  coverTitle: string; // overrides the cover heading (defaults to firm name)
  footerText: string; // footer tagline (defaults to "{firm} Tear Sheets")
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
    body: '"Inter", system-ui, sans-serif',
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

/** A sensible default style, matching the app's original editorial look. */
export function defaultFirmStyle(): FirmStyle {
  return {
    logoUrl: "",
    accentColor: "#6d6047",
    textColor: "#2b2722",
    font: "classic-serif",
    layout: "list",
    showPrice: true,
    showSku: true,
    showDimensions: true,
    coverTitle: "",
    footerText: "",
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
    coverTitle: str(r.coverTitle, d.coverTitle),
    footerText: str(r.footerText, d.footerText),
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
  return item;
}

/**
 * A reusable entry in the firm's master tear-sheet library. It's a product
 * spec only — it deliberately omits `room` and `quantity`, which belong to a
 * client/project (the same chair can be "Living Room" for one client and "Den"
 * for another, in different quantities).
 */
export interface LibraryItem {
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
