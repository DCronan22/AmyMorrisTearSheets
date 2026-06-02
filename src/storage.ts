import type { AppData } from "./types";

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
