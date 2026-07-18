import { supabase } from "./supabase";

// Item photos live in Supabase Storage, not in the database rows. Every save
// path funnels through offloadItemImages(): any item still carrying a base64
// data-URL photo (fresh upload, PowerPoint import, restored backup, or a legacy
// row from before this feature) gets its image uploaded to the firm's folder in
// the `item-images` bucket and the item stores the small public URL instead.
//
// Failure is always non-fatal: if the upload can't happen (bucket migration not
// run yet, offline, suspended firm), the data URL is kept and the app behaves
// exactly as it did before — the row is just bigger than it needs to be.

const BUCKET = "item-images";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isDataUrlImage(url: string | undefined): boolean {
  return !!url && /^data:image\//i.test(url);
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { blob: new Blob([bytes], { type: mime }), ext };
  } catch {
    return null;
  }
}

/**
 * Upload one data-URL image into the firm's storage folder and return its
 * public URL, or null if the upload isn't possible (caller keeps the data URL).
 */
export async function offloadDataUrl(
  dataUrl: string,
  firmId: string
): Promise<string | null> {
  const parsed = dataUrlToBlob(dataUrl);
  if (!parsed) return null;
  const path = `${firmId}/${crypto.randomUUID()}.${parsed.ext}`;
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, parsed.blob, {
        contentType: parsed.blob.type,
        // Paths are unique uuids, so the object is immutable — cache hard.
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * Replace data-URL images across a batch of items with storage URLs.
 * Per-item failures keep the original item untouched.
 */
export async function offloadItemImages<T extends { imageUrl?: string }>(
  items: T[],
  firmId: string
): Promise<{ items: T[]; changed: boolean }> {
  let changed = false;
  const out = await Promise.all(
    items.map(async (it) => {
      if (!isDataUrlImage(it.imageUrl)) return it;
      const url = await offloadDataUrl(it.imageUrl!, firmId);
      if (!url) return it;
      changed = true;
      return { ...it, imageUrl: url };
    })
  );
  return { items: changed ? out : items, changed };
}
