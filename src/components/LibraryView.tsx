import { useMemo, useState } from "react";
import type { LibraryItem } from "../types";
import { distinct, filterCatalog } from "../util";
import ItemCard from "./ItemCard";

interface Props {
  library: LibraryItem[];
  loading: boolean;
  error: string | null;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (li: LibraryItem) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  /** Copy the selected library items into the open client project. */
  onAddSelectedToClient: () => void;
  /** Name of the active client project, for the "add to" button label. */
  activeClientName: string | null;
  selectedCount: number;
}

/**
 * The firm's master library: browse, search/filter, add, edit, delete, import,
 * and push selected pieces into the open client. Reuses the shared ItemCard.
 */
export default function LibraryView({
  library,
  loading,
  error,
  selected,
  onToggleSelect,
  onAdd,
  onEdit,
  onDelete,
  onImport,
  onAddSelectedToClient,
  activeClientName,
  selectedCount,
}: Props) {
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState("");
  const [collection, setCollection] = useState("");
  const [category, setCategory] = useState("");

  const vendors = distinct(library, "vendor");
  const collections = distinct(library, "collection");
  const categories = distinct(library, "category");

  const filtered = useMemo(
    () => filterCatalog(library, { search, vendor, collection, category }),
    [library, search, vendor, collection, category]
  );

  const hasFilter = Boolean(search || vendor || collection || category);

  return (
    <div className="library">
      <section className="library-head">
        <div>
          <h1>Database</h1>
          <p className="muted">
            Your master collection of tear sheets — reuse them across any client.
          </p>
        </div>
        <div className="library-actions">
          <button className="btn" onClick={onImport}>
            ⬆ Import
          </button>
          <button className="btn" onClick={onAdd}>
            + Add to database
          </button>
          <button
            className="btn primary"
            onClick={onAddSelectedToClient}
            disabled={selectedCount === 0 || !activeClientName}
            title={
              activeClientName
                ? `Copy selected into ${activeClientName}`
                : "Open a client first"
            }
          >
            Add {selectedCount > 0 ? `${selectedCount} ` : ""}to{" "}
            {activeClientName ?? "client"}
          </button>
        </div>
      </section>

      <section className="filters">
        <input
          className="search"
          placeholder="Search the database…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          <option value="">All collections</option>
          {collections.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            className="btn ghost small"
            onClick={() => {
              setSearch("");
              setVendor("");
              setCollection("");
              setCategory("");
            }}
          >
            Clear
          </button>
        )}
        <span className="muted small filter-count">
          {filtered.length} of {library.length}
        </span>
      </section>

      {error && <p className="status-err">{error}</p>}

      <main className="content">
        {loading ? (
          <div className="loader" aria-label="Loading database">
            <span className="spinner" />
          </div>
        ) : library.length === 0 ? (
          <div className="empty">
            <p>Your database is empty.</p>
            <p className="muted">
              Add a piece, import a spreadsheet, or use “★ Save to database” on a
              client item to start building your master collection.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <p>No database items match those filters.</p>
          </div>
        ) : (
          <div className="gallery">
            {filtered.map((li) => (
              <ItemCard
                key={li.id}
                item={li}
                selected={selected.has(li.id)}
                onToggleSelect={onToggleSelect}
                onEdit={(item) => onEdit(item as LibraryItem)}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
