import { useEffect, useRef, useState } from "react";
import type { Item } from "../types";
import { parseSpreadsheet, downloadTemplate } from "../spreadsheet";
import { parsePptx } from "../pptx";

interface Props {
  onImport: (items: Item[], mode: "append" | "replace") => void | Promise<void>;
  onClose: () => void;
  /** Where the import lands — drives the wording and the action buttons. */
  target?: "client" | "library";
  /** Name of the active client project (shown when target is "client"). */
  destinationName?: string;
}

// Files we can actually parse. Anything else is rejected up front with a clear
// message instead of being handed to a parser that would throw something cryptic.
const SUPPORTED = /\.(xlsx|xls|csv|pptx)$/i;
const ACCEPT = ".xlsx,.xls,.csv,.pptx";
// xlsx/pptx are zipped, so even big decks stay well under this. The guard is
// really there to stop someone dropping a 500 MB video and freezing the tab.
const MAX_BYTES = 25 * 1024 * 1024;

/** Drag-and-drop spreadsheet / PowerPoint importer with auto column mapping. */
export default function ImportPanel({
  onImport,
  onClose,
  target = "client",
  destinationName,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Item[] | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  // Parsing a file (reading/mapping) vs. submitting the matched items onward.
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Depth counter so dragging over a child element doesn't clear the highlight
  // (dragenter/dragleave fire for every nested node).
  const dragDepth = useRef(0);

  const toLibrary = target === "library";
  const destination = toLibrary
    ? "your database"
    : destinationName
    ? `“${destinationName}”`
    : "this project";

  // Escape closes the modal (unless an import is mid-flight); focus the close
  // button on open so keyboard users land inside the dialog.
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting, busy]);

  async function handleFile(file: File) {
    // Fresh selection: wipe any previous outcome so stale messages don't linger.
    setError(null);
    setStatus(null);
    setNote(null);

    if (!SUPPORTED.test(file.name)) {
      setError(
        `“${file.name}” isn’t a supported file. Please choose an Excel (.xlsx, .xls), CSV, or PowerPoint (.pptx) file.`
      );
      return;
    }
    if (file.size === 0) {
      setError(`“${file.name}” is empty — there’s nothing to import.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `“${file.name}” is too large (over ${Math.round(
          MAX_BYTES / (1024 * 1024)
        )} MB). Try exporting just the items you need.`
      );
      return;
    }

    const isPptx = /\.pptx$/i.test(file.name);
    setBusy(true);
    setStatus(
      isPptx ? `Reading slides from “${file.name}”…` : `Reading “${file.name}”…`
    );
    try {
      const result = isPptx
        ? await parsePptx(file)
        : await parseSpreadsheet(file);

      if (result.items.length === 0) {
        setStatus(null);
        if (isPptx) {
          setError(
            "No tear sheets found in that PowerPoint. Each slide should have the product name, dimensions, price, and lead time."
          );
        } else if (result.matchedColumns.length === 0) {
          setError(
            "We couldn’t recognize any columns. Make sure the first row has headers like Item, Vendor, and Price — or download the template below."
          );
        } else {
          setError(
            `We matched your columns (${result.matchedColumns.join(
              ", "
            )}) but found no rows with item data underneath.`
          );
        }
        return;
      }

      setPending(result.items);
      setMatched(result.matchedColumns);
      setStatus(
        `Found ${result.items.length} item${
          result.items.length === 1 ? "" : "s"
        }${
          result.skippedRows
            ? ` (${result.skippedRows} ${isPptx ? "blank slide" : "blank row"}${
                result.skippedRows === 1 ? "" : "s"
              } skipped)`
            : ""
        }.`
      );
    } catch (e) {
      setStatus(null);
      // Parsers can throw library-internal errors; show a friendly line and keep
      // the technical detail only as a hint.
      const detail = e instanceof Error ? e.message : "";
      setError(
        `We couldn’t read “${file.name}”. It may be corrupted or not a real ${
          isPptx ? "PowerPoint" : "spreadsheet"
        } file.${detail ? ` (${detail})` : ""}`
      );
    } finally {
      setBusy(false);
    }
  }

  // Take the first file from a picker/drop, warning when several were chosen.
  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setNote(
        `Importing one file at a time — using “${files[0].name}”. Re-open Import to add the others.`
      );
    }
    void handleFile(files[0]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy || submitting) return;
    handleFiles(e.dataTransfer.files);
  }

  async function confirm(mode: "append" | "replace") {
    if (!pending || pending.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onImport(pending, mode);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn’t complete the import. Please try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => !submitting && !busy && onClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-busy={busy || submitting}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="import-title">Import into {destination}</h2>
          <button
            ref={closeRef}
            className="icon-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close import"
          >
            ×
          </button>
        </header>

        {!pending && (
          <>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="Drop a file here, or activate to browse"
              aria-disabled={busy}
              onDragEnter={(e) => {
                e.preventDefault();
                dragDepth.current += 1;
                if (!busy) setDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => {
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
              }}
              onDrop={onDrop}
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !busy) {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
            >
              <div className="dropzone-icon" aria-hidden="true">
                {busy ? <span className="spinner" /> : "⬆"}
              </div>
              <p>
                <strong>
                  {busy
                    ? "Reading your file…"
                    : "Drop an Excel, CSV, or PowerPoint file here"}
                </strong>
              </p>
              {!busy && <p className="muted">or click to browse</p>}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  // Reset so picking the SAME file again still fires onChange.
                  e.target.value = "";
                }}
              />
            </div>
            <p className="muted small">
              {toLibrary
                ? "Imported pieces are added to your master database (existing entries are kept)."
                : `Imported items are added to ${destination}.`}
              <br />
              <strong>Spreadsheets:</strong> columns are matched automatically
              (Item, Vendor, Collection, Category, Room, SKU, Price, Qty,
              Dimensions, Material, Color, Lead Time, Notes, Image URL, Product
              URL).{" "}
              <button className="link-btn" onClick={downloadTemplate}>
                Download a blank template
              </button>
              <br />
              <strong>PowerPoint (.pptx):</strong> each slide becomes an item —
              the product name, dimensions, price, lead time, room, and photo are
              pulled from the slide automatically.
            </p>
          </>
        )}

        {status && <p className="status-ok">{status}</p>}
        {note && <p className="muted small">{note}</p>}
        {error && (
          <p className="status-err" role="alert">
            {error}
          </p>
        )}

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
              <button
                className="btn ghost"
                onClick={() => {
                  setPending(null);
                  setStatus(null);
                  setMatched([]);
                }}
                disabled={submitting}
              >
                Choose a different file
              </button>
              {toLibrary ? (
                <button
                  className="btn primary"
                  onClick={() => confirm("append")}
                  disabled={submitting || pending.length === 0}
                >
                  {submitting ? "Adding…" : `Add ${pending.length} to database`}
                </button>
              ) : (
                <>
                  <button
                    className="btn"
                    onClick={() => confirm("append")}
                    disabled={submitting || pending.length === 0}
                  >
                    {submitting ? "Adding…" : "Add to current items"}
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => confirm("replace")}
                    disabled={submitting || pending.length === 0}
                  >
                    {submitting ? "Replacing…" : "Replace all items"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
