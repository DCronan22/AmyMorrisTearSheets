import { supabase } from "../lib/supabase";
import { byId, fetchAllRows, NEWEST_FIRST } from "./fetchAll";
import { offloadDataUrl, offloadItemImages, isDataUrlImage } from "../lib/imageStore";
import type { LibraryItem } from "../types";
import { itemToLibrary, sanitizeItem } from "../types";

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
  // The data blob is member-written jsonb — run it through the shared item
  // sanitizer, then keep the row's own uuid as the id.
  return { id: row.id, ...itemToLibrary(sanitizeItem(row.data)) };
}

// The jsonb payload — everything except the id, which lives in its own column.
// (Strip a stray runtime id defensively; the type alone doesn't guarantee the
// object has none, and extra keys would be stored verbatim.)
function libraryToData(li: Omit<LibraryItem, "id">): Omit<LibraryItem, "id"> {
  const { id: _omit, ...data } = li as LibraryItem;
  void _omit;
  return data;
}

/** Load a firm's whole library, newest-updated first. */
export async function fetchLibrary(firmId: string): Promise<LibraryItem[]> {
  const { data, error } = await fetchAllRows<LibraryRow>(
    (opts) =>
      supabase.from("library_items").select("*", opts).eq("firm_id", firmId),
    NEWEST_FIRST
  );
  if (error) throw error;
  return data.map(rowToLibrary);
}

/**
 * Lean fetch of just the name/vendor/sku dedup keys — no jsonb blobs with
 * embedded images. Used by mirror-to-library's "already in the library?" check.
 */
export async function fetchLibraryKeys(
  firmId: string
): Promise<{ name: string; vendor: string; sku: string }[]> {
  // `id` is selected only so the rows can be paged.
  const { data, error } = await fetchAllRows<{
    id: string;
    name: string | null;
    vendor: string | null;
    sku: string | null;
  }>(
    (opts) =>
      supabase
        .from("library_items")
        .select("id, name:data->>name, vendor:data->>vendor, sku:data->>sku", opts)
        .eq("firm_id", firmId),
    // Order is irrelevant for a dedup set; id is simply the cheapest to give.
    { column: "id", ascending: true, compare: byId }
  );
  if (error) throw error;
  return data.map((r) => ({
    name: r.name ?? "",
    vendor: r.vendor ?? "",
    sku: r.sku ?? "",
  }));
}

/** Insert one library item for the firm. The DB generates the uuid. */
export async function createLibraryItem(
  firmId: string,
  li: Omit<LibraryItem, "id">
): Promise<LibraryItem> {
  if (isDataUrlImage(li.imageUrl)) {
    const url = await offloadDataUrl(li.imageUrl!, firmId);
    if (url) li = { ...li, imageUrl: url };
  }
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
  const { items: uploaded } = await offloadItemImages(lis, firmId);
  const rows = uploaded.map((li) => ({ data: libraryToData(li), firm_id: firmId }));
  const { data, error } = await supabase
    .from("library_items")
    .insert(rows)
    .select("*");
  if (error) throw error;
  return (data as LibraryRow[]).map(rowToLibrary);
}

/** Update a library item in place. Ownership enforced by RLS. */
export async function saveLibraryItem(
  li: LibraryItem,
  firmId: string
): Promise<LibraryItem> {
  if (isDataUrlImage(li.imageUrl)) {
    const url = await offloadDataUrl(li.imageUrl!, firmId);
    if (url) li = { ...li, imageUrl: url };
  }
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
