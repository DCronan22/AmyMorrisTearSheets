import type { Item } from "../types";
import {
  formatPrice,
  lineTotal,
  PLACEHOLDER_IMG,
  safeImageUrl,
  safeLinkUrl,
} from "../util";

interface Props {
  items: Item[];
  onEdit: (item: Item) => void;
  onPresentFrom: (index: number) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}

/** Responsive grid of item cards — the browsable web gallery. */
export default function Gallery({
  items,
  onEdit,
  onPresentFrom,
  selected,
  onToggleSelect,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <p>No items yet.</p>
        <p className="muted">
          Import a spreadsheet or add an item to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="gallery">
      {items.map((it, i) => {
        const total = lineTotal(it);
        const isSelected = selected.has(it.id);
        const productLink = safeLinkUrl(it.productUrl);
        return (
          <article
            className={`card${isSelected ? " card-selected" : ""}`}
            key={it.id}
          >
            <div
              className="card-img"
              onClick={() => onPresentFrom(i)}
              title="Click to present"
            >
              <label
                className="card-check"
                title={isSelected ? "Deselect item" : "Select item"}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(it.id)}
                />
              </label>
              <img
                src={safeImageUrl(it.imageUrl)}
                alt={it.name}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
                }}
              />
              {it.category && <span className="card-tag">{it.category}</span>}
            </div>
            <div className="card-body">
              <h3 className="card-title">{it.name || "Untitled item"}</h3>
              {(it.vendor || it.collection) && (
                <p className="card-vendor">
                  {[it.vendor, it.collection].filter(Boolean).join(" · ")}
                </p>
              )}
              <dl className="card-specs">
                {it.sku && (
                  <>
                    <dt>SKU</dt>
                    <dd>{it.sku}</dd>
                  </>
                )}
                {it.dimensions && (
                  <>
                    <dt>Size</dt>
                    <dd>{it.dimensions}</dd>
                  </>
                )}
                {it.material && (
                  <>
                    <dt>Material</dt>
                    <dd>{it.material}</dd>
                  </>
                )}
                {it.color && (
                  <>
                    <dt>Color</dt>
                    <dd>{it.color}</dd>
                  </>
                )}
                {it.leadTime && (
                  <>
                    <dt>Lead</dt>
                    <dd>{it.leadTime}</dd>
                  </>
                )}
              </dl>
              <div className="card-foot">
                <div className="card-price">
                  {it.price !== null && (
                    <>
                      <span className="price-main">{formatPrice(it.price)}</span>
                      {it.quantity > 1 && (
                        <span className="price-sub">
                          ×{it.quantity} = {formatPrice(total)}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <span className="card-actions">
                  {productLink && (
                    <a
                      className="btn ghost small"
                      href={productLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the vendor's product page"
                    >
                      Visit ↗
                    </a>
                  )}
                  <button className="btn ghost small" onClick={() => onEdit(it)}>
                    Edit
                  </button>
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
