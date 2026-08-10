import { Fragment, useCallback } from "react";
import type { InventoryItem } from "../types";
import ItemCard from "./ItemCard";
import type { CardItem } from "./ItemCard";
import CatalogFilterBar from "./CatalogFilterBar";
import { hasActiveFilter, useCatalogFilter } from "./useCatalogFilter";
import { formatDate, formatPrice } from "../util";

/**
 * The stock details under an inventory card — acquisition date, the firm's own
 * numbers, and the cost side of the price (net + freight). Rows are omitted
 * when unset, so an entry with none of them looks exactly as it did before.
 */
function StockDetails({ inv }: { inv: InventoryItem }) {
  const rows: [string, string][] = [];
  if (inv.inventoryNumber) rows.push(["Inv #", inv.inventoryNumber]);
  if (inv.poNumber) rows.push(["PO #", inv.poNumber]);
  if (inv.acquiredDate) rows.push(["Acquired", formatDate(inv.acquiredDate)]);
  // The card's own price line already shows the retail figure, so net and
  // retail are only spelled out when there's a cost to compare them against.
  // Freight stands on its own — it's a cost the firm tracks whether or not the
  // net price was filled in.
  if (inv.netPrice !== null && inv.netPrice !== undefined) {
    rows.push(["Net", formatPrice(inv.netPrice)]);
  }
  if (inv.freight !== null && inv.freight !== undefined) {
    rows.push(["Freight", formatPrice(inv.freight)]);
  }
  if (
    inv.netPrice !== null &&
    inv.netPrice !== undefined &&
    inv.retailPrice !== null &&
    inv.retailPrice !== undefined
  ) {
    rows.push(["Retail", formatPrice(inv.retailPrice)]);
  }
  if (!rows.length) return null;
  return (
    <dl className="card-specs inv-meta">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

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
  /** Open the importer, targeted at the inventory. */
  onImport: () => void;
  /** Download the given entries as Word inventory detail forms. */
  onExportDocx: (items: InventoryItem[]) => void;
  /** Export the same detail form as PowerPoint slides. */
  onExportPptx: (items: InventoryItem[]) => void;
  /** True while an export is building, to stop a double-click. */
  exporting?: boolean;
  /** Print the given entries as the firm's inventory detail form. */
  onPrint: (items: InventoryItem[]) => void;
  /** Delete the selected entries (with confirmation). */
  onDeleteSelected: () => void;
  /** Deselect everything (the selection strip's "Clear selection"). */
  onClearSelection: () => void;
  /** Copy the selected entries into the open client project. */
  onAddSelectedToClient: () => void;
  /** Name of the active client project, for the "add to" button label. */
  activeClientName: string | null;
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
  onImport,
  onExportDocx,
  onExportPptx,
  exporting = false,
  onPrint,
  onDeleteSelected,
  onClearSelection,
  onAddSelectedToClient,
  activeClientName,
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
          <button className="btn primary" onClick={onAdd}>
            ＋ Add item
          </button>
          <button
            className="btn"
            onClick={onAddFromDatabase}
            title="Copy pieces from your database into inventory"
          >
            From database
          </button>
          <button
            className="btn"
            onClick={onImport}
            title="Import inventory forms from Word, or a spreadsheet, PowerPoint or PDF"
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
                ? "Print the entries matching these filters as inventory detail forms"
                : "Print every inventory entry as an inventory detail form"
            }
          >
            Print{hasFilter ? ` (${filtered.length})` : ""}
          </button>
          <div className="menu">
            <button className="btn" disabled={inventory.length === 0}>
              Export ▾
            </button>
            <div className="menu-list">
              <button
                disabled={filtered.length === 0 || exporting}
                onClick={() => onExportDocx(filtered)}
                title="One Word inventory detail form per entry, on your letterhead"
              >
                Word forms (.docx)
                {hasFilter ? ` — ${filtered.length} shown` : ""}
              </button>
              <button
                disabled={selectedCount === 0 || exporting}
                onClick={() =>
                  onExportDocx(inventory.filter((inv) => selected.has(inv.id)))
                }
              >
                Word — selected items
                {selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
              <hr className="menu-sep" />
              <button
                disabled={filtered.length === 0 || exporting}
                onClick={() => onExportPptx(filtered)}
                title="The same inventory detail form, one slide per entry"
              >
                PowerPoint (.pptx)
                {hasFilter ? ` — ${filtered.length} shown` : ""}
              </button>
              <button
                disabled={selectedCount === 0 || exporting}
                onClick={() =>
                  onExportPptx(inventory.filter((inv) => selected.has(inv.id)))
                }
              >
                PowerPoint — selected items
                {selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
            </div>
          </div>
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
                ? `Copy the selected pieces into ${activeClientName} (stock is not changed)`
                : "Open a client first"
            }
          >
            Add to {activeClientName ?? "client"}
          </button>
          <button
            className="btn ghost small"
            onClick={() =>
              onPrint(inventory.filter((inv) => selected.has(inv.id)))
            }
            title="Print only the selected entries as inventory detail forms"
          >
            Print selected
          </button>
          <button
            className="btn ghost small danger"
            onClick={onDeleteSelected}
            title="Remove the selected entries from your inventory"
          >
            Remove selected
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
                  <>
                    <StockDetails inv={inv} />
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
                  </>
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
