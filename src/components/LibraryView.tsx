import { useCallback } from "react";
import type { LibraryItem } from "../types";
import ItemCard from "./ItemCard";
import type { CardItem } from "./ItemCard";
import CatalogFilterBar from "./CatalogFilterBar";
import { hasActiveFilter, useCatalogFilter } from "./useCatalogFilter";

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
  /** Print the given database items as tear sheets (all-filtered or selected). */
  onPrint: (items: LibraryItem[]) => void;
  /** Delete the selected database items (with confirmation). */
  onDeleteSelected: () => void;
  /** Deselect everything (the selection strip's "Clear selection"). */
  onClearSelection: () => void;
  /** Copy the selected library items into the open client project. */
  onAddSelectedToClient: () => void;
  /** Copy the selected library items into the firm's inventory. */
  onAddSelectedToInventory: () => void;
  /** Name of the active client project, for the "add to" button label. */
  activeClientName: string | null;
  /** Show the vendor on each card (visual only). */
  showVendor?: boolean;
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
  onPrint,
  onDeleteSelected,
  onClearSelection,
  onAddSelectedToClient,
  onAddSelectedToInventory,
  activeClientName,
  showVendor = true,
}: Props) {
  const { filter, setFilter, filtered } = useCatalogFilter(library);
  const hasFilter = hasActiveFilter(filter);
  const selectedCount = selected.size;
  // Stable edit handler so the memoized cards can skip re-renders.
  const handleEdit = useCallback(
    (item: CardItem) => onEdit(item as LibraryItem),
    [onEdit]
  );

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
          <button className="btn primary" onClick={onAdd}>
            ＋ Add to database
          </button>
          <button
            className="btn"
            onClick={onImport}
            title="Import items from a spreadsheet or PowerPoint file"
          >
            Import
          </button>
          <span className="divider" />
          <button
            className="btn"
            onClick={() => onPrint(filtered)}
            disabled={filtered.length === 0}
            title={
              hasFilter
                ? "Print the items matching these filters as tear sheets"
                : "Print every database item as a tear sheet"
            }
          >
            Print{hasFilter ? ` (${filtered.length})` : ""}
          </button>
        </div>
      </section>

      <CatalogFilterBar
        items={library}
        filter={filter}
        onChange={setFilter}
        placeholder="Search the database…"
      >
        <span className="muted small filter-count">
          {filtered.length} of {library.length}
        </span>
      </CatalogFilterBar>

      {/* Batch actions for the current selection. */}
      {selectedCount > 0 && (
        <section className="selectbar has-selection">
          <span className="selectbar-count">{selectedCount} selected</span>
          <button
            className="btn small primary"
            onClick={onAddSelectedToClient}
            disabled={!activeClientName}
            title={
              activeClientName
                ? `Copy the selected pieces into ${activeClientName}`
                : "Open a client first"
            }
          >
            Add to {activeClientName ?? "client"}
          </button>
          <button
            className="btn ghost small"
            onClick={onAddSelectedToInventory}
            title="Copy the selected pieces into your inventory (pieces already stocked have their quantity increased)"
          >
            Add to inventory
          </button>
          <button
            className="btn ghost small"
            onClick={() => onPrint(library.filter((li) => selected.has(li.id)))}
            title="Print only the selected items as tear sheets"
          >
            Print selected
          </button>
          <button
            className="btn ghost small danger"
            onClick={onDeleteSelected}
            title="Delete the selected items from your database"
          >
            Delete selected
          </button>
          <span className="spacer" />
          <button className="btn ghost small" onClick={onClearSelection}>
            Clear selection
          </button>
        </section>
      )}

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
                showVendor={showVendor}
                onToggleSelect={onToggleSelect}
                onEdit={handleEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
