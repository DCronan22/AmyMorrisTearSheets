import { useRef, useState } from "react";
import type { Item } from "../types";
import { parseSpreadsheet, downloadTemplate } from "../spreadsheet";

interface Props {
  onImport: (items: Item[], mode: "append" | "replace") => void;
  onClose: () => void;
}

/** Drag-and-drop spreadsheet importer with auto column mapping. */
export default function ImportPanel({ onImport, onClose }: Props) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Item[] | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setStatus(`Reading “${file.name}”…`);
    try {
      const result = await parseSpreadsheet(file);
      if (result.items.length === 0) {
        setError(
          "No items found. Make sure the first row has column headers like Item, Vendor, Price."
        );
        setStatus(null);
        return;
      }
      setPending(result.items);
      setMatched(result.matchedColumns);
      setStatus(
        `Found ${result.items.length} item${
          result.items.length === 1 ? "" : "s"
        }${result.skippedRows ? ` (${result.skippedRows} blank rows skipped)` : ""}.`
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not read that file."
      );
      setStatus(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function confirm(mode: "append" | "replace") {
    if (pending) onImport(pending, mode);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Import from spreadsheet</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!pending && (
          <>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <div className="dropzone-icon">⬆</div>
              <p>
                <strong>Drop an Excel or CSV file here</strong>
              </p>
              <p className="muted">or click to browse</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
            <p className="muted small">
              Columns are matched automatically (Item, Vendor, Category, Room,
              SKU, Price, Qty, Dimensions, Material, Color, Lead Time, Notes,
              Image URL, Product URL).{" "}
              <button className="link-btn" onClick={downloadTemplate}>
                Download a blank template
              </button>
            </p>
          </>
        )}

        {status && <p className="status-ok">{status}</p>}
        {error && <p className="status-err">{error}</p>}

        {pending && (
          <>
            <p className="muted small">
              Matched columns: {matched.length ? matched.join(", ") : "none"}
            </p>
            <div className="import-preview">
              {pending.slice(0, 6).map((it) => (
                <div key={it.id} className="import-row">
                  <span className="import-name">{it.name || "(no name)"}</span>
                  <span className="muted">{it.vendor}</span>
                  <span className="muted">{it.room}</span>
                </div>
              ))}
              {pending.length > 6 && (
                <div className="muted small">
                  …and {pending.length - 6} more
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPending(null)}>
                Choose a different file
              </button>
              <button className="btn" onClick={() => confirm("append")}>
                Add to current items
              </button>
              <button className="btn primary" onClick={() => confirm("replace")}>
                Replace all items
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
