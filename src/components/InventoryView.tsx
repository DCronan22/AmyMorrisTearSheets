import { useCallback } from "react";
import type { InventoryItem } from "../types";
import ItemCard from "./ItemCard";
import type { CardItem } from "./ItemCard";
import CatalogFilterBar from "./CatalogFilterBar";
import { hasActiveFilter, useCatalogFilter } from "./useCatalogFilter";

interface Props {
  inventory: InventoryItem[];
  loading: boolean;
  error: string | null;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (inv: InventoryItem) => void;
  onDelete: (id: string) => void;
  /** Set an entry's on-hand quantity (the +/− stepper). Zero is allowed. */
  onSetQuantity: (inv: InventoryItem, quantity: number) => void;
  /** Open the "add from database" picker. */
  onAddFromDatabase: () => void;
  /** Print the given inventory entries as tear sheets. */
  onPrint: (items: InventoryItem[]) => void;
  /** Delete the selected entries (with confirmation). */
  onDeleteSelected: () => void;
  /** Show the vendor on each card (visual only). */
  showVendor?: boolean;
}

/**
 * The firm's physical inventory: browse, search/filter, adjust on-hand
 * quantities, add, edit, delete, and pull pieces in from the database.
 * Reuses the shared ItemCard with a quantity stepper in each card.
 */
export default function InventoryView({
  inventory,
  loading,
  error,
  selected,
  onToggleSelect,
  onAdd,
  onEdit,
  onDelete,
  onSetQuantity,
  onAddFromDatabase,
  onPrint,
  onDeleteSelected,
  showVendor = true,
}: Props) {
  const { filter, setFilter, filtered } = useCatalogFilter(inventory);
  const hasFilter = hasActiveFilter(filter);
  const selectedCount = selected.size;
  // Stable edit handler so the memoized cards can skip re-renders.
  const handleEdit = useCallback(
    (item: CardItem) => onEdit(item as InventoryItem),
    [onEdit]
  );

  return (
    <div className="library">
      <section className="library-head">
        <div>
          <h1>Inventory</h1>
          <p className="muted">
            What your business has in stock right now, with quantities.
          </p>
        </div>
        <div className="library-actions">
          <button
            className="btn"
            onClick={onAddFromDatabase}
            title="Copy pieces from your database into inventory"
          >
            ＋ From database
          </button>
          <button className="btn" onClick={onAdd}>
            + Add item
          </button>
          <button
            className="btn"
            onClick={() => onPrint(filtered)}
            disabled={filtered.length === 0}
            title={
              hasFilter
                ? "Print the entries matching these filters as tear sheets"
                : "Print every inventory entry as a tear sheet"
            }
          >
            🖶 Print{hasFilter ? ` (${filtered.length})` : ""}
          </button>
          <button
            className="btn"
            onClick={() =>
              onPrint(inventory.filter((inv) => selected.has(inv.id)))
            }
            disabled={selectedCount === 0}
            title="Print only the selected entries as tear sheets"
          >
            🖶 Print selected ({selectedCount})
          </button>
          <button
            className="btn danger"
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            title="Remove the selected entries from your inventory"
          >
            Remove selected ({selectedCount})
          </button>
        </div>
      </section>

      <CatalogFilterBar
        items={inventory}
        filter={filter}
        onChange={setFilter}
        placeholder="Search your inventory…"
      >
        <span className="muted small filter-count">
          {filtered.length} of {inventory.length}
        </span>
      </CatalogFilterBar>

      {error && <p className="status-err">{error}</p>}

      <main className="content">
        {loading ? (
          <div className="loader" aria-label="Loading inventory">
            <span className="spinner" />
          </div>
        ) : inventory.length === 0 ? (
          <div className="empty">
            <p>Your inventory is empty.</p>
            <p className="muted">
              Add an item here, or select pieces in your Database and use “Add
              to inventory” to start tracking stock.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <p>No inventory entries match those filters.</p>
          </div>
        ) : (
          <div className="gallery">
            {filtered.map((inv) => (
              <ItemCard
                key={inv.id}
                item={inv}
                selected={selected.has(inv.id)}
                showVendor={showVendor}
                onToggleSelect={onToggleSelect}
                onEdit={handleEdit}
                onDelete={onDelete}
                extraControl={
                  <div className="inv-qty">
                    <span
                      className={`inv-qty-badge${
                        inv.quantity === 0 ? " out" : ""
                      }`}
                    >
                      {inv.quantity === 0
                        ? "Out of stock"
                        : `${inv.quantity} in stock`}
                    </span>
                    <span className="inv-qty-stepper">
                      <button
                        type="button"
                        onClick={() => onSetQuantity(inv, inv.quantity - 1)}
                        disabled={inv.quantity === 0}
                        aria-label={`Decrease quantity of ${
                          inv.name || "item"
                        }`}
                        title="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="inv-qty-num">{inv.quantity}</span>
                      <button
                        type="button"
                        onClick={() => onSetQuantity(inv, inv.quantity + 1)}
                        aria-label={`Increase quantity of ${
                          inv.name || "item"
                        }`}
                        title="Increase quantity"
                      >
                        +
                      </button>
                    </span>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
