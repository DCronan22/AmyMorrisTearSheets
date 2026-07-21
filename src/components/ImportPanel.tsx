import { useCallback, useEffect, useRef, useState } from "react";
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
// Per-file guard. xlsx/pptx are zipped, so even large photo-heavy decks stay
// well under this; it's really just here to stop someone dropping a giant file
// (e.g. a 500 MB video) and freezing the tab while the browser tries to parse it.
const MAX_BYTES = 150 * 1024 * 1024;
// Upper bound on how many files one folder import will parse in a single pass,
// so a stray huge directory can't lock up the tab. Import sub-folders instead.
const MAX_FILES = 2000;

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
  const folderInputRef = useRef<HTMLInputElement>(null);
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

  // `webkitdirectory` isn't in the React input types, so set it on the element
  // directly — it turns the second file input into a whole-folder picker whose
  // FileList already contains every file in the tree (nested folders included).
  // A callback ref (not a mount-once effect) so it re-applies every time the
  // input remounts: it lives inside a `!busy` block that unmounts mid-import.
  const attachFolderInput = useCallback((el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    el?.setAttribute("webkitdirectory", "");
  }, []);

  // Parse a whole batch of files — from a folder pick, a multi-file selection,
  // or a dropped folder tree — into one combined set of items. Every supported
  // file is parsed; unsupported, oversized, empty, or unreadable files are
  // counted and reported at the end rather than aborting the run.
  async function processFiles(files: File[]) {
    // Fresh selection: wipe any previous outcome so stale messages don't linger.
    setError(null);
    setStatus(null);
    setNote(null);

    const supported = files.filter((f) => SUPPORTED.test(f.name));
    const unsupported = files.length - supported.length;
    const nonEmpty = supported.filter((f) => f.size > 0);
    const tooBig = nonEmpty.filter((f) => f.size > MAX_BYTES);
    const usable = nonEmpty.filter((f) => f.size <= MAX_BYTES);

    if (usable.length === 0) {
      setBusy(false);
      if (supported.length === 0) {
        setError(
          "No Excel, CSV, or PowerPoint files were found. Folders are searched all the way down, so double-check the files are really in there."
        );
      } else if (tooBig.length > 0) {
        setError(
          `Every file was over ${Math.round(
            MAX_BYTES / (1024 * 1024)
          )} MB and was skipped. Try exporting slimmer decks.`
        );
      } else {
        setError("Those files were all empty — there’s nothing to import.");
      }
      return;
    }

    if (usable.length > MAX_FILES) {
      setBusy(false);
      setError(
        `That’s ${usable.length} files at once — more than the ${MAX_FILES}-file limit. Import a few sub-folders at a time.`
      );
      return;
    }

    const many = usable.length > 1;
    setBusy(true);
    const allItems: Item[] = [];
    const matchedSet = new Set<string>();
    let slidesSkipped = 0;
    let filesFailed = 0;

    for (let i = 0; i < usable.length; i++) {
      const file = usable[i];
      const isPptx = /\.pptx$/i.test(file.name);
      setStatus(
        many
          ? `Reading file ${i + 1} of ${usable.length}: “${file.name}”…`
          : isPptx
          ? `Reading slides from “${file.name}”…`
          : `Reading “${file.name}”…`
      );
      try {
        const result = isPptx
          ? await parsePptx(file)
          : await parseSpreadsheet(file);
        for (const it of result.items) allItems.push(it);
        for (const c of result.matchedColumns) matchedSet.add(c);
        slidesSkipped += result.skippedRows;
      } catch {
        // One malformed file shouldn't sink the whole folder — count it and go on.
        filesFailed++;
      }
    }
    setBusy(false);

    if (allItems.length === 0) {
      setStatus(null);
      setError(
        many
          ? `We read ${usable.length} files but couldn’t pull any items out. For PowerPoint, each slide should have the product name, dimensions, price, and lead time.`
          : "No tear sheets found in that file. Each slide should have the product name, dimensions, price, and lead time — or, for a spreadsheet, headers like Item, Vendor, and Price."
      );
      return;
    }

    setPending(allItems);
    setMatched([...matchedSet]);
    setStatus(
      `Found ${allItems.length} item${allItems.length === 1 ? "" : "s"}${
        many ? ` across ${usable.length} files` : ""
      }.`
    );

    // One line summarising anything that was quietly skipped along the way.
    const skips: string[] = [];
    if (slidesSkipped)
      skips.push(
        `${slidesSkipped} blank ${
          slidesSkipped === 1 ? "slide/row" : "slides/rows"
        }`
      );
    if (filesFailed)
      skips.push(
        `${filesFailed} file${filesFailed === 1 ? "" : "s"} couldn’t be read`
      );
    if (tooBig.length)
      skips.push(
        `${tooBig.length} file${tooBig.length === 1 ? "" : "s"} over the size limit`
      );
    if (unsupported)
      skips.push(
        `${unsupported} non-spreadsheet/PowerPoint file${
          unsupported === 1 ? "" : "s"
        }`
      );
    setNote(skips.length ? `Skipped ${skips.join(", ")}.` : null);
  }

  // Walk dropped items, descending into every folder and sub-folder, and gather
  // all the files. The DataTransferItemList is only valid until the first await,
  // so onDrop snapshots the entries synchronously before calling this.
  async function collectEntries(entries: FileSystemEntry[]): Promise<File[]> {
    const out: File[] = [];
    async function walk(entry: FileSystemEntry) {
      if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) =>
          (entry as FileSystemFileEntry).file(
            (f) => resolve(f),
            () => resolve(null)
          )
        );
        if (file) out.push(file);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        // readEntries returns at most a batch (~100) per call and must be called
        // repeatedly until it hands back an empty array.
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((resolve) =>
            reader.readEntries(
              (es) => resolve(es),
              () => resolve([])
            )
          );
          if (batch.length === 0) break;
          for (const e of batch) await walk(e);
        }
      }
    }
    for (const e of entries) await walk(e);
    return out;
  }

  // Entry point for the file picker and the folder picker: both hand us a
  // FileList that already contains the full (recursive) set of files.
  function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    void processFiles(arr);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy || submitting) return;

    // Prefer the entry API so dropped *folders* (and their sub-folders) are
    // walked. Snapshot the entries synchronously — the items list is emptied
    // once we await.
    const items = e.dataTransfer.items;
    if (items && items.length) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        setError(null);
        setNote(null);
        setStatus("Scanning dropped folder…");
        setBusy(true);
        collectEntries(entries)
          .then((files) => processFiles(files))
          .catch(() => {
            setBusy(false);
            setStatus(null);
            setError(
              "We couldn’t read that folder. Try picking it with the “Choose a folder” button instead."
            );
          });
        return;
      }
    }
    // Fallback: a plain file drop (older browsers, or files with no entry API).
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
              aria-label="Drop files or a folder here, or activate to browse"
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
                    ? "Reading your files…"
                    : "Drop files or a whole folder here"}
                </strong>
              </p>
              {!busy && (
                <p className="muted">or click to browse for files</p>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  // Reset so picking the SAME file again still fires onChange.
                  e.target.value = "";
                }}
              />
            </div>
            {!busy && (
              <p className="import-folder-row muted small">
                Got a folder of tear sheets?{" "}
                <button
                  className="link-btn"
                  onClick={() => folderInputRef.current?.click()}
                >
                  Choose a folder
                </button>{" "}
                — every PowerPoint inside it (and any sub-folders) is imported at
                once.
                <input
                  ref={attachFolderInput}
                  type="file"
                  hidden
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </p>
            )}
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
              <strong>PowerPoint (.pptx):</strong> every slide in every deck
              becomes an item — the product name, dimensions, price, lead time,
              room, and photo are pulled from each slide automatically, and the
              vendor is read from the slide’s comment if there is one. Drop or
              choose a folder to import many decks at once.
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
