import { useMemo } from "react";
import type { ReactNode } from "react";
import { distinct, distinctTags } from "../util";
import type { Filterable } from "../util";
import { EMPTY_CATALOG_FILTER, hasActiveFilter } from "./useCatalogFilter";
import type { CatalogFilter } from "./useCatalogFilter";

interface Props<T extends Filterable> {
  /** The UNfiltered items — used to build the dropdown options. */
  items: T[];
  filter: CatalogFilter;
  onChange: (f: CatalogFilter) => void;
  placeholder?: string;
  /** When given, also offer a room filter with these names (client view). */
  rooms?: string[];
  /** Extra trailing content, e.g. an "N of M" count. */
  children?: ReactNode;
}

/**
 * The search box + vendor/collection/category (+ optional room) selects + Clear
 * button used by the client view, the database view, and the database picker.
 */
export default function CatalogFilterBar<T extends Filterable>({
  items,
  filter,
  onChange,
  placeholder = "Search items…",
  rooms,
  children,
}: Props<T>) {
  // Vendor and category are multi-value, so split their tags for the dropdowns.
  const vendors = useMemo(() => distinctTags(items, "vendor"), [items]);
  const collections = useMemo(() => distinct(items, "collection"), [items]);
  const categories = useMemo(() => distinctTags(items, "category"), [items]);
  const set = (patch: Partial<CatalogFilter>) => onChange({ ...filter, ...patch });

  return (
    <section className="filters">
      <input
        className="search"
        placeholder={placeholder}
        value={filter.search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <select
        value={filter.vendor}
        onChange={(e) => set({ vendor: e.target.value })}
      >
        <option value="">All vendors</option>
        {vendors.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <select
        value={filter.collection}
        onChange={(e) => set({ collection: e.target.value })}
      >
        <option value="">All collections</option>
        {collections.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={filter.category}
        onChange={(e) => set({ category: e.target.value })}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {rooms && (
        <select
          value={filter.room}
          onChange={(e) => set({ room: e.target.value })}
        >
          <option value="">All rooms</option>
          {rooms.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      )}
      {hasActiveFilter(filter) && (
        <button
          className="btn ghost small"
          onClick={() => onChange(EMPTY_CATALOG_FILTER)}
        >
          Clear
        </button>
      )}
      {children}
    </section>
  );
}
