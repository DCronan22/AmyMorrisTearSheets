import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./App.css";
import type { Firm, Item, LibraryItem, Project } from "./types";
import {
  emptyItem,
  emptyProject,
  defaultFirmStyle,
  itemToLibrary,
  libraryToItem,
  newId,
} from "./types";
import { useAuth } from "./auth/AuthProvider";
import { useConfirm } from "./components/ConfirmProvider";
import StyleEditor from "./branding/StyleEditor";
import { exportProjectFile, parseBackupFile } from "./storage";
import { exportItemsToSpreadsheet } from "./spreadsheet";
import {
  createProject as dbCreateProject,
  deleteProject as dbDeleteProject,
  fetchProjects,
  saveProject,
} from "./data/projects";
import {
  fetchLibrary,
  fetchLibraryKeys,
  createLibraryItem,
  createLibraryItems,
  saveLibraryItem,
  deleteLibraryItem,
} from "./data/library";
import { distinct, projectTotal, formatPrice, toggledSet } from "./util";
import CatalogFilterBar from "./components/CatalogFilterBar";
import { useCatalogFilter } from "./components/useCatalogFilter";
import RoomGroupedGallery from "./components/RoomGroupedGallery";
import LibraryView from "./components/LibraryView";
import LibraryPicker from "./components/LibraryPicker";
import Slideshow from "./components/Slideshow";
import TearSheetPrint from "./components/TearSheetPrint";
import ItemEditor from "./components/ItemEditor";
import ImportPanel from "./components/ImportPanel";

interface Props {
  firm: Firm;
  userEmail: string;
  isPlatformAdmin: boolean;
  onOpenAdmin: () => void;
  onSignOut: () => void;
}

// Stable stand-in while no project is active, so hooks keyed on the items
// array don't churn.
const EMPTY_ITEMS: Item[] = [];

/** The authenticated tear-sheet workspace for a single firm. */
export default function Workspace({
  firm,
  userEmail,
  isPlatformAdmin,
  onOpenAdmin,
  onSignOut,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  const [showIndex, setShowIndex] = useState<number | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  // Optional first-run prompt: shown once per firm that has no style yet, and
  // not again this session if skipped. Always editable later from the menu.
  const [showStyleOnboard, setShowStyleOnboard] = useState(
    () => !firm.style && !sessionStorage.getItem(`ts_style_prompt_${firm.id}`)
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // --- Master library ---
  const [viewMode, setViewMode] = useState<"clients" | "library">("clients");
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySelected, setLibrarySelected] = useState<Set<string>>(new Set());
  const [editingLibrary, setEditingLibrary] = useState<Item | null>(null);
  const [picking, setPicking] = useState(false);
  // Which destination an open ImportPanel feeds: the client or the library.
  const [importTarget, setImportTarget] = useState<"client" | "library">("client");
  const [flash, setFlash] = useState<string | null>(null);

  const { applyFirm } = useAuth();
  const confirm = useConfirm();
  // Whether product cards show the vendor line. Visual only — the vendor data is
  // untouched; persisted per firm so the choice sticks across reloads.
  const [showVendor, setShowVendor] = useState(
    () => localStorage.getItem(`ts_show_vendor_${firm.id}`) !== "0"
  );
  function toggleShowVendor() {
    setShowVendor((v) => {
      const next = !v;
      localStorage.setItem(`ts_show_vendor_${firm.id}`, next ? "1" : "0");
      return next;
    });
  }
  // The set of items to render in the print layout (selected subset or all).
  const [printItems, setPrintItems] = useState<Item[] | undefined>(undefined);
  const restoreInput = useRef<HTMLInputElement>(null);

  // Brand the browser tab for whichever firm is signed in; restore the generic
  // product name when leaving the workspace (sign-out / admin panel).
  useEffect(() => {
    document.title = `${firm.name} · Tear Sheets`;
    return () => {
      document.title = "Tear Sheets";
    };
  }, [firm.name]);

  // Initial load of this firm's projects from Supabase.
  useEffect(() => {
    let active = true;
    fetchProjects(firm.id)
      .then((ps) => {
        if (!active) return;
        setProjects(ps);
        setActiveProjectId(ps[0]?.id ?? null);
        setLoaded(true);
      })
      .catch((e) => {
        if (!active) return;
        setLoadError(e instanceof Error ? e.message : "Could not load projects.");
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [firm.id]);

  const project: Project | undefined = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  );

  // Search + dropdown filtering, shared with the database views.
  const { filter, setFilter, filtered } = useCatalogFilter(
    project?.items ?? EMPTY_ITEMS
  );
  // Existing room names — memoized so the memoized gallery cards (which take
  // this as a prop) don't re-render on every keystroke.
  const rooms = useMemo(
    () => (project ? distinct(project.items, "room") : []),
    [project]
  );

  // --- Selection ------------------------------------------------------------

  // Items that exist in the project AND are selected (ignores stale ids).
  const selectedItems = useMemo(
    () => (project ? project.items.filter((it) => selectedIds.has(it.id)) : []),
    [project, selectedIds]
  );
  const selectedCount = selectedItems.length;
  // How many of the currently visible (filtered) items are selected.
  const filteredSelectedCount = filtered.filter((it) =>
    selectedIds.has(it.id)
  ).length;
  const allFilteredSelected =
    filtered.length > 0 && filteredSelectedCount === filtered.length;

  const toggleSelect = useCallback(
    (id: string) => setSelectedIds((prev) => toggledSet(prev, id)),
    []
  );

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of filtered) next.add(it.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Set the print subset, print, then reset once printing finishes.
  function print(items?: Item[]) {
    // An explicit empty set (e.g. a stale database selection) would open a blank
    // print dialog; bail. `undefined` still means "print the whole project".
    if (items && items.length === 0) return;
    setPrintItems(items);
    const reset = () => {
      setPrintItems(undefined);
      window.onafterprint = null;
    };
    window.onafterprint = reset;
    // Defer so the print layout re-renders with the chosen subset first.
    setTimeout(() => {
      window.print();
      // Fallback in case onafterprint never fires (some browsers/dialogs).
      setTimeout(reset, 1000);
    }, 0);
  }

  // --- Persistence ----------------------------------------------------------

  // Save to the database. State was already updated optimistically by
  // applyProjectChange, and the save echoes nothing back, so there's no
  // write-back on success (which also means out-of-order replies are harmless).
  const persist = useCallback(async (p: Project) => {
    setSaveError(null);
    try {
      await saveProject(p);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Changes could not be saved."
      );
    }
  }, []);

  // Apply a change to the active project: update local state immediately, then
  // persist to the database.
  const applyProjectChange = useCallback(
    (mut: (p: Project) => Project) => {
      if (!project) return;
      const updated = mut(project);
      setProjects((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
      void persist(updated);
    },
    [project, persist]
  );

  function saveItem(item: Item) {
    const isNew = project ? !project.items.some((i) => i.id === item.id) : false;
    applyProjectChange((p) => {
      const exists = p.items.some((i) => i.id === item.id);
      return {
        ...p,
        items: exists
          ? p.items.map((i) => (i.id === item.id ? item : i))
          : [...p.items, item],
      };
    });
    setEditing(null);
    // Brand-new client items also seed the master library (deduped).
    if (isNew) void mirrorToLibrary([item]);
  }

  async function deleteItem(id: string) {
    const ok = await confirm({
      title: "Delete item?",
      message: "This removes the item from this project. It can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    applyProjectChange((p) => ({
      ...p,
      items: p.items.filter((i) => i.id !== id),
    }));
    setEditing(null);
  }

  // Bulk-delete the currently selected client items.
  async function deleteSelected() {
    const ids = new Set(selectedItems.map((it) => it.id));
    if (ids.size === 0) return;
    const ok = await confirm({
      title: `Delete ${ids.size} item${ids.size === 1 ? "" : "s"}?`,
      message: `This removes the ${ids.size} selected item${
        ids.size === 1 ? "" : "s"
      } from this project. It can't be undone.`,
      confirmLabel: `Delete ${ids.size}`,
      danger: true,
    });
    if (!ok) return;
    applyProjectChange((p) => ({
      ...p,
      items: p.items.filter((i) => !ids.has(i.id)),
    }));
    clearSelection();
  }

  // Save a copy of an existing item as a new item (fresh id, "(copy)" name).
  function duplicateItem(item: Item) {
    const copy: Item = {
      ...item,
      id: newId(),
      name: item.name ? `${item.name} (copy)` : item.name,
    };
    applyProjectChange((p) => ({ ...p, items: [...p.items, copy] }));
    setEditing(null);
  }

  function handleImport(items: Item[], mode: "append" | "replace") {
    applyProjectChange((p) => ({
      ...p,
      items: mode === "replace" ? items : [...p.items, ...items],
    }));
    // The ImportPanel closes itself once this resolves.
    // Imported client items also seed the master library (deduped).
    void mirrorToLibrary(items);
  }

  // --- Master library -------------------------------------------------------

  // Briefly show a confirmation toast (e.g. "Saved to library").
  function flashMsg(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash((m) => (m === msg ? null : m)), 2600);
  }

  // Load the firm's library the first time it's needed (library tab / picker).
  async function ensureLibrary() {
    if (libraryLoaded || libraryLoading) return;
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const items = await fetchLibrary(firm.id);
      setLibrary(items);
      setLibraryLoaded(true);
    } catch (e) {
      setLibraryError(
        e instanceof Error ? e.message : "Could not load the database."
      );
    } finally {
      setLibraryLoading(false);
    }
  }

  function openLibrary() {
    setViewMode("library");
    void ensureLibrary();
  }

  const toggleLibrarySelect = useCallback(
    (id: string) => setLibrarySelected((prev) => toggledSet(prev, id)),
    []
  );

  // Save a library draft (the ItemEditor works on an Item; convert back). New
  // entries are inserted (DB assigns the id); existing ones are updated.
  async function saveLibraryDraft(draft: Item) {
    setLibraryError(null);
    const exists = library.some((l) => l.id === draft.id);
    try {
      if (exists) {
        const saved = await saveLibraryItem({ id: draft.id, ...itemToLibrary(draft) });
        setLibrary((ls) => ls.map((l) => (l.id === saved.id ? saved : l)));
      } else {
        const saved = await createLibraryItem(firm.id, itemToLibrary(draft));
        setLibrary((ls) => [saved, ...ls]);
      }
      setEditingLibrary(null);
    } catch (e) {
      setLibraryError(
        e instanceof Error ? e.message : "Could not save the database item."
      );
    }
  }

  async function removeLibraryItem(id: string) {
    const ok = await confirm({
      title: "Remove from database?",
      message:
        "Remove this piece from your database? Client projects that already use it are unaffected.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setLibraryError(null);
    try {
      await deleteLibraryItem(id);
      setLibrary((ls) => ls.filter((l) => l.id !== id));
      setLibrarySelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setEditingLibrary(null);
    } catch (e) {
      setLibraryError(
        e instanceof Error ? e.message : "Could not delete the database item."
      );
    }
  }

  // Bulk-remove the selected database items.
  async function removeLibrarySelected() {
    const ids = [...librarySelected].filter((id) =>
      library.some((l) => l.id === id)
    );
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Remove ${ids.length} from database?`,
      message: `Remove the ${ids.length} selected piece${
        ids.length === 1 ? "" : "s"
      } from your database? Client projects that already use them are unaffected.`,
      confirmLabel: `Remove ${ids.length}`,
      danger: true,
    });
    if (!ok) return;
    setLibraryError(null);
    // Delete independently so one failure (RLS/network) doesn't strand the
    // others: drop only the rows that actually succeeded, keep the rest
    // selected, and tell the user if some couldn't be removed.
    const results = await Promise.allSettled(
      ids.map((id) => deleteLibraryItem(id))
    );
    const removed = new Set(
      ids.filter((_, i) => results[i].status === "fulfilled")
    );
    setLibrary((ls) => ls.filter((l) => !removed.has(l.id)));
    setLibrarySelected(
      (prev) => new Set([...prev].filter((id) => !removed.has(id)))
    );
    if (results.some((r) => r.status === "rejected")) {
      setLibraryError("Some items couldn't be deleted. Please try again.");
    }
  }

  // Spreadsheet/PowerPoint import targeted at the library (always additive).
  // Errors propagate so the open ImportPanel can show them and stay open.
  async function importToLibrary(items: Item[]) {
    setLibraryError(null);
    const saved = await createLibraryItems(firm.id, items.map(itemToLibrary));
    setLibrary((ls) => [...saved, ...ls]);
    flashMsg(`Added ${saved.length} to your database.`);
  }

  // Route an ImportPanel result to whichever destination opened it. Returns a
  // promise so the panel can show a busy state and surface failures inline.
  async function routeImport(items: Item[], mode: "append" | "replace") {
    if (importTarget === "library") await importToLibrary(items);
    else handleImport(items, mode);
  }

  // De-dup key for "is this product already in the library?" checks.
  function catalogKey(x: { name: string; vendor: string; sku: string }): string {
    return `${x.name}|${x.vendor}|${x.sku}`.trim().toLowerCase();
  }

  /**
   * Seed the master library with newly-created client items so the library
   * builds itself as you work. Skips blank-name items and anything whose
   * name+vendor+SKU already exists in the library — so the same piece used
   * across multiple clients (and pieces pulled FROM the library) aren't
   * duplicated. Non-fatal: a mirroring failure never blocks the client edit.
   */
  async function mirrorToLibrary(items: Item[]) {
    const named = items.filter((it) => it.name.trim());
    if (!named.length) return;
    try {
      // Dedup against the current library. When it isn't loaded yet, fetch just
      // the name/vendor/sku keys — not every row with its embedded images.
      const keys = libraryLoaded ? library : await fetchLibraryKeys(firm.id);
      const seen = new Set(keys.map(catalogKey));
      const toAdd: ReturnType<typeof itemToLibrary>[] = [];
      for (const it of named) {
        const k = catalogKey(it);
        if (seen.has(k)) continue;
        seen.add(k);
        toAdd.push(itemToLibrary(it));
      }
      if (!toAdd.length) return;
      const saved = await createLibraryItems(firm.id, toAdd);
      if (libraryLoaded) setLibrary((ls) => [...saved, ...ls]);
    } catch {
      // Mirroring is best-effort; the client item is already saved.
    }
  }

  // Promote a client item up to the master library (always a new entry).
  async function saveItemToLibrary(item: Item) {
    try {
      const saved = await createLibraryItem(firm.id, itemToLibrary(item));
      if (libraryLoaded) setLibrary((ls) => [saved, ...ls]);
      flashMsg(`“${item.name || "Item"}” saved to database.`);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Could not save to database."
      );
    }
  }

  // Drop chosen library entries into the active project as independent copies
  // (fresh ids, no room → they land under "Unassigned").
  function addLibraryItemsToProject(libItems: LibraryItem[]) {
    if (!libItems.length) return;
    const copies = libItems.map(libraryToItem);
    applyProjectChange((p) => ({ ...p, items: [...p.items, ...copies] }));
    setPicking(false);
    flashMsg(`Added ${copies.length} to ${project?.name ?? "the project"}.`);
  }

  // From the Library tab: copy the current selection into the open client.
  function addLibrarySelectionToClient() {
    const chosen = library.filter((l) => librarySelected.has(l.id));
    if (!chosen.length || !project) return;
    addLibraryItemsToProject(chosen);
    setLibrarySelected(new Set());
    setViewMode("clients");
  }

  function openPicker() {
    setPicking(true);
    void ensureLibrary();
  }

  // Quick room assignment from the grouped client view.
  const setItemRoom = useCallback(
    (item: Item, room: string) => {
      applyProjectChange((p) => ({
        ...p,
        items: p.items.map((i) => (i.id === item.id ? { ...i, room } : i)),
      }));
    },
    [applyProjectChange]
  );

  // Open the slideshow at the clicked item's position in the full project.
  const presentItem = useCallback(
    (item: Item) => {
      if (!project) return;
      const realIndex = project.items.findIndex((x) => x.id === item.id);
      setShowIndex(realIndex >= 0 ? realIndex : 0);
    },
    [project]
  );

  async function createProject() {
    setSaveError(null);
    try {
      const stored = await dbCreateProject(firm.id, emptyProject());
      setProjects((ps) => [stored, ...ps]);
      setActiveProjectId(stored.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not create project.");
    }
  }

  // Copy the whole active project (header + items) as a new project.
  async function duplicateProject() {
    if (!project) return;
    setSaveError(null);
    try {
      const stored = await dbCreateProject(firm.id, {
        ...project,
        name: `${project.name} (copy)`,
      });
      setProjects((ps) => [stored, ...ps]);
      setActiveProjectId(stored.id);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Could not duplicate the project."
      );
    }
  }

  // Restore projects from an exported backup (.json) file. Restored projects
  // are ADDED alongside current ones — nothing is overwritten or deleted.
  async function restoreBackup(file: File) {
    setSaveError(null);
    try {
      const restored = await parseBackupFile(file);
      if (restored.length === 0) {
        setSaveError("That backup file doesn't contain any projects.");
        return;
      }
      const itemCount = restored.reduce((n, p) => n + p.items.length, 0);
      const ok = await confirm({
        title: "Restore backup?",
        message:
          `Restore ${restored.length} project${restored.length === 1 ? "" : "s"} ` +
          `(${itemCount} item${itemCount === 1 ? "" : "s"}) from this backup? ` +
          "They'll be added alongside your current projects — nothing is overwritten.",
        confirmLabel: "Restore",
      });
      if (!ok) return;
      // Independent inserts — create them in parallel.
      const stored = await Promise.all(
        restored.map((p) => dbCreateProject(firm.id, p))
      );
      setProjects((ps) => [...stored, ...ps]);
      setActiveProjectId(stored[0].id);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Couldn't restore that backup file."
      );
    }
  }

  async function removeProject(id: string) {
    const ok = await confirm({
      title: "Delete project?",
      message: "Delete this project and all its items? This cannot be undone.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    setSaveError(null);
    try {
      await dbDeleteProject(id);
      setProjects((ps) => {
        const next = ps.filter((p) => p.id !== id);
        setActiveProjectId(next[0]?.id ?? null);
        return next;
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not delete project.");
    }
  }

  // --- Render ---------------------------------------------------------------

  if (!loaded) {
    return (
      <div className="loader" aria-label="Loading">
        <span className="spinner" />
      </div>
    );
  }

  const initials =
    firm.name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "TS";

  // The firm's style (or the default look) drives exports and a touch of the
  // on-screen accent so the workspace itself feels tailored to the company.
  const style = firm.style ?? defaultFirmStyle();
  const appVars = {
    "--accent": style.accentColor,
    "--accent-dark": style.accentColor,
  } as CSSProperties;

  function onStyleSaved(updated: Firm) {
    applyFirm(updated);
    setShowStyle(false);
    setShowStyleOnboard(false);
  }
  function skipStyleOnboard() {
    sessionStorage.setItem(`ts_style_prompt_${firm.id}`, "1");
    setShowStyleOnboard(false);
  }

  // Style editor / first-run prompt — rendered in both the empty and populated
  // states so a brand-new firm (no projects yet) still gets the setup prompt.
  const styleModals = (
    <>
      {showStyleOnboard && (
        <StyleEditor
          firm={firm}
          onboarding
          onClose={skipStyleOnboard}
          onSkip={skipStyleOnboard}
          onSaved={onStyleSaved}
        />
      )}
      {showStyle && (
        <StyleEditor
          firm={firm}
          onClose={() => setShowStyle(false)}
          onSaved={onStyleSaved}
        />
      )}
    </>
  );

  if (!project) {
    return (
      <div className="empty-app">
        {loadError && <p className="status-err">{loadError}</p>}
        {saveError && <p className="status-err">{saveError}</p>}
        <button className="btn primary" onClick={() => createProject()}>
          Create your first project
        </button>
        <p className="muted small" style={{ marginTop: 16 }}>
          Signed in as {userEmail} ·{" "}
          <button className="link-btn" onClick={() => setShowStyle(true)}>
            Tear sheet style
          </button>{" "}
          ·{" "}
          {isPlatformAdmin && (
            <>
              <button className="link-btn" onClick={onOpenAdmin}>
                Admin
              </button>{" "}
              ·{" "}
            </>
          )}
          <button className="link-btn" onClick={onSignOut}>
            Sign out
          </button>
        </p>
        {styleModals}
      </div>
    );
  }

  const total = projectTotal(project.items);

  return (
    <>
      <div className="app no-print" style={appVars}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">{initials}</span>
            <div>
              <div className="brand-name">{firm.name}</div>
              <div className="brand-sub">Tear Sheets</div>
            </div>
          </div>

          <div className="toolbar">
            <div className="view-toggle" role="tablist">
              <button
                className={viewMode === "clients" ? "active" : ""}
                onClick={() => setViewMode("clients")}
              >
                Clients
              </button>
              <button
                className={viewMode === "library" ? "active" : ""}
                onClick={openLibrary}
              >
                Database
              </button>
            </div>
            {viewMode === "clients" && (
              <>
                <span className="divider" />
                <select
                  className="project-select"
                  value={project.id}
                  onChange={(e) => setActiveProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button className="btn ghost" onClick={createProject}>
                  + Project
                </button>
                <span className="divider" />
                <button
                  className="btn"
                  onClick={openPicker}
                  title="Add pieces from your master database"
                >
                  ＋ From database
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setImportTarget("client");
                    setImporting(true);
                  }}
                >
                  ⬆ Import
                </button>
                <button className="btn" onClick={() => setEditing(emptyItem())}>
                  + Add item
                </button>
                <button
                  className="btn"
                  onClick={() => project.items.length && setShowIndex(0)}
                  disabled={!project.items.length}
                >
                  ▶ Present
                </button>
                <button
                  className="btn"
                  onClick={() => print()}
                  disabled={!project.items.length}
                >
                  🖶 Print / PDF
                </button>
                <button
                  className="btn"
                  onClick={() => print(selectedItems)}
                  disabled={selectedCount === 0}
                  title="Print only the selected items"
                >
                  🖶 Print selected ({selectedCount})
                </button>
              </>
            )}
            <span className="divider" />
            <div className="menu">
              <button className="btn ghost">⋯</button>
              <div className="menu-list">
                <button
                  onClick={() =>
                    exportItemsToSpreadsheet(project.items, project.name)
                  }
                >
                  Export items (.xlsx)
                </button>
                <button
                  disabled={selectedCount === 0}
                  onClick={() =>
                    exportItemsToSpreadsheet(selectedItems, project.name)
                  }
                >
                  Export selected ({selectedCount}) (.xlsx)
                </button>
                <button onClick={toggleShowVendor}>
                  {showVendor ? "✓ " : ""}Show vendor on cards
                </button>
                <button
                  onClick={() =>
                    exportProjectFile({
                      version: 1,
                      projects,
                      activeProjectId: project.id,
                    })
                  }
                >
                  Export backup (.json)
                </button>
                <button onClick={() => restoreInput.current?.click()}>
                  Restore backup (.json)…
                </button>
                <button onClick={duplicateProject}>Duplicate this project</button>
                <button onClick={() => setShowStyle(true)}>
                  Tear sheet style…
                </button>
                <button onClick={() => removeProject(project.id)}>
                  Delete this project
                </button>
                {isPlatformAdmin && (
                  <button onClick={onOpenAdmin}>Platform admin…</button>
                )}
                <button onClick={onSignOut}>Sign out ({userEmail})</button>
              </div>
            </div>
          </div>
        </header>

        {saveError && <p className="status-err save-banner">{saveError}</p>}
        {flash && <p className="status-ok save-banner">{flash}</p>}

        <input
          ref={restoreInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) restoreBackup(f);
            e.target.value = "";
          }}
        />

        {viewMode === "library" ? (
          <LibraryView
            library={library}
            loading={libraryLoading}
            error={libraryError}
            selected={librarySelected}
            onToggleSelect={toggleLibrarySelect}
            onAdd={() => setEditingLibrary(emptyItem())}
            onEdit={(li) => setEditingLibrary({ ...libraryToItem(li), id: li.id })}
            onDelete={removeLibraryItem}
            onImport={() => {
              setImportTarget("library");
              setImporting(true);
            }}
            onPrint={(items) => print(items.map(libraryToItem))}
            onDeleteSelected={removeLibrarySelected}
            onAddSelectedToClient={addLibrarySelectionToClient}
            activeClientName={project.name}
            showVendor={showVendor}
          />
        ) : (
        <>
        <section className="project-head">
          {editingHeader ? (
            <ProjectHeaderForm
              project={project}
              onSave={(p) => {
                applyProjectChange(() => p);
                setEditingHeader(false);
              }}
              onCancel={() => setEditingHeader(false)}
            />
          ) : (
            <div
              className="project-head-view"
              onClick={() => setEditingHeader(true)}
            >
              <div>
                <h1>{project.name}</h1>
                <p className="muted">
                  {[project.client, project.location, project.date]
                    .filter(Boolean)
                    .join(" · ") || "Click to add client details"}
                </p>
                {project.notes && (
                  <p className="project-notes">{project.notes}</p>
                )}
              </div>
              <div className="project-stats">
                <div className="stat">
                  <span className="stat-num">{project.items.length}</span>
                  <span className="stat-label">items</span>
                </div>
                <div className="stat">
                  <span className="stat-num">{formatPrice(total)}</span>
                  <span className="stat-label">total</span>
                </div>
              </div>
            </div>
          )}
        </section>

        <CatalogFilterBar
          items={project.items}
          filter={filter}
          onChange={setFilter}
          rooms={rooms}
        >
          <span className="muted small filter-count">
            {filtered.length} of {project.items.length}
          </span>
        </CatalogFilterBar>

        <section className="selectbar">
          <button
            className="btn ghost small"
            onClick={selectAllFiltered}
            disabled={filtered.length === 0 || allFilteredSelected}
          >
            Select all{filtered.length ? ` (${filtered.length})` : ""}
          </button>
          <button
            className="btn ghost small"
            onClick={clearSelection}
            disabled={selectedCount === 0}
          >
            Clear
          </button>
          <button
            className="btn ghost small danger"
            onClick={deleteSelected}
            disabled={selectedCount === 0}
            title="Delete the selected items from this project"
          >
            Delete selected ({selectedCount})
          </button>
          <span className="muted small select-count">
            {selectedCount} selected
          </span>
        </section>

        <main className="content">
          <RoomGroupedGallery
            items={filtered}
            rooms={rooms}
            selected={selectedIds}
            showVendor={showVendor}
            onToggleSelect={toggleSelect}
            onEdit={setEditing}
            onSetRoom={setItemRoom}
            onPresent={presentItem}
          />
        </main>
        </>
        )}

        <footer className="appfoot muted small">
          Saved to your account ·{" "}
          {style.footerText.trim() || `${firm.name} Tear Sheets`}
        </footer>
      </div>

      {/* Print layout lives outside .no-print and is shown only when printing */}
      <TearSheetPrint project={project} items={printItems} />

      {editing && (
        <ItemEditor
          item={editing}
          onSave={saveItem}
          onClose={() => setEditing(null)}
          onDelete={
            project.items.some((i) => i.id === editing.id) ? deleteItem : undefined
          }
          onDuplicate={
            project.items.some((i) => i.id === editing.id)
              ? duplicateItem
              : undefined
          }
          onSaveToLibrary={saveItemToLibrary}
        />
      )}
      {editingLibrary && (
        <ItemEditor
          item={editingLibrary}
          libraryMode
          onSave={saveLibraryDraft}
          onClose={() => setEditingLibrary(null)}
          onDelete={
            library.some((l) => l.id === editingLibrary.id)
              ? removeLibraryItem
              : undefined
          }
        />
      )}
      {picking && (
        <LibraryPicker
          library={library}
          loading={libraryLoading}
          error={libraryError}
          clientName={project.name}
          onConfirm={addLibraryItemsToProject}
          onClose={() => setPicking(false)}
        />
      )}
      {importing && (
        <ImportPanel
          onImport={routeImport}
          onClose={() => setImporting(false)}
          target={importTarget}
          destinationName={importTarget === "client" ? project.name : undefined}
        />
      )}
      {showIndex !== null && (
        <Slideshow
          project={project}
          startIndex={showIndex}
          showVendor={showVendor}
          onClose={() => setShowIndex(null)}
        />
      )}
      {styleModals}
    </>
  );
}

// Inline editor for the project header fields.
function ProjectHeaderForm({
  project,
  onSave,
  onCancel,
}: {
  project: Project;
  onSave: (p: Project) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(project);
  function set<K extends keyof Project>(k: K, v: Project[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }
  return (
    <div className="project-head-form">
      <div className="form-grid">
        <label className="full">
          <span>Project name</span>
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          <span>Client</span>
          <input value={draft.client} onChange={(e) => set("client", e.target.value)} />
        </label>
        <label>
          <span>Location</span>
          <input
            value={draft.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </label>
        <label>
          <span>Date</span>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </label>
        <label className="full">
          <span>Notes / palette</span>
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onSave(draft)}>
          Save details
        </button>
      </div>
    </div>
  );
}
