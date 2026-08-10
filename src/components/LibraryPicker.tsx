import { useCallback, useState } from "react";
import type { LibraryItem } from "../types";
import { toggledSet } from "../util";
import ItemCard from "./ItemCard";
import CatalogFilterBar from "./CatalogFilterBar";
import { useCatalogFilter } from "./useCatalogFilter";

interface Props<T extends LibraryItem> {
  library: T[];
  loading: boolean;
  error: string | null;
  /** Where the picked pieces are going, e.g. a client name or "your database". */
  clientName: string;
  /** Where they're coming from — names the modal, search box and empty state. */
  sourceName?: string;
  /** What to do about an empty source, shown under "Your … is empty." */
  emptyHint?: string;
  onConfirm: (items: T[]) => void;
  onClose: () => void;
}

/**
 * Modal for copying pieces out of one catalog into another — the database into
 * a client or the inventory, the inventory into a client or the database. Pick
 * any number, then confirm; each lands as an independent copy, and the source
 * catalog is left as it was.
 *
 * Generic over the catalog so the confirm handler gets back exactly what it was
 * given (inventory entries keep their stock fields for the caller to convert).
 */
export default function LibraryPicker<T extends LibraryItem>({
  library,
  loading,
  error,
  clientName,
  sourceName = "database",
  emptyHint = "Build it from the Database tab, then pull pieces in here.",
  onConfirm,
  onClose,
}: Props<T>) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { filter, setFilter, filtered } = useCatalogFilter(library);

  const toggle = useCallback(
    (id: string) => setPicked((prev) => toggledSet(prev, id)),
    []
  );

  function confirm() {
    const chosen = library.filter((li) => picked.has(li.id));
    if (chosen.length) onConfirm(chosen);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide tall" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            Add from {sourceName} → {clientName}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <CatalogFilterBar
          items={library}
          filter={filter}
          onChange={setFilter}
          placeholder={`Search the ${sourceName}…`}
        />

        {error && <p className="status-err">{error}</p>}

        <div className="modal-scroll">
          {loading ? (
            <div className="loader" aria-label={`Loading ${sourceName}`}>
              <span className="spinner" />
            </div>
          ) : library.length === 0 ? (
            <div className="empty">
              <p>Your {sourceName} is empty.</p>
              <p className="muted">{emptyHint}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <p>No {sourceName} items match those filters.</p>
            </div>
          ) : (
            <div className="gallery">
              {filtered.map((li) => (
                <ItemCard
                  key={li.id}
                  item={li}
                  selected={picked.has(li.id)}
                  onToggleSelect={toggle}
                />
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <span className="muted small">{picked.size} selected</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={confirm}
            disabled={picked.size === 0}
          >
            Add {picked.size > 0 ? `${picked.size} ` : ""}to {clientName}
          </button>
        </div>
      </div>
    </div>
  );
}
