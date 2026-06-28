import { useState } from "react";
import type { Item } from "../types";
import { autofill, compressImageFile } from "../lib/extract";
import type { AutofillFields } from "../lib/extract";
import { safeImageUrl } from "../util";

interface Props {
  item: Item;
  onSave: (item: Item) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
  /** Save the current draft as a NEW copy (existing items only). */
  onDuplicate?: (item: Item) => void;
}

/** Modal form for adding or editing a single item. */
export default function ItemEditor({
  item,
  onSave,
  onClose,
  onDelete,
  onDuplicate,
}: Props) {
  const [draft, setDraft] = useState<Item>(item);
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [autoErr, setAutoErr] = useState<string | null>(null);

  function set<K extends keyof Item>(key: K, value: Item[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Merge extracted fields in, filling blanks and updating provided values
  // without wiping anything the extractor didn't return.
  function applyFields(fields: AutofillFields) {
    setDraft((d) => {
      const next = { ...d };
      const put = (k: keyof Item, v: string | undefined) => {
        if (v && v.trim()) (next[k] as string) = v.trim();
      };
      put("name", fields.name);
      put("vendor", fields.vendor);
      put("collection", fields.collection);
      put("category", fields.category);
      put("sku", fields.sku);
      put("dimensions", fields.dimensions);
      put("material", fields.material);
      put("color", fields.color);
      put("imageUrl", fields.imageUrl);
      put("productUrl", fields.productUrl);
      if (typeof fields.price === "number") next.price = fields.price;
      return next;
    });
  }

  async function autofillFromLink() {
    const url = linkUrl.trim();
    if (!url) return;
    setBusy(true);
    setAutoErr(null);
    setAutoMsg("Reading the product page…");
    try {
      const { fields, source, warnings } = await autofill({ url, aiFallback: true });
      applyFields(fields);
      setAutoMsg(
        warnings.length
          ? warnings.join(" ")
          : `Filled from ${source === "ai" ? "the page (AI)" : "the product page"}. Review and tweak below.`
      );
    } catch (e) {
      setAutoMsg(null);
      setAutoErr(e instanceof Error ? e.message : "Couldn't read that link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImageFile(file: File, extract: boolean) {
    setAutoErr(null);
    try {
      const dataUrl = await compressImageFile(file);
      set("imageUrl", dataUrl);
      if (extract) {
        setBusy(true);
        setAutoMsg("Reading details from the image…");
        const { fields, warnings } = await autofill({ image: dataUrl });
        applyFields(fields);
        // Keep the uploaded photo, not whatever the extractor guessed.
        set("imageUrl", dataUrl);
        setAutoMsg(warnings.length ? warnings.join(" ") : "Filled from the image. Review below.");
      }
    } catch (e) {
      setAutoMsg(null);
      setAutoErr(e instanceof Error ? e.message : "Couldn't process that image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{item.name ? "Edit item" : "New item"}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="autofill-bar">
          <div className="autofill-row">
            <span className="autofill-spark">✨</span>
            <input
              className="autofill-input"
              placeholder="Paste a product link to auto-fill…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  autofillFromLink();
                }
              }}
              disabled={busy}
            />
            <button
              type="button"
              className="btn primary small"
              onClick={autofillFromLink}
              disabled={busy || !linkUrl.trim()}
            >
              {busy ? "Working…" : "Auto-fill"}
            </button>
          </div>
          {autoMsg && <p className="status-ok small">{autoMsg}</p>}
          {autoErr && <p className="status-err small">{autoErr}</p>}
        </div>

        <div className="form-grid">
          <label className="full">
            <span>Item name</span>
            <input
              value={draft.name}
              autoFocus
              onChange={(e) => set("name", e.target.value)}
              placeholder="Lawson Tailored Sofa"
            />
          </label>

          <label>
            <span>Vendor</span>
            <input value={draft.vendor} onChange={(e) => set("vendor", e.target.value)} />
          </label>
          <label>
            <span>Collection</span>
            <input
              value={draft.collection}
              onChange={(e) => set("collection", e.target.value)}
              placeholder="Product line / collection"
            />
          </label>
          <label>
            <span>Category</span>
            <input
              value={draft.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="Seating, Lighting, Rug…"
            />
          </label>
          <label>
            <span>Room</span>
            <input value={draft.room} onChange={(e) => set("room", e.target.value)} />
          </label>
          <label>
            <span>SKU / Model #</span>
            <input value={draft.sku} onChange={(e) => set("sku", e.target.value)} />
          </label>

          <label>
            <span>Price (each)</span>
            <input
              type="number"
              value={draft.price ?? ""}
              onChange={(e) =>
                set("price", e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </label>
          <label>
            <span>Quantity</span>
            <input
              type="number"
              min={1}
              value={draft.quantity}
              onChange={(e) => set("quantity", Math.max(1, Number(e.target.value) || 1))}
            />
          </label>

          <label>
            <span>Dimensions</span>
            <input
              value={draft.dimensions}
              onChange={(e) => set("dimensions", e.target.value)}
              placeholder={'84"W x 38"D x 31"H'}
            />
          </label>
          <label>
            <span>Lead time</span>
            <input value={draft.leadTime} onChange={(e) => set("leadTime", e.target.value)} />
          </label>

          <label className="full checkbox-row">
            <input
              type="checkbox"
              checked={draft.upholstered !== false}
              onChange={(e) => set("upholstered", e.target.checked)}
            />
            <span>
              Upholstered piece — tear-sheet price reads “+ Fabric + Freight”
              (unchecked: just “+ Freight”)
            </span>
          </label>

          <label>
            <span>Material / finish</span>
            <input value={draft.material} onChange={(e) => set("material", e.target.value)} />
          </label>
          <label>
            <span>Color</span>
            <input value={draft.color} onChange={(e) => set("color", e.target.value)} />
          </label>

          <label className="full">
            <span>Notes</span>
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>

          <label className="full">
            <span>Image URL</span>
            <input
              value={draft.imageUrl.startsWith("data:") ? "" : draft.imageUrl}
              onChange={(e) => set("imageUrl", e.target.value)}
              placeholder="https://…  (or upload below)"
            />
          </label>
          <label className="full">
            <span>…or upload an image (auto-compressed)</span>
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f, false);
                e.target.value = "";
              }}
            />
          </label>
          <label className="full">
            <span>…or extract details from a product photo / screenshot</span>
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f, true);
                e.target.value = "";
              }}
            />
          </label>

          {draft.imageUrl && (
            <div className="full image-preview">
              <img src={safeImageUrl(draft.imageUrl)} alt="preview" />
            </div>
          )}

          <label className="full">
            <span>Product URL</span>
            <input
              value={draft.productUrl}
              onChange={(e) => set("productUrl", e.target.value)}
            />
          </label>
        </div>

        <div className="modal-actions">
          {onDelete && (
            <button
              className="btn danger ghost"
              onClick={() => onDelete(draft.id)}
            >
              Delete
            </button>
          )}
          {onDuplicate && (
            <button
              className="btn ghost"
              onClick={() => onDuplicate(draft)}
              title="Add a copy of this item to the project"
            >
              Duplicate
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(draft)}>
            Save item
          </button>
        </div>
      </div>
    </div>
  );
}
