import type { AppData, Project } from "./types";
import { emptyProject, sanitizeItem } from "./types";

// File-download helpers. Persistence now lives in Supabase (see src/data/), so
// these only handle the manual "Export backup (.json)" feature and the
// spreadsheet downloads.

/** Download the full app data as a backup .json file. */
export function exportProjectFile(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "tear-sheets-backup.json");
}

// A backup file is untrusted input (it may be hand-edited or from another
// machine), so every field is type-checked and coerced (via the shared
// sanitizeItem, WITHOUT keepId — restored items get fresh ids) before it gets
// near the database.
function sanitizeProject(raw: unknown): Project {
  const p = emptyProject();
  if (!raw || typeof raw !== "object") return p;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  p.name = str(r.name).trim() || "Restored project";
  p.client = str(r.client);
  p.location = str(r.location);
  // Only accept an ISO yyyy-mm-dd date; anything else becomes "no date".
  p.date = /^\d{4}-\d{2}-\d{2}$/.test(str(r.date)) ? str(r.date) : "";
  p.logoUrl = str(r.logoUrl);
  p.notes = str(r.notes);
  p.items = Array.isArray(r.items) ? r.items.map((it) => sanitizeItem(it)) : [];
  return p;
}

/** Parse + validate an exported backup (.json) file into clean projects. */
export async function parseBackupFile(file: File): Promise<Project[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a readable backup (.json) file.");
  }
  const projects = (raw as { projects?: unknown })?.projects;
  if (!Array.isArray(projects)) {
    throw new Error(
      "That file doesn't look like a Tear Sheets backup — choose a file made with “Export backup (.json)”."
    );
  }
  return projects.map(sanitizeProject);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
