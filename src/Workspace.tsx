import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./App.css";
import type { Firm, InventoryItem, Item, LibraryItem, Project } from "./types";
import {
  emptyItem,
  emptyProject,
  defaultFirmStyle,
  inventoryToClientItem,
  inventoryToDraft,
  inventoryToSpec,
  itemToLibrary,
  libraryToItem,
  newId,
} from "./types";
import { INVENTORY_ENABLED } from "./features";
import { useAuth } from "./auth/AuthProvider";
import { useConfirm } from "./components/ConfirmProvider";
import StyleEditor from "./branding/StyleEditor";
import { exportProjectFile, parseBackupFile } from "./storage";
import { exportItemsToSpreadsheet } from "./spreadsheet";
import { exportItemsToPptx } from "./pptxExport";
import {
  createProject as dbCreateProject,
  deleteProject as dbDeleteProject,
  fetchProject,
  fetchProjects,
  ProjectConflictError,
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
import {
  fetchInventory,
  createInventoryItem,
  createInventoryItems,
  saveInventoryItem,
  updateInventoryQuantity,
  deleteInventoryItem,
} from "./data/inventory";
import { offloadItemImages } from "./lib/imageStore";
import { distinct, distinctTags, projectTotal, formatPrice, toggledSet } from "./util";
import CatalogFilterBar from "./components/CatalogFilterBar";
import { useCatalogFilter } from "./components/useCatalogFilter";
import RoomGroupedGallery from "./components/RoomGroupedGallery";
import HomePage from "./components/HomePage";
import LibraryView from "./components/LibraryView";
import InventoryView from "./components/InventoryView";
import LibraryPicker from "./components/LibraryPicker";
import Slideshow from "./components/Slideshow";
import TearSheetPrint from "./components/TearSheetPrint";
import InventoryFormPrint from "./components/InventoryFormPrint";
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
  const [projects, setProjectsState] = useState<Project[]>([]);
  // A synchronously-updated mirror of `projects`. Saves run inside an async
  // queue and need the newest version token the instant they start, which
  // React state (applied on the next render) can't be relied on to give them.
  // Every write to the project list goes through `updateProjects` so the two
  // can never drift apart.
  const projectsRef = useRef<Project[]>([]);
  const updateProjects = useCallback(
    (updater: (ps: Project[]) => Project[]) => {
      projectsRef.current = updater(projectsRef.current);
      setProjectsState(projectsRef.current);
    },
    []
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  // What presentation mode is showing: a snapshot of the item set (whole
  // project, selection, or one room), a top-bar title, and where to start.
  const [showing, setShowing] = useState<{
    items: Item[];
    title: string;
    startIndex: number;
  } | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  // Optional first-run prompt: shown once per firm that has no style yet, and
  // not again this session if skipped. Always editable later from the menu.
  const [showStyleOnboard, setShowStyleOnboard] = useState(
    () => !firm.style && !sessionStorage.getItem(`ts_style_prompt_${firm.id}`)
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Which area of the app is on screen. Everyone lands on the home page.
  const [viewMode, setViewMode] = useState<
    "home" | "clients" | "library" | "inventory"
  >("home");

  // --- Master library ---
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySelected, setLibrarySelected] = useState<Set<string>>(new Set());
  const [editingLibrary, setEditingLibrary] = useState<Item | null>(null);
  const [picking, setPicking] = useState(false);
  // Which destination an open ImportPanel feeds: the client, the database, or
  // the inventory.
  const [importTarget, setImportTarget] = useState<
    "client" | "library" | "inventory"
  >("client");

  // --- Inventory (physical stock) ---
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventorySelected, setInventorySelected] = useState<Set<string>>(
    new Set()
  );
  const [editingInventory, setEditingInventory] = useState<Item | null>(null);
  // "Add from database" picker opened from the Inventory view.
  const [pickingForInventory, setPickingForInventory] = useState(false);
  // In flight while the selected entries are being copied into the database,
  // so the button can't be clicked twice into a duplicate insert.
  const [addingToDatabase, setAddingToDatabase] = useState(false);

  const [flash, setFlash] = useState<string | null>(null);
  // Guards against double-clicking the PowerPoint export while images fetch.
  const [exportingPptx, setExportingPptx] = useState(false);
  // The same guard for the Word inventory-form export.
  const [exportingDocx, setExportingDocx] = useState(false);

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
  // Inventory prints as the firm's inventory detail form, not as tear sheets,
  // so it has its own print set; whichever is non-null wins the print dialog.
  const [printForms, setPrintForms] = useState<InventoryItem[] | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  // The firm's style (or the default look) drives the print/PDF and PowerPoint
  // exports plus a touch of the on-screen accent. Memoized so a null style
  // doesn't mint a fresh object every render (TearSheetPrint is memo'd on it).
  const style = useMemo(() => firm.style ?? defaultFirmStyle(), [firm.style]);

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
        updateProjects(() => ps);
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
  }, [firm.id, updateProjects]);

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
  // Existing vendor / category values across everything the firm has entered —
  // project items, the database, and inventory — offered in the editor dropdowns
  // so new items reuse the same names instead of drifting into near-duplicates.
  const vendorOptions = useMemo(
    () =>
      distinctTags(
        [...(project?.items ?? []), ...library, ...inventory],
        "vendor"
      ),
    [project, library, inventory]
  );
  const categoryOptions = useMemo(
    () =>
      distinctTags(
        [...(project?.items ?? []), ...library, ...inventory],
        "category"
      ),
    [project, library, inventory]
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
    setPrintForms(null);
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

  /**
   * Print inventory as the firm's inventory detail form — the same page the
   * Word and PowerPoint inventory exports produce — rather than as tear sheets.
   */
  function printInventoryForms(items: InventoryItem[]) {
    if (items.length === 0) return;
    setPrintForms(items);
    setPrintItems(undefined);
    const reset = () => {
      setPrintForms(null);
      window.onafterprint = null;
    };
    window.onafterprint = reset;
    setTimeout(() => {
      window.print();
      setTimeout(reset, 1000);
    }, 0);
  }

  // Build and download the PowerPoint tear sheets (same layout as Print/PDF).
  // Image fetching can take a moment, so flash progress + the outcome.
  async function exportPowerPoint(items: Item[], name: string) {
    if (items.length === 0 || exportingPptx) return;
    setExportingPptx(true);
    setSaveError(null);
    flashMsg("Preparing PowerPoint…");
    try {
      const { missingImages } = await exportItemsToPptx(items, name, {
        style,
        firmName: firm.name,
      });
      flashMsg(
        missingImages > 0
          ? `PowerPoint exported — ${missingImages} image${
              missingImages === 1 ? "" : "s"
            } couldn't be embedded (vendor site blocked the download).`
          : "PowerPoint exported."
      );
    } catch (e) {
      setFlash(null);
      setSaveError(
        e instanceof Error ? e.message : "Could not export the PowerPoint file."
      );
    } finally {
      setExportingPptx(false);
    }
  }

  // --- Persistence ----------------------------------------------------------

  // Briefly show a confirmation toast (e.g. "Saved to library").
  const flashMsg = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((m) => (m === msg ? null : m)), 2600);
  }, []);

  // Save the project to the database. State was already updated optimistically
  // by applyProjectChange.
  //
  // A project's items are stored as a single jsonb blob, so when two people
  // have the same project open, a plain write would erase whatever the other
  // one saved in the meantime. saveProject instead refuses a save whose
  // version token is stale and raises ProjectConflictError; we recover by
  // re-reading the teammate's current version and replaying this change on top
  // of it, so both survive. Retries are bounded — a project that keeps being
  // written by others should ask for a reload rather than spin.
  //
  // Items still carrying base64 data-URL photos (fresh picks, imports, legacy
  // rows) get those uploaded to Storage first, and the small public URLs are
  // adopted back into state so the next save doesn't re-upload them.
  const persist = useCallback(
    async (projectId: string, mut: (p: Project) => Project) => {
      setSaveError(null);
      let merged = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        let target: Project | undefined;
        if (attempt === 0) {
          // The change is already in local state; save exactly that.
          target = projectsRef.current.find((p) => p.id === projectId);
          // Deleted locally while this was queued — nothing left to save.
          if (!target) return;
        } else {
          // Someone else got there first. Take their version and replay our
          // own change on top of it, then show it to the user right away.
          const fresh = await fetchProject(projectId).catch(() => undefined);
          if (fresh === undefined) {
            setSaveError("Changes could not be saved. Check your connection.");
            return;
          }
          if (fresh === null) {
            setSaveError(
              "This project is no longer available (it may have been deleted)."
            );
            return;
          }
          target = mut(fresh);
          const replayed = target;
          updateProjects((ps) =>
            ps.map((p) => (p.id === projectId ? replayed : p))
          );
          merged = true;
        }

        try {
          const { items, changed } = await offloadItemImages(
            target.items,
            firm.id
          );
          if (changed) {
            const swapped = new Map(
              target.items.map((orig, i) => [orig.id, { orig, next: items[i] }])
            );
            updateProjects((ps) =>
              ps.map((proj) =>
                proj.id !== projectId
                  ? proj
                  : {
                      ...proj,
                      // Only swap an image the user hasn't changed again since
                      // this save started.
                      items: proj.items.map((it) => {
                        const u = swapped.get(it.id);
                        return u &&
                          u.next.imageUrl !== u.orig.imageUrl &&
                          it.imageUrl === u.orig.imageUrl
                          ? { ...it, imageUrl: u.next.imageUrl }
                          : it;
                      }),
                    }
              )
            );
          }
          const updatedAt = await saveProject(
            changed ? { ...target, items } : target
          );
          // Hold on to the new version token so the next save is checked
          // against the row we just wrote.
          updateProjects((ps) =>
            ps.map((p) => (p.id === projectId ? { ...p, updatedAt } : p))
          );
          if (merged) {
            flashMsg(
              "Someone else on your team was editing this project too — both sets of changes were kept."
            );
          }
          return;
        } catch (e) {
          if (e instanceof ProjectConflictError) continue;
          setSaveError(
            e instanceof Error ? e.message : "Changes could not be saved."
          );
          return;
        }
      }
      setSaveError(
        "Couldn't save — this project is being changed by several people at once. Please reload the page and try again."
      );
    },
    [firm.id, updateProjects, flashMsg]
  );

  // Saves are queued so that a retry (which re-reads and replays) can never
  // interleave with the next edit's save.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueSave = useCallback(
    (projectId: string, mut: (p: Project) => Project) => {
      saveQueue.current = saveQueue.current
        // persist handles its own errors; this guard exists so that even an
        // unexpected throw can't reject the chain and silently stop every
        // later save.
        .then(() => persist(projectId, mut).catch(() => {}));
    },
    [persist]
  );

  // Projects are loaded once when the workspace opens, so a tab left open all
  // day would otherwise show a snapshot that is hours stale — and with a whole
  // team on the same projects, stale is exactly when people tread on each
  // other. Re-read the firm's projects whenever the tab comes back to the
  // foreground.
  //
  // The re-read joins the same queue as saves, so it can never overlap one:
  // it always sees the server state *after* any pending save has landed, and
  // an edit made while it runs queues up behind it.
  const lastRefresh = useRef(0);
  const refreshProjects = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    // Focus fires on every alt-tab and a refresh re-reads every project the
    // firm has, so rate-limit it. Someone flicking between windows doesn't
    // need a fresh read each time; someone coming back to a tab they left
    // this morning does.
    const now = Date.now();
    if (now - lastRefresh.current < 30_000) return;
    lastRefresh.current = now;
    saveQueue.current = saveQueue.current.then(async () => {
      // A background refresh failing isn't worth interrupting the user; the
      // next save surfaces any real connection problem.
      const ps = await fetchProjects(firm.id).catch(() => null);
      if (!ps) return;
      updateProjects(() => ps);
      // Someone else may have deleted whatever project was open.
      setActiveProjectId((cur) =>
        cur && ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? null
      );
    });
  }, [firm.id, updateProjects]);

  useEffect(() => {
    document.addEventListener("visibilitychange", refreshProjects);
    window.addEventListener("focus", refreshProjects);
    return () => {
      document.removeEventListener("visibilitychange", refreshProjects);
      window.removeEventListener("focus", refreshProjects);
    };
  }, [refreshProjects]);

  // Apply a change to the active project: update local state immediately, then
  // persist to the database. `mut` must be replayable — it may be applied a
  // second time on top of a teammate's newer version of the project.
  const applyProjectChange = useCallback(
    (mut: (p: Project) => Project) => {
      if (!project) return;
      const updated = mut(project);
      updateProjects((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
      enqueueSave(updated.id, mut);
    },
    [project, updateProjects, enqueueSave]
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
        const saved = await saveLibraryItem(
          { id: draft.id, ...itemToLibrary(draft) },
          firm.id
        );
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
    else if (importTarget === "inventory") await importToInventory(items);
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
  /**
   * Copy the selected inventory entries into the open client project and jump
   * there. The inventory is left exactly as it was — the on-hand count is not
   * stepped down, because specifying a piece for a client isn't the same event
   * as it leaving the warehouse.
   */
  function addInventorySelectionToClient() {
    const chosen = inventory.filter((inv) => inventorySelected.has(inv.id));
    if (!chosen.length || !project) return;
    const added = chosen.map(inventoryToClientItem);
    applyProjectChange((p) => ({ ...p, items: [...p.items, ...added] }));
    setInventorySelected(new Set());
    setViewMode("clients");
    flashMsg(
      `Added ${added.length} item${added.length === 1 ? "" : "s"} to ${project.name}.`
    );
  }

  /**
   * Copy the selected inventory entries into the firm's database as reusable
   * master entries, leaving the inventory itself untouched.
   *
   * The pieces are converted with inventoryToSpec — product spec only, retail
   * price as `price`, no stock details — so a copy is indistinguishable from
   * any other database entry and prints/exports through the ordinary tear-sheet
   * path rather than the inventory detail form. Anything whose name+vendor+SKU
   * is already in the database is skipped rather than duplicated, the same rule
   * client items mirror by.
   */
  async function addInventorySelectionToDatabase() {
    const chosen = inventory.filter((inv) => inventorySelected.has(inv.id));
    // The dedup set is built per call, so a second click while the first insert
    // is still in flight would add the same pieces twice — the button is
    // disabled meanwhile, and this guards the handler itself.
    if (!chosen.length || addingToDatabase) return;
    const named = chosen.filter((inv) => inv.name.trim());
    const unnamed = chosen.length - named.length;
    setAddingToDatabase(true);
    setInventoryError(null);
    try {
      // Dedup against the database. When it isn't loaded yet, fetch just the
      // name/vendor/sku keys — not every row with its embedded images.
      const keys = libraryLoaded ? library : await fetchLibraryKeys(firm.id);
      const seen = new Set(keys.map(catalogKey));
      const toAdd: Omit<LibraryItem, "id">[] = [];
      let duplicates = 0;
      for (const inv of named) {
        const k = catalogKey(inv);
        if (seen.has(k)) {
          duplicates++;
          continue;
        }
        seen.add(k);
        toAdd.push(inventoryToSpec(inv));
      }
      if (toAdd.length) {
        const saved = await createLibraryItems(firm.id, toAdd);
        if (libraryLoaded) setLibrary((ls) => [...saved, ...ls]);
      }
      setInventorySelected(new Set());
      if (!toAdd.length && duplicates && !unnamed) {
        flashMsg(
          duplicates === 1
            ? "That piece is already in your database."
            : `All ${duplicates} selected pieces are already in your database.`
        );
      } else {
        const parts = [`${toAdd.length} added to your database`];
        if (duplicates) parts.push(`${duplicates} already there`);
        if (unnamed) parts.push(`${unnamed} skipped (no name)`);
        flashMsg(`${parts.join("; ")}.`);
      }
    } catch (e) {
      setInventoryError(
        e instanceof Error ? e.message : "Could not add to the database."
      );
    } finally {
      setAddingToDatabase(false);
    }
  }

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

  // --- Inventory (physical stock) --------------------------------------------

  // Fetch the firm's inventory and put it in state. Callers that need the
  // fresh list synchronously (dedup checks) use the returned array.
  async function loadInventory(): Promise<InventoryItem[]> {
    const items = await fetchInventory(firm.id);
    setInventory(items);
    setInventoryLoaded(true);
    return items;
  }

  // Load the inventory the first time it's needed (inventory tab / add-to).
  async function ensureInventory() {
    if (inventoryLoaded || inventoryLoading) return;
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      await loadInventory();
    } catch (e) {
      setInventoryError(
        e instanceof Error ? e.message : "Could not load the inventory."
      );
    } finally {
      setInventoryLoading(false);
    }
  }

  function openInventory() {
    if (!INVENTORY_ENABLED) return;
    setViewMode("inventory");
    void ensureInventory();
  }

  const toggleInventorySelect = useCallback(
    (id: string) => setInventorySelected((prev) => toggledSet(prev, id)),
    []
  );

  // Save an inventory draft (the ItemEditor works on an Item; convert back).
  // The editor carries the on-hand quantity too — it's the same number the card
  // stepper edits — so the draft's count is what gets written. Zero is allowed
  // ("stocked, none on hand"); removing an entry is always an explicit delete.
  async function saveInventoryDraft(draft: Item) {
    setInventoryError(null);
    const existing = inventory.find((i) => i.id === draft.id);
    const quantity = Math.max(0, Math.floor(draft.quantity || 0));
    try {
      if (existing) {
        const saved = await saveInventoryItem(
          {
            id: draft.id,
            ...itemToLibrary(draft),
            quantity,
          },
          firm.id
        );
        setInventory((is) => is.map((i) => (i.id === saved.id ? saved : i)));
      } else {
        const saved = await createInventoryItem(
          firm.id,
          itemToLibrary(draft),
          quantity
        );
        setInventory((is) => [saved, ...is]);
      }
      setEditingInventory(null);
    } catch (e) {
      setInventoryError(
        e instanceof Error ? e.message : "Could not save the inventory entry."
      );
    }
  }

  // Set an entry's on-hand count from the card stepper. Optimistic — the
  // stepper should feel instant — and rolled back if the save fails. Zero is
  // allowed ("out of stock"); removing an entry is always an explicit delete.
  async function setInventoryQuantity(inv: InventoryItem, quantity: number) {
    const qty = Math.max(0, quantity);
    if (qty === inv.quantity) return;
    setInventoryError(null);
    setInventory((is) =>
      is.map((i) => (i.id === inv.id ? { ...i, quantity: qty } : i))
    );
    try {
      await updateInventoryQuantity(inv.id, qty);
    } catch (e) {
      setInventory((is) =>
        is.map((i) => (i.id === inv.id ? { ...i, quantity: inv.quantity } : i))
      );
      setInventoryError(
        e instanceof Error ? e.message : "Could not update the quantity."
      );
    }
  }

  async function removeInventoryItem(id: string) {
    const ok = await confirm({
      title: "Remove from inventory?",
      message:
        "Remove this entry from your inventory? Your database and client projects are unaffected.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setInventoryError(null);
    try {
      await deleteInventoryItem(id);
      setInventory((is) => is.filter((i) => i.id !== id));
      setInventorySelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setEditingInventory(null);
    } catch (e) {
      setInventoryError(
        e instanceof Error ? e.message : "Could not remove the inventory entry."
      );
    }
  }

  // Bulk-remove the selected inventory entries. Mirrors removeLibrarySelected:
  // deletes run independently so one failure doesn't strand the others.
  async function removeInventorySelected() {
    const ids = [...inventorySelected].filter((id) =>
      inventory.some((i) => i.id === id)
    );
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Remove ${ids.length} from inventory?`,
      message: `Remove the ${ids.length} selected entr${
        ids.length === 1 ? "y" : "ies"
      } from your inventory? Your database and client projects are unaffected.`,
      confirmLabel: `Remove ${ids.length}`,
      danger: true,
    });
    if (!ok) return;
    setInventoryError(null);
    const results = await Promise.allSettled(
      ids.map((id) => deleteInventoryItem(id))
    );
    const removed = new Set(
      ids.filter((_, i) => results[i].status === "fulfilled")
    );
    setInventory((is) => is.filter((i) => !removed.has(i.id)));
    setInventorySelected(
      (prev) => new Set([...prev].filter((id) => !removed.has(id)))
    );
    if (results.some((r) => r.status === "rejected")) {
      setInventoryError("Some entries couldn't be removed. Please try again.");
    }
  }

  /**
   * Copy database pieces into the inventory. A piece that's already stocked
   * (matched by name+vendor+SKU) has its quantity increased by one instead of
   * being duplicated; anything new is added with quantity 1.
   */
  async function addLibraryItemsToInventory(libItems: LibraryItem[]) {
    if (!INVENTORY_ENABLED || !libItems.length) return;
    setPickingForInventory(false);
    setSaveError(null);
    try {
      // Dedup against the live inventory; load it first if needed.
      const current = inventoryLoaded ? inventory : await loadInventory();
      const byKey = new Map(current.map((inv) => [catalogKey(inv), inv]));
      let next = current;
      let added = 0;
      let increased = 0;
      for (const li of libItems) {
        const { id: _omit, ...spec } = li;
        void _omit;
        const existing = byKey.get(catalogKey(li));
        if (existing) {
          const saved = await updateInventoryQuantity(
            existing.id,
            existing.quantity + 1
          );
          byKey.set(catalogKey(saved), saved);
          next = next.map((i) => (i.id === saved.id ? saved : i));
          increased++;
        } else {
          const saved = await createInventoryItem(firm.id, spec, 1);
          byKey.set(catalogKey(saved), saved);
          next = [saved, ...next];
          added++;
        }
      }
      setInventory(next);
      const parts: string[] = [];
      if (added) parts.push(`${added} added`);
      if (increased) parts.push(`${increased} already stocked — quantity increased`);
      flashMsg(`Inventory updated: ${parts.join("; ")}.`);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Could not add to the inventory."
      );
    }
  }

  // From the Database tab: copy the current selection into the inventory.
  function addLibrarySelectionToInventory() {
    const chosen = library.filter((l) => librarySelected.has(l.id));
    if (!chosen.length) return;
    void addLibraryItemsToInventory(chosen);
    setLibrarySelected(new Set());
  }

  /**
   * Word / spreadsheet / PowerPoint / PDF import targeted at the inventory
   * (always additive). Each imported entry keeps the quantity its form was
   * filled in with — including 0, which is a real on-hand count. Errors
   * propagate so the open ImportPanel can show them and stay open.
   */
  async function importToInventory(items: Item[]) {
    if (!INVENTORY_ENABLED) return;
    setInventoryError(null);
    const saved = await createInventoryItems(
      firm.id,
      items.map((it) => ({
        spec: itemToLibrary(it),
        quantity: Math.max(0, Math.floor(it.quantity || 0)),
      }))
    );
    if (inventoryLoaded) {
      setInventory((is) => [...saved, ...is]);
    } else {
      // The list on screen isn't the whole inventory yet (the initial load
      // failed, say), so adopting just these rows would hide the rest. Fetch
      // the real list, which now includes them.
      await loadInventory();
    }
    flashMsg(`Added ${saved.length} to your inventory.`);
  }

  /**
   * Download the firm's inventory as Word "INVENTORY DETAIL FORM" pages — the
   * same paperwork the firm already files, one form per entry on their
   * letterhead. Lazily imported so its embedded Word XML stays out of the
   * initial bundle.
   */
  /** Inventory as PowerPoint — the same detail form the Word export makes. */
  async function exportInventoryPptx(items: InventoryItem[]) {
    if (items.length === 0 || exportingPptx) return;
    setExportingPptx(true);
    setSaveError(null);
    flashMsg("Preparing PowerPoint forms…");
    try {
      const { exportInventoryFormsToPptx } = await import("./inventoryFormPptx");
      const { missingImages } = await exportInventoryFormsToPptx(
        items,
        `${firm.name} Inventory`,
        { style, firmName: firm.name }
      );
      flashMsg(
        missingImages > 0
          ? `PowerPoint exported — ${missingImages} photo${
              missingImages === 1 ? "" : "s"
            } couldn't be embedded (vendor site blocked the download).`
          : "PowerPoint exported."
      );
    } catch (e) {
      setFlash(null);
      setSaveError(
        e instanceof Error ? e.message : "Could not export the PowerPoint forms."
      );
    } finally {
      setExportingPptx(false);
    }
  }

  async function exportInventoryDocx(items: InventoryItem[]) {
    if (items.length === 0 || exportingDocx) return;
    setExportingDocx(true);
    setSaveError(null);
    flashMsg("Preparing Word forms…");
    try {
      const { exportInventoryToDocx } = await import("./docxExport");
      const { missingImages } = await exportInventoryToDocx(
        items,
        `${firm.name} Inventory`,
        { style, firmName: firm.name }
      );
      flashMsg(
        missingImages > 0
          ? `Word forms exported — ${missingImages} photo${
              missingImages === 1 ? "" : "s"
            } couldn't be embedded (vendor site blocked the download).`
          : "Word forms exported."
      );
    } catch (e) {
      setFlash(null);
      setSaveError(
        e instanceof Error ? e.message : "Could not export the Word forms."
      );
    } finally {
      setExportingDocx(false);
    }
  }

  // From the Inventory tab: open the database picker.
  function openInventoryPicker() {
    if (!INVENTORY_ENABLED) return;
    setPickingForInventory(true);
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

  // --- Presenting -----------------------------------------------------------

  // Rooms in on-screen order (first seen in the item list), matching the
  // grouped gallery — `rooms` above is alphabetical for the filter dropdown.
  const presentRooms = useMemo(() => {
    const seen: string[] = [];
    for (const it of project?.items ?? EMPTY_ITEMS) {
      const room = it.room.trim();
      if (room && !seen.includes(room)) seen.push(room);
    }
    return seen;
  }, [project]);

  // Present the whole project, starting at the given item (a clicked card).
  const presentItem = useCallback(
    (item: Item) => {
      if (!project) return;
      const realIndex = project.items.findIndex((x) => x.id === item.id);
      setShowing({
        items: project.items,
        title: [project.name, project.client].filter(Boolean).join(" · "),
        startIndex: realIndex >= 0 ? realIndex : 0,
      });
    },
    [project]
  );

  function presentAll() {
    if (!project || project.items.length === 0) return;
    setShowing({
      items: project.items,
      title: [project.name, project.client].filter(Boolean).join(" · "),
      startIndex: 0,
    });
  }

  function presentSelected() {
    if (selectedItems.length === 0) return;
    setShowing({ items: selectedItems, title: "Selection", startIndex: 0 });
  }

  function presentRoom(room: string) {
    if (!project) return;
    const items = project.items.filter((it) => it.room.trim() === room);
    if (items.length === 0) return;
    setShowing({ items, title: room, startIndex: 0 });
  }

  async function createProject() {
    setSaveError(null);
    try {
      const stored = await dbCreateProject(firm.id, emptyProject());
      updateProjects((ps) => [stored, ...ps]);
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
      updateProjects((ps) => [stored, ...ps]);
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
      updateProjects((ps) => [...stored, ...ps]);
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
      updateProjects((ps) => {
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
          {/* Row 1: brand · navigation · overflow menu. */}
          <div className="topbar-row">
            <div className="brand">
              <span className="brand-mark">{initials}</span>
              <div>
                <div className="brand-name">{firm.name}</div>
                <div className="brand-sub">Tear Sheets</div>
              </div>
            </div>

            <div className="topbar-right">
              <nav className="view-toggle" aria-label="Areas">
              <button
                className={viewMode === "home" ? "active" : ""}
                aria-current={viewMode === "home" ? "page" : undefined}
                onClick={() => setViewMode("home")}
              >
                Home
              </button>
              <button
                className={viewMode === "clients" ? "active" : ""}
                aria-current={viewMode === "clients" ? "page" : undefined}
                onClick={() => setViewMode("clients")}
              >
                Clients
              </button>
              <button
                className={viewMode === "library" ? "active" : ""}
                aria-current={viewMode === "library" ? "page" : undefined}
                onClick={openLibrary}
              >
                Database
              </button>
              {INVENTORY_ENABLED && (
                <button
                  className={viewMode === "inventory" ? "active" : ""}
                  aria-current={viewMode === "inventory" ? "page" : undefined}
                  onClick={openInventory}
                >
                  Inventory
                </button>
              )}
              </nav>
              <span className="divider" />
              {/* Secondary / rare actions */}
              <div className="menu">
                <button
                  className="btn ghost"
                  aria-label="More options"
                  title="More options"
                >
                  ⋯
                </button>
                <div className="menu-list">
                  <button onClick={toggleShowVendor}>
                    {showVendor ? "✓ " : ""}Show vendor on cards
                  </button>
                  <button onClick={() => setShowStyle(true)}>
                    Tear sheet style…
                  </button>
                  <hr className="menu-sep" />
                  <button onClick={duplicateProject}>
                    Duplicate this project
                  </button>
                  <button
                    className="danger"
                    onClick={() => removeProject(project.id)}
                  >
                    Delete this project
                  </button>
                  <hr className="menu-sep" />
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
                  <hr className="menu-sep" />
                  {isPlatformAdmin && (
                    <button onClick={onOpenAdmin}>Platform admin…</button>
                  )}
                  <button onClick={onSignOut}>Sign out ({userEmail})</button>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2 (Clients only): project switcher · content actions ·
              output actions (Present / Print / Export). */}
          {viewMode === "clients" && (
            <div className="toolbar">
                <div className="toolbar-group">
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
                  <button
                    className="btn ghost"
                    onClick={createProject}
                    title="Create a new client project"
                  >
                    ＋ New project
                  </button>
                </div>
                <span className="divider" />
                {/* Content actions — one primary per toolbar */}
                <div className="toolbar-group">
                  <button
                    className="btn primary"
                    onClick={() => setEditing(emptyItem())}
                  >
                    ＋ Add item
                  </button>
                  <button
                    className="btn"
                    onClick={openPicker}
                    title="Add pieces from your master database"
                  >
                    From database
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setImportTarget("client");
                      setImporting(true);
                    }}
                    title="Import items from a spreadsheet, PowerPoint, or PDF file"
                  >
                    Import
                  </button>
                </div>
                <span className="spacer" />
                {/* Output actions: Present, Print, Export */}
                <div className="toolbar-group">
                  <div className="menu">
                    <button className="btn" disabled={!project.items.length}>
                      Present ▾
                    </button>
                    <div className="menu-list">
                      <button
                        disabled={!project.items.length}
                        onClick={presentAll}
                      >
                        Present all
                      </button>
                      {selectedCount > 0 && (
                        <button onClick={presentSelected}>
                          Present selected ({selectedCount})
                        </button>
                      )}
                      {presentRooms.length > 0 && <hr className="menu-sep" />}
                      {presentRooms.map((room) => (
                        <button key={room} onClick={() => presentRoom(room)}>
                          Present room: {room}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    className="btn"
                    onClick={() => print()}
                    disabled={!project.items.length}
                    title="Print all tear sheets, or save them as a PDF"
                  >
                    Print
                  </button>
                  <div className="menu">
                    <button className="btn" disabled={!project.items.length}>
                      Export ▾
                    </button>
                    <div className="menu-list">
                      <button
                        disabled={project.items.length === 0}
                        onClick={() =>
                          exportItemsToSpreadsheet(project.items, project.name)
                        }
                      >
                        Excel spreadsheet (.xlsx)
                      </button>
                      <button
                        disabled={selectedCount === 0}
                        onClick={() =>
                          exportItemsToSpreadsheet(selectedItems, project.name)
                        }
                      >
                        Excel — selected items
                        {selectedCount > 0 ? ` (${selectedCount})` : ""}
                      </button>
                      <hr className="menu-sep" />
                      <button
                        disabled={project.items.length === 0 || exportingPptx}
                        onClick={() =>
                          exportPowerPoint(project.items, project.name)
                        }
                      >
                        PowerPoint (.pptx)
                      </button>
                      <button
                        disabled={selectedCount === 0 || exportingPptx}
                        onClick={() =>
                          exportPowerPoint(selectedItems, project.name)
                        }
                      >
                        PowerPoint — selected items
                        {selectedCount > 0 ? ` (${selectedCount})` : ""}
                      </button>
                    </div>
                  </div>
                </div>
            </div>
          )}
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

        {viewMode === "home" ? (
          <HomePage
            firmName={firm.name}
            projectCount={projects.length}
            databaseCount={libraryLoaded ? library.length : null}
            inventoryCount={inventoryLoaded ? inventory.length : null}
            onOpenClients={() => setViewMode("clients")}
            onOpenDatabase={openLibrary}
            onOpenInventory={openInventory}
          />
        ) : viewMode === "library" ? (
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
            onClearSelection={() => setLibrarySelected(new Set())}
            onAddSelectedToClient={addLibrarySelectionToClient}
            onAddSelectedToInventory={addLibrarySelectionToInventory}
            activeClientName={project.name}
            showVendor={showVendor}
          />
        ) : viewMode === "inventory" && INVENTORY_ENABLED ? (
          <InventoryView
            inventory={inventory}
            loading={inventoryLoading}
            error={inventoryError}
            selected={inventorySelected}
            onToggleSelect={toggleInventorySelect}
            onAdd={() => setEditingInventory(emptyItem())}
            onEdit={(inv) =>
              setEditingInventory(inventoryToDraft(inv))
            }
            onDelete={removeInventoryItem}
            onSetQuantity={(inv, qty) => void setInventoryQuantity(inv, qty)}
            onAddFromDatabase={openInventoryPicker}
            onImport={() => {
              setImportTarget("inventory");
              setImporting(true);
            }}
            onExportDocx={(items) => void exportInventoryDocx(items)}
            onExportPptx={(items) => void exportInventoryPptx(items)}
            exporting={exportingDocx || exportingPptx}
            onPrint={printInventoryForms}
            onDeleteSelected={removeInventorySelected}
            onClearSelection={() => setInventorySelected(new Set())}
            onAddSelectedToClient={addInventorySelectionToClient}
            onAddSelectedToDatabase={() => void addInventorySelectionToDatabase()}
            addingToDatabase={addingToDatabase}
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
                // Take only the fields this form edits, never the whole draft:
                // the draft carries the item list as it was when the form was
                // opened, and if this save has to be replayed on top of a
                // teammate's newer version that stale list would erase their
                // work.
                applyProjectChange((prev) => ({
                  ...prev,
                  name: p.name,
                  client: p.client,
                  location: p.location,
                  date: p.date,
                  notes: p.notes,
                }));
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

        {/* Selection strip: a quiet "Select all" when nothing is selected;
            count + batch actions + Clear selection once items are chosen. */}
        <section
          className={`selectbar${selectedCount > 0 ? " has-selection" : ""}`}
        >
          {selectedCount === 0 ? (
            <button
              className="btn ghost small"
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
            >
              Select all{filtered.length ? ` (${filtered.length})` : ""}
            </button>
          ) : (
            <>
              <span className="selectbar-count">{selectedCount} selected</span>
              <button
                className="btn ghost small"
                onClick={selectAllFiltered}
                disabled={allFilteredSelected}
              >
                Select all{filtered.length ? ` (${filtered.length})` : ""}
              </button>
              <button
                className="btn ghost small"
                onClick={() => print(selectedItems)}
                title="Print only the selected items"
              >
                Print selected
              </button>
              <button
                className="btn ghost small danger"
                onClick={deleteSelected}
                title="Delete the selected items from this project"
              >
                Delete selected
              </button>
              <span className="spacer" />
              <button className="btn ghost small" onClick={clearSelection}>
                Clear selection
              </button>
            </>
          )}
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

      {/* Print layouts live outside .no-print and are shown only when
          printing. Both stay mounted so their photos are already loaded when
          the dialog opens; data-active picks the one that prints. */}
      <TearSheetPrint
        project={project}
        items={printItems}
        style={style}
        firmName={firm.name}
        active={printForms === null}
      />
      <InventoryFormPrint
        items={printForms ?? inventory}
        style={style}
        firmName={firm.name}
        active={printForms !== null}
      />

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
          vendorOptions={vendorOptions}
          categoryOptions={categoryOptions}
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
          vendorOptions={vendorOptions}
          categoryOptions={categoryOptions}
        />
      )}
      {editingInventory && (
        <ItemEditor
          item={editingInventory}
          libraryMode
          inventoryMode
          heading={
            inventory.some((i) => i.id === editingInventory.id)
              ? "Edit inventory item"
              : "New inventory item"
          }
          vendorOptions={vendorOptions}
          categoryOptions={categoryOptions}
          onSave={saveInventoryDraft}
          onClose={() => setEditingInventory(null)}
          onDelete={
            inventory.some((i) => i.id === editingInventory.id)
              ? removeInventoryItem
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
      {pickingForInventory && (
        <LibraryPicker
          library={library}
          loading={libraryLoading}
          error={libraryError}
          clientName="your inventory"
          onConfirm={(items) => void addLibraryItemsToInventory(items)}
          onClose={() => setPickingForInventory(false)}
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
      {showing && (
        <Slideshow
          items={showing.items}
          title={showing.title}
          startIndex={showing.startIndex}
          showVendor={showVendor}
          onClose={() => setShowing(null)}
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
