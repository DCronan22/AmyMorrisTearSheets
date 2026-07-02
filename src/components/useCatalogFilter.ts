import { useMemo, useState } from "react";
import { filterCatalog } from "../util";
import type { Filterable } from "../util";

/** The shared search + dropdown filter state for any catalog view. */
export interface CatalogFilter {
  search: string;
  vendor: string;
  collection: string;
  category: string;
  room: string;
}

export const EMPTY_CATALOG_FILTER: CatalogFilter = {
  search: "",
  vendor: "",
  collection: "",
  category: "",
  room: "",
};

export function hasActiveFilter(f: CatalogFilter): boolean {
  return Boolean(f.search || f.vendor || f.collection || f.category || f.room);
}

/**
 * Own the filter state for a catalog view and derive the filtered list.
 * Pair with <CatalogFilterBar filter={filter} onChange={setFilter} …/>.
 */
export function useCatalogFilter<T extends Filterable & { room?: string }>(
  items: T[]
): {
  filter: CatalogFilter;
  setFilter: (f: CatalogFilter) => void;
  filtered: T[];
} {
  const [filter, setFilter] = useState(EMPTY_CATALOG_FILTER);
  const filtered = useMemo(() => filterCatalog(items, filter), [items, filter]);
  return { filter, setFilter, filtered };
}
