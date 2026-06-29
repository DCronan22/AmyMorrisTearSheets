import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./App.css";
import type { AppData, Firm, Item, LibraryItem, Project } from "./types";
import {
  emptyItem,
  emptyProject,
  defaultFirmStyle,
  itemToLibrary,
  libraryToItem,
  newId,
} from "./types";
import { useAuth } from "./auth/AuthProvider";
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
  createLibraryItem,
  createLibraryItems,
  saveLibraryItem,
  deleteLibraryItem,
} from "./data/library";
import { distinct, projectTotal, formatPrice } from "./util";
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
  const [roomFilter, setRoomFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("");
  const [search, setSearch] = useState("");
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
  // The set of items to render in the print layout (selected subset or all).
  const [printItems, setPrintItems] = useState<Item[] | undefined>(undefined);
  const restoreInput = useRef<HTMLInputElement>(null);
  // Monotonic save counter so a slow, stale save response can never overwrite
  // the state produced by a newer save (out-of-order network replies).
  const saveSeq = useRef(0);

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

  const filtered = useMemo(() => {
    if (!project) return [];
    const q = search.trim().toLowerCase();
    return project.items.filter((it) => {
      if (roomFilter && it.room !== roomFilter) return false;
      if (categoryFilter && it.category !== categoryFilter) return false;
      if (vendorFilter && it.vendor !== vendorFilter) return false;
      if (collectionFilter && it.collection !== collectionFilter) return false;
      if (q) {
        const hay =
          `${it.name} ${it.vendor} ${it.collection} ${it.sku} ${it.material} ${it.color}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [project, roomFilter, categoryFilter, vendorFilter, collectionFilter, search]);

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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  async function persist(p: Project) {
    setSaveError(null);
    const seq = ++saveSeq.current;
    try {
      const saved = await saveProject(p);
      // Adopt the stored row (server-normalized date, updated_at) into state —
      // but only if no newer save started while this one was in flight.
      if (seq !== saveSeq.current) return;
      setProjects((ps) => ps.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Changes could not be saved."
      );
    }
  }

  // Apply a change to the active project: update local state immediately, then
  // persist to the database.
  function applyProjectChange(mut: (p: Project) => Project) {
    if (!project) return;
    const updated = mut(project);
    setProjects((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
    void persist(updated);
  }

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

  function deleteItem(id: string) {
    applyProjectChange((p) => ({
      ...p,
      items: p.items.filter((i) => i.id !== id),
    }));
    setEditing(null);
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
    setImporting(false);
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

  function toggleLibrarySelect(id: string) {
    setLibrarySelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    if (!confirm("Remove this piece from your database? Client projects that already use it are unaffected."))
      return;
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

  // Spreadsheet/PowerPoint import targeted at the library (additive).
  async function importToLibrary(items: Item[]) {
    setImporting(false);
    setLibraryError(null);
    try {
      const saved = await createLibraryItems(firm.id, items.map(itemToLibrary));
      setLibrary((ls) => [...saved, ...ls]);
      flashMsg(`Added ${saved.length} to your database.`);
    } catch (e) {
      setLibraryError(
        e instanceof Error ? e.message : "Could not import into the database."
      );
    }
  }

  // Route an ImportPanel result to whichever destination opened it.
  function routeImport(items: Item[], mode: "append" | "replace") {
    if (importTarget === "library") void importToLibrary(items);
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
      // Dedup against the current library, loading it once if needed.
      let lib = library;
      if (!libraryLoaded) {
        lib = await fetchLibrary(firm.id);
        setLibrary(lib);
        setLibraryLoaded(true);
      }
      const seen = new Set(lib.map(catalogKey));
      const toAdd: ReturnType<typeof itemToLibrary>[] = [];
      for (const it of named) {
        const k = catalogKey(it);
        if (seen.has(k)) continue;
        seen.add(k);
        toAdd.push(itemToLibrary(it));
      }
      if (!toAdd.length) return;
      const saved = await createLibraryItems(firm.id, toAdd);
      setLibrary((ls) => [...saved, ...ls]);
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
  function setItemRoom(item: Item, room: string) {
    applyProjectChange((p) => ({
      ...p,
      items: p.items.map((i) => (i.id === item.id ? { ...i, room } : i)),
    }));
  }

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
      if (
        !confirm(
          `Restore ${restored.length} project${restored.length === 1 ? "" : "s"} ` +
            `(${itemCount} item${itemCount === 1 ? "" : "s"}) from this backup? ` +
            "They'll be added alongside your current projects — nothing is overwritten."
        )
      )
        return;
      const stored: Project[] = [];
      for (const p of restored) {
        stored.push(await dbCreateProject(firm.id, p));
      }
      setProjects((ps) => [...stored, ...ps]);
      setActiveProjectId(stored[0].id);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Couldn't restore that backup file."
      );
    }
  }

  async function removeProject(id: string) {
    if (!confirm("Delete this project and all its items? This cannot be undone."))
      return;
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

  const rooms = distinct(project.items, "room");
  const categories = distinct(project.items, "category");
  const vendors = distinct(project.items, "vendor");
  const collections = distinct(project.items, "collection");
  const total = projectTotal(project.items);
  const backupData: AppData = {
    version: 1,
    projects,
    activeProjectId: project.id,
  };

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
                <button onClick={() => exportProjectFile(backupData)}>
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
            onAddSelectedToClient={addLibrarySelectionToClient}
            activeClientName={project.name}
            selectedCount={librarySelected.size}
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

        <section className="filters">
          <input
            className="search"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
          >
            <option value="">All collections</option>
            {collections.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="">All rooms</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {(roomFilter ||
            categoryFilter ||
            vendorFilter ||
            collectionFilter ||
            search) && (
            <button
              className="btn ghost small"
              onClick={() => {
                setRoomFilter("");
                setCategoryFilter("");
                setVendorFilter("");
                setCollectionFilter("");
                setSearch("");
              }}
            >
              Clear
            </button>
          )}
          <span className="muted small filter-count">
            {filtered.length} of {project.items.length}
          </span>
        </section>

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
          <span className="muted small select-count">
            {selectedCount} selected
          </span>
        </section>

        <main className="content">
          <RoomGroupedGallery
            items={filtered}
            rooms={rooms}
            selected={selectedIds}
            onToggleSelect={toggleSelect}
            onEdit={setEditing}
            onSetRoom={setItemRoom}
            onPresent={(item) => {
              const realIndex = project.items.findIndex((x) => x.id === item.id);
              setShowIndex(realIndex >= 0 ? realIndex : 0);
            }}
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
        <ImportPanel onImport={routeImport} onClose={() => setImporting(false)} />
      )}
      {showIndex !== null && (
        <Slideshow
          project={project}
          startIndex={showIndex}
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
