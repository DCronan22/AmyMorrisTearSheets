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

/** Layout options + descriptions for the style editor. */
export const TEAR_SHEET_LAYOUTS: {
  value: TearSheetLayout;
  label: string;
  hint: string;
}[] = [
  { value: "list", label: "List", hint: "Image left, specs right — dense & classic" },
  { value: "grid", label: "Grid", hint: "Two cards per row — visual overview" },
  { value: "spotlight", label: "Spotlight", hint: "One large item per page" },
];

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
