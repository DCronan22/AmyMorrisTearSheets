import { supabase } from "../lib/supabase";
import type { LibraryItem } from "../types";

// The firm's master tear-sheet library. Each row stores one LibraryItem as a
// jsonb `data` blob (mirroring how projects store their items jsonb). The row's
// own uuid is the source of truth for the item id. Firm ownership is enforced
// server-side by RLS (see 0004_library.sql) — we still scope reads by firm_id.

interface LibraryRow {
  id: string;
  firm_id: string;
  data: LibraryItem | null;
  updated_at?: string;
}

function rowToLibrary(row: LibraryRow): LibraryItem {
  const d = (row.data ?? {}) as Partial<LibraryItem>;
  return {
    id: row.id,
    name: d.name ?? "",
    vendor: d.vendor ?? "",
    collection: d.collection ?? "",
    category: d.category ?? "",
    sku: d.sku ?? "",
    price: typeof d.price === "number" ? d.price : null,
    dimensions: d.dimensions ?? "",
    material: d.material ?? "",
    color: d.color ?? "",
    leadTime: d.leadTime ?? "",
    notes: d.notes ?? "",
    imageUrl: d.imageUrl ?? "",
    productUrl: d.productUrl ?? "",
    upholstered: d.upholstered,
  };
}

// The jsonb payload — everything except the id, which lives in its own column.
function libraryToData(li: Omit<LibraryItem, "id">): Omit<LibraryItem, "id"> {
  return {
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
    upholstered: li.upholstered,
  };
}

/** Load a firm's library, newest-updated first. */
export async function fetchLibrary(firmId: string): Promise<LibraryItem[]> {
  const { data, error } = await supabase
    .from("library_items")
    .select("*")
    .eq("firm_id", firmId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as LibraryRow[]).map(rowToLibrary);
}

/** Insert one library item for the firm. The DB generates the uuid. */
export async function createLibraryItem(
  firmId: string,
  li: Omit<LibraryItem, "id">
): Promise<LibraryItem> {
  const { data, error } = await supabase
    .from("library_items")
    .insert({ data: libraryToData(li), firm_id: firmId })
    .select("*")
    .single();
  if (error) throw error;
  return rowToLibrary(data as LibraryRow);
}

/** Insert many library items at once (used by spreadsheet import). */
export async function createLibraryItems(
  firmId: string,
  lis: Omit<LibraryItem, "id">[]
): Promise<LibraryItem[]> {
  if (lis.length === 0) return [];
  const rows = lis.map((li) => ({ data: libraryToData(li), firm_id: firmId }));
  const { data, error } = await supabase
    .from("library_items")
    .insert(rows)
    .select("*");
  if (error) throw error;
  return (data as LibraryRow[]).map(rowToLibrary);
}

/** Update a library item in place. Ownership enforced by RLS. */
export async function saveLibraryItem(li: LibraryItem): Promise<LibraryItem> {
  const { id, ...rest } = li;
  const { data, error } = await supabase
    .from("library_items")
    .update({ data: libraryToData(rest) })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("This database item is no longer available (it may have been deleted).");
  }
  return rowToLibrary(data as LibraryRow);
}

/** Permanently delete a library item. */
export async function deleteLibraryItem(id: string): Promise<void> {
  const { error } = await supabase.from("library_items").delete().eq("id", id);
  if (error) throw error;
}
