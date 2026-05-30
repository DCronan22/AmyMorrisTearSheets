import type { AppData } from "./types";
import { makeInitialData } from "./sampleData";

const STORAGE_KEY = "amymorris.tearsheets.v1";

/** Load persisted data, falling back to seeded demo data on first run. */
export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeInitialData();
    const parsed = JSON.parse(raw) as AppData;
    if (!parsed || !Array.isArray(parsed.projects)) return makeInitialData();
    return parsed;
  } catch {
    return makeInitialData();
  }
}

/** Persist data to localStorage (best-effort). */
export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage may be full (large data-URL images) or unavailable; ignore.
  }
}

/** Download the full app data as a backup .json file. */
export function exportProjectFile(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "amy-morris-tearsheets.json");
}

/** Parse an imported backup file into AppData. */
export async function importProjectFile(file: File): Promise<AppData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as AppData;
  if (!parsed || !Array.isArray(parsed.projects)) {
    throw new Error("That file doesn't look like a tear sheet backup.");
  }
  return parsed;
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
