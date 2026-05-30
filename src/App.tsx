import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { AppData, Item, Project } from "./types";
import { emptyItem, emptyProject } from "./types";
import { loadData, saveData, exportProjectFile, importProjectFile } from "./storage";
import { exportItemsToSpreadsheet } from "./spreadsheet";
import { distinct, projectTotal, formatPrice } from "./util";
import Gallery from "./components/Gallery";
import Slideshow from "./components/Slideshow";
import PrintView from "./components/PrintView";
import ItemEditor from "./components/ItemEditor";
import ImportPanel from "./components/ImportPanel";

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData());
  const [editing, setEditing] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  const [showIndex, setShowIndex] = useState<number | null>(null);
  const [roomFilter, setRoomFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [editingHeader, setEditingHeader] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save to localStorage whenever data changes.
  useEffect(() => saveData(data), [data]);

  const project: Project | undefined = useMemo(
    () =>
      data.projects.find((p) => p.id === data.activeProjectId) ??
      data.projects[0],
    [data]
  );

  const filtered = useMemo(() => {
    if (!project) return [];
    const q = search.trim().toLowerCase();
    return project.items.filter((it) => {
      if (roomFilter && it.room !== roomFilter) return false;
      if (categoryFilter && it.category !== categoryFilter) return false;
      if (q) {
        const hay = `${it.name} ${it.vendor} ${it.sku} ${it.material} ${it.color}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [project, roomFilter, categoryFilter, search]);

  if (!project) {
    return (
      <div className="empty-app">
        <button className="btn primary" onClick={() => createProject()}>
          Create a project
        </button>
      </div>
    );
  }

  // --- Mutators -------------------------------------------------------------

  function updateProject(mut: (p: Project) => Project) {
    setData((d) => ({
      ...d,
      projects: d.projects.map((p) => (p.id === project!.id ? mut(p) : p)),
    }));
  }

  function saveItem(item: Item) {
    updateProject((p) => {
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
    updateProject((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }));
    setEditing(null);
  }

  function handleImport(items: Item[], mode: "append" | "replace") {
    updateProject((p) => ({
      ...p,
      items: mode === "replace" ? items : [...p.items, ...items],
    }));
    setImporting(false);
  }

  function createProject() {
    const p = emptyProject();
    setData((d) => ({
      ...d,
      projects: [...d.projects, p],
      activeProjectId: p.id,
    }));
  }

  async function handleRestore(file: File) {
    try {
      const restored = await importProjectFile(file);
      setData(restored);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not read that backup.");
    }
  }

  const rooms = distinct(project.items, "room");
  const categories = distinct(project.items, "category");
  const total = projectTotal(project.items);

  // --- Render ---------------------------------------------------------------

  return (
    <>
      <div className="app no-print">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">AM</span>
            <div>
              <div className="brand-name">Amy Morris Interiors</div>
              <div className="brand-sub">Tear Sheets</div>
            </div>
          </div>

          <div className="toolbar">
            <select
              className="project-select"
              value={project.id}
              onChange={(e) =>
                setData((d) => ({ ...d, activeProjectId: e.target.value }))
              }
            >
              {data.projects.map((p) => (
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
                <button onClick={() => exportProjectFile(data)}>
                  Export backup (.json)
                </button>
                <button onClick={() => fileInputRef.current?.click()}>
                  Restore backup…
                </button>
                <button
                  onClick={() =>
                    exportItemsToSpreadsheet(project.items, project.name)
                  }
                >
                  Export items (.xlsx)
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleRestore(f);
                e.target.value = "";
              }}
            />
          </div>
        </header>

        <section className="project-head">
          {editingHeader ? (
            <ProjectHeaderForm
              project={project}
              onSave={(p) => {
                updateProject(() => p);
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
          <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="">All rooms</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {r}
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
          {(roomFilter || categoryFilter || search) && (
            <button
              className="btn ghost small"
              onClick={() => {
                setRoomFilter("");
                setCategoryFilter("");
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
          Auto-saved to this browser · Amy Morris Interiors Tear Sheets
        </footer>
      </div>

      {/* Print layout lives outside .no-print and is shown only when printing */}
      <PrintView project={project} />

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
