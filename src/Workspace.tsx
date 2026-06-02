import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { AppData, Firm, Item, Project } from "./types";
import { emptyItem, emptyProject } from "./types";
import { exportProjectFile } from "./storage";
import { exportItemsToSpreadsheet } from "./spreadsheet";
import {
  createProject as dbCreateProject,
  deleteProject as dbDeleteProject,
  fetchProjects,
  saveProject,
} from "./data/projects";
import { distinct, projectTotal, formatPrice } from "./util";
import Gallery from "./components/Gallery";
import Slideshow from "./components/Slideshow";
import PrintView from "./components/PrintView";
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

  // --- Persistence ----------------------------------------------------------

  async function persist(p: Project) {
    setSaveError(null);
    try {
      const saved = await saveProject(p);
      // Adopt the stored row (server-normalized date, updated_at) into state.
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
  }

  function deleteItem(id: string) {
    applyProjectChange((p) => ({
      ...p,
      items: p.items.filter((i) => i.id !== id),
    }));
    setEditing(null);
  }

  function handleImport(items: Item[], mode: "append" | "replace") {
    applyProjectChange((p) => ({
      ...p,
      items: mode === "replace" ? items : [...p.items, ...items],
    }));
    setImporting(false);
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
          {isPlatformAdmin && (
            <button className="link-btn" onClick={onOpenAdmin}>
              Admin
            </button>
          )}{" "}
          <button className="link-btn" onClick={onSignOut}>
            Sign out
          </button>
        </p>
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
      <div className="app no-print">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">{initials}</span>
            <div>
              <div className="brand-name">{firm.name}</div>
              <div className="brand-sub">Tear Sheets</div>
            </div>
          </div>

          <div className="toolbar">
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
            <button className="btn" onClick={() => setImporting(true)}>
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
              onClick={() => window.print()}
              disabled={!project.items.length}
            >
              🖶 Print / PDF
            </button>
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
                <button onClick={() => exportProjectFile(backupData)}>
                  Export backup (.json)
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

        <main className="content">
          <Gallery
            items={filtered}
            onEdit={setEditing}
            onPresentFrom={(i) => {
              const item = filtered[i];
              const realIndex = project.items.findIndex((x) => x.id === item.id);
              setShowIndex(realIndex >= 0 ? realIndex : 0);
            }}
          />
        </main>

        <footer className="appfoot muted small">
          Saved to your account · {firm.name} Tear Sheets
        </footer>
      </div>

      {/* Print layout lives outside .no-print and is shown only when printing */}
      <PrintView project={project} firmName={firm.name} />

      {editing && (
        <ItemEditor
          item={editing}
          onSave={saveItem}
          onClose={() => setEditing(null)}
          onDelete={
            project.items.some((i) => i.id === editing.id) ? deleteItem : undefined
          }
        />
      )}
      {importing && (
        <ImportPanel onImport={handleImport} onClose={() => setImporting(false)} />
      )}
      {showIndex !== null && (
        <Slideshow
          project={project}
          startIndex={showIndex}
          onClose={() => setShowIndex(null)}
        />
      )}
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
