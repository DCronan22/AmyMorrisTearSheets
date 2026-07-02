import { supabase } from "../lib/supabase";
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

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
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
  // The database generates the project's UUID, so we must NOT send the
  // client-side placeholder id (it isn't a valid uuid and the insert would
  // be rejected). Strip it from the payload.
  const { id: _omit, ...row } = projectToRow(p);
  void _omit;
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...row, firm_id: firmId })
    // Select the header back (the DB generates the id) but NOT the items blob —
    // echoing it would re-download every embedded image we just uploaded.
    .select("id,firm_id,name,client,location,date,logo_url,notes")
    .single();
  if (error) throw error;
  return rowToProject({ ...(data as ProjectRow), items: p.items });
}

/** Save the full project (header + items). Ownership is enforced by RLS. */
export async function saveProject(p: Project): Promise<void> {
  // Select only the id back: it confirms the row still exists (RLS/deletion),
  // and the full-row echo held nothing the app uses — just a multi-MB
  // re-download of every embedded item image after each edit.
  const { data, error } = await supabase
    .from("projects")
    .update(projectToRow(p))
    .eq("id", p.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("This project is no longer available (it may have been deleted).");
  }
}

/** Permanently delete a project. */
export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
