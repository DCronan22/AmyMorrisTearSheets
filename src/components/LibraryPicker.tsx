import { useCallback, useState } from "react";
import type { LibraryItem } from "../types";
import { toggledSet } from "../util";
import ItemCard from "./ItemCard";
import CatalogFilterBar from "./CatalogFilterBar";
import { useCatalogFilter } from "./useCatalogFilter";

interface Props {
  library: LibraryItem[];
  loading: boolean;
  error: string | null;
  clientName: string;
  onConfirm: (items: LibraryItem[]) => void;
  onClose: () => void;
}

/**
 * Modal for dropping pieces from the master library into the open client. Pick
 * any number, then confirm — each lands as an independent copy under
 * "Unassigned" in the client project.
 */
export default function LibraryPicker({
  library,
  loading,
  error,
  clientName,
  onConfirm,
  onClose,
}: Props) {
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
          <h2>Add from database → {clientName}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <CatalogFilterBar
          items={library}
          filter={filter}
          onChange={setFilter}
          placeholder="Search the database…"
        />

        {error && <p className="status-err">{error}</p>}

        <div className="modal-scroll">
          {loading ? (
            <div className="loader" aria-label="Loading database">
              <span className="spinner" />
            </div>
          ) : library.length === 0 ? (
            <div className="empty">
              <p>Your database is empty.</p>
              <p className="muted">
                Build it from the Database tab, then pull pieces in here.
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
