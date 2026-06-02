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

/** A subscribing design company (tenant). */
export interface Firm {
  id: string;
  name: string;
  subscription_status: SubscriptionStatus;
  renewal_date: string | null;
  notes: string;
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
