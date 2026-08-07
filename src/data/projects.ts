import { supabase } from "../lib/supabase";
import { offloadItemImages } from "../lib/imageStore";
import type { Item, Project } from "../types";
import { sanitizeItem } from "../types";

// The app's UI works on the camelCase `Project` shape. The database stores
// snake_case columns with items as a jsonb array. These helpers translate
// between the two so the rest of the app is unaware of the DB.

interface ProjectRow {
  id: string;
  firm_id: string;
  name: string;
  client: string;
  location: string;
  date: string | null;
  logo_url: string;
  notes: string;
  items: Item[] | null;
  updated_at?: string;
}

/**
 * Thrown when a save is rejected because the project changed in the database
 * after this browser loaded it — i.e. a teammate saved first. The caller is
 * expected to re-read the project and re-apply its change on top.
 */
export class ProjectConflictError extends Error {
  constructor() {
    super("This project was changed by someone else.");
    this.name = "ProjectConflictError";
  }
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    name: row.name,
    client: row.client ?? "",
    location: row.location ?? "",
    date: row.date ?? "",
    logoUrl: row.logo_url ?? "",
    notes: row.notes ?? "",
    // The items jsonb is member-written (possibly by older app versions), so
    // normalize each item at this boundary — same rule as the firm style.
    items: Array.isArray(row.items)
      ? row.items.map((it) => sanitizeItem(it, { keepId: true }))
      : [],
  };
}

// Payload of mutable columns, derived from a Project. `firm_id` is added on
// insert only (a project never changes firms).
function projectToRow(p: Project): Omit<ProjectRow, "firm_id" | "updated_at"> {
  return {
    id: p.id,
    name: p.name,
    client: p.client,
    location: p.location,
    date: p.date || null,
    logo_url: p.logoUrl,
    notes: p.notes,
    items: p.items,
  };
}

/** Load a firm's projects, newest-updated first. */
export async function fetchProjects(firmId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("firm_id", firmId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as ProjectRow[]).map(rowToProject);
}

/** Insert a new project for the given firm. Returns the stored project. */
export async function createProject(
  firmId: string,
  p: Project
): Promise<Project> {
  // Move any embedded data-URL photos to storage before the row is written
  // (covers duplicate-project and restore-backup, whose items can carry them).
  const { items: uploadedItems } = await offloadItemImages(p.items, firmId);
  p = { ...p, items: uploadedItems };
  // The database generates the project's UUID, so we must NOT send the
  // client-side placeholder id (it isn't a valid uuid and the insert would
  // be rejected). Strip it from the payload.
  const { id: _omit, ...row } = projectToRow(p);
  void _omit;
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...row, firm_id: firmId })
    // Select the header back (the DB generates the id and updated_at) but NOT
    // the items blob — echoing it would re-download every embedded image we
    // just uploaded.
    .select("id,firm_id,name,client,location,date,logo_url,notes,updated_at")
    .single();
  if (error) throw error;
  return rowToProject({ ...(data as ProjectRow), items: p.items });
}

/** Load one project by id, or null if it no longer exists. */
export async function fetchProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProject(data as ProjectRow) : null;
}

/**
 * Save the full project (header + items). Ownership is enforced by RLS.
 *
 * The whole item list is written as one jsonb blob, so a plain "last write
 * wins" update would silently erase anything a teammate saved after this
 * browser loaded the project. To prevent that the update is conditional on the
 * row still carrying the `updated_at` we loaded; the database's before-update
 * trigger moves that timestamp on every write, so a teammate's save makes our
 * filter match zero rows and we raise ProjectConflictError instead of
 * overwriting them.
 *
 * Returns the row's new `updated_at`, which the caller must keep as the token
 * for its next save.
 */
export async function saveProject(p: Project): Promise<string> {
  let update = supabase.from("projects").update(projectToRow(p)).eq("id", p.id);
  // A project with no token (never round-tripped through the DB) can't be
  // version-checked; fall back to an unconditional write rather than a save
  // that can never match.
  if (p.updatedAt) update = update.eq("updated_at", p.updatedAt);
  // Select the id and the fresh timestamp back — not the full row, whose echo
  // held nothing the app uses but a multi-MB re-download of every item image.
  const { data, error } = await update.select("id,updated_at").maybeSingle();
  if (error) throw error;
  if (!data) {
    // Zero rows matched: either the row is gone, or it's still there and only
    // the timestamp failed to match, which means a teammate saved first. Check
    // with an id-only read — the caller re-reads the full project itself.
    if (p.updatedAt) {
      const { data: still } = await supabase
        .from("projects")
        .select("id")
        .eq("id", p.id)
        .maybeSingle();
      if (still) throw new ProjectConflictError();
    }
    throw new Error("This project is no longer available (it may have been deleted).");
  }
  return (data as { updated_at: string }).updated_at;
}

/** Permanently delete a project. */
export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
