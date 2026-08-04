import { supabase } from "../lib/supabase";
import { offloadDataUrl, isDataUrlImage } from "../lib/imageStore";
import type { InventoryItem, LibraryItem } from "../types";
import { itemToLibrary, sanitizeItem, syncStockPricing } from "../types";

// The firm's physical inventory. Each row stores one product spec as a jsonb
// `data` blob (same shape as a library item) plus an on-hand `quantity` column.
// The row's own uuid is the source of truth for the item id. Firm ownership is
// enforced server-side by RLS (see 0005_inventory.sql) — we still scope reads
// by firm_id.

interface InventoryRow {
  id: string;
  firm_id: string;
  data: Omit<InventoryItem, "id" | "quantity"> | null;
  quantity: number | null;
  updated_at?: string;
}

/** Shown when the inventory table hasn't been created in Supabase yet. */
const INVENTORY_NOT_SET_UP =
  "Inventory isn't set up yet — run migration 0005_inventory.sql in Supabase, then reload.";

/**
 * Map a Supabase/PostgREST error to something a user can act on. A missing
 * table (migration 0005 not run yet) comes back as PGRST205 ("Could not find
 * the table … in the schema cache") or, from raw Postgres, 42P01 ("relation
 * does not exist") — both mean "run the migration", so say exactly that.
 */
function mapInventoryError(error: { code?: string; message?: string }): Error {
  const msg = error.message ?? "";
  if (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    (/inventory_items/.test(msg) &&
      /schema cache|does not exist|not find/i.test(msg))
  ) {
    return new Error(INVENTORY_NOT_SET_UP);
  }
  return new Error(msg || "The inventory request failed. Please try again.");
}

function coerceQuantity(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : 0;
}

function rowToInventory(row: InventoryRow): InventoryItem {
  // The data blob is member-written jsonb — run it through the shared item
  // sanitizer, then keep the row's own uuid and quantity column as truth.
  return syncStockPricing({
    id: row.id,
    ...itemToLibrary(sanitizeItem(row.data)),
    quantity: coerceQuantity(row.quantity),
  });
}

// The jsonb payload — the product spec plus its stock details. The id lives in
// its own column and the quantity in its own column, so strip both defensively.
// Pieces copied in from the database arrive with a plain `price` and no retail
// price, so the write is normalized here (one place every insert/update passes
// through) rather than at each call site.
function inventoryToData(li: Omit<LibraryItem, "id">): Omit<LibraryItem, "id"> {
  const { id: _id, quantity: _qty, ...data } = syncStockPricing(
    li as LibraryItem & { quantity?: number }
  );
  void _id;
  void _qty;
  return data;
}

/** Load a firm's inventory, newest-updated first. */
export async function fetchInventory(firmId: string): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("firm_id", firmId)
    .order("updated_at", { ascending: false });
  if (error) throw mapInventoryError(error);
  return (data as InventoryRow[]).map(rowToInventory);
}

/** Insert one inventory entry for the firm. The DB generates the uuid. */
export async function createInventoryItem(
  firmId: string,
  li: Omit<LibraryItem, "id">,
  quantity = 1
): Promise<InventoryItem> {
  if (isDataUrlImage(li.imageUrl)) {
    const url = await offloadDataUrl(li.imageUrl!, firmId);
    if (url) li = { ...li, imageUrl: url };
  }
  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      data: inventoryToData(li),
      quantity: coerceQuantity(quantity),
      firm_id: firmId,
    })
    .select("*")
    .single();
  if (error) throw mapInventoryError(error);
  return rowToInventory(data as InventoryRow);
}

/** Update an entry's product details and quantity. Ownership enforced by RLS. */
export async function saveInventoryItem(
  inv: InventoryItem,
  firmId: string
): Promise<InventoryItem> {
  if (isDataUrlImage(inv.imageUrl)) {
    const url = await offloadDataUrl(inv.imageUrl!, firmId);
    if (url) inv = { ...inv, imageUrl: url };
  }
  const { id, quantity, ...rest } = inv;
  const { data, error } = await supabase
    .from("inventory_items")
    .update({ data: inventoryToData(rest), quantity: coerceQuantity(quantity) })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw mapInventoryError(error);
  if (!data) {
    throw new Error(
      "This inventory entry is no longer available (it may have been deleted)."
    );
  }
  return rowToInventory(data as InventoryRow);
}

/** Set just the on-hand quantity (the +/− stepper). Zero is allowed. */
export async function updateInventoryQuantity(
  id: string,
  quantity: number
): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from("inventory_items")
    .update({ quantity: coerceQuantity(quantity) })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw mapInventoryError(error);
  if (!data) {
    throw new Error(
      "This inventory entry is no longer available (it may have been deleted)."
    );
  }
  return rowToInventory(data as InventoryRow);
}

/** Permanently delete an inventory entry. */
export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id);
  if (error) throw mapInventoryError(error);
}
