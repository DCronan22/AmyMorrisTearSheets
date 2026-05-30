import { useState } from "react";
import type { Item } from "../types";

interface Props {
  item: Item;
  onSave: (item: Item) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

/** Modal form for adding or editing a single item. */
export default function ItemEditor({ item, onSave, onClose, onDelete }: Props) {
  const [draft, setDraft] = useState<Item>(item);

  function set<K extends keyof Item>(key: K, value: Item[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function readImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => set("imageUrl", String(reader.result));
    reader.readAsDataURL(file);
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
            <span>…or upload an image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readImageFile(f);
              }}
            />
          </label>

          {draft.imageUrl && (
            <div className="full image-preview">
              <img src={draft.imageUrl} alt="preview" />
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
