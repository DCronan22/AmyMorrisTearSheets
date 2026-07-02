import { memo } from "react";
import type { ReactNode } from "react";
import type { Item, LibraryItem } from "../types";
import {
  formatPrice,
  lineTotal,
  onImgError,
  safeImageUrl,
  safeLinkUrl,
} from "../util";

/** Anything with the product display fields — a project Item or a LibraryItem. */
export type CardItem = Item | LibraryItem;

interface Props {
  item: CardItem;
  selected?: boolean;
  /** Show a selection checkbox when provided. */
  onToggleSelect?: (id: string) => void;
  /** Edit action (pencil) when provided. */
  onEdit?: (item: CardItem) => void;
  /** Delete action when provided (used by the library). */
  onDelete?: (id: string) => void;
  /** Click the image to present (client gallery) when provided. */
  onPresent?: () => void;
  /** Optional control rendered in the card body, e.g. a quick room selector. */
  extraControl?: ReactNode;
  /** Show the vendor on the card (visual only — defaults to true). */
  showVendor?: boolean;
}

/**
 * One product card — the shared building block for the client gallery, the
 * room-grouped client view, the library, and the library picker. Behavior is
 * driven entirely by which callbacks are passed. Memoized: galleries can hold
 * hundreds of cards, so a search keystroke shouldn't re-render them all.
 */
function ItemCard({
  item,
  selected = false,
  onToggleSelect,
  onEdit,
  onDelete,
  onPresent,
  extraControl,
  showVendor = true,
}: Props) {
  const qty = "quantity" in item ? item.quantity : 1;
  const total = "quantity" in item ? lineTotal(item) : item.price;
  const productLink = safeLinkUrl(item.productUrl);
  // Vendor line text: drop the vendor when the card-level toggle hides it, but
  // never the data itself (the item keeps its vendor; only the card hides it).
  const vendorLine = [showVendor ? item.vendor : "", item.collection]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className={`card${selected ? " card-selected" : ""}`}>
      <div
        className={`card-img${onPresent ? "" : " card-img-static"}`}
        onClick={onPresent}
        title={onPresent ? "Click to present" : undefined}
      >
        {onToggleSelect && (
          <label
            className="card-check"
            title={selected ? "Deselect item" : "Select item"}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(item.id)}
            />
          </label>
        )}
        <img
          src={safeImageUrl(item.imageUrl)}
          alt={item.name}
          loading="lazy"
          onError={onImgError}
        />
        {item.category && <span className="card-tag">{item.category}</span>}
      </div>
      <div className="card-body">
        <h3 className="card-title">{item.name || "Untitled item"}</h3>
        {vendorLine && <p className="card-vendor">{vendorLine}</p>}
        <dl className="card-specs">
          {item.sku && (
            <>
              <dt>SKU</dt>
              <dd>{item.sku}</dd>
            </>
          )}
          {item.dimensions && (
            <>
              <dt>Size</dt>
              <dd>{item.dimensions}</dd>
            </>
          )}
          {item.material && (
            <>
              <dt>Material</dt>
              <dd>{item.material}</dd>
            </>
          )}
          {item.color && (
            <>
              <dt>Color</dt>
              <dd>{item.color}</dd>
            </>
          )}
          {item.leadTime && (
            <>
              <dt>Lead</dt>
              <dd>{item.leadTime}</dd>
            </>
          )}
        </dl>
        {extraControl}
        <div className="card-foot">
          <div className="card-price">
            {item.price !== null && (
              <>
                <span className="price-main">{formatPrice(item.price)}</span>
                {qty > 1 && (
                  <span className="price-sub">
                    ×{qty} = {formatPrice(total)}
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
            {onEdit && (
              <button className="btn ghost small" onClick={() => onEdit(item)}>
                Edit
              </button>
            )}
            {onDelete && (
              <button
                className="btn ghost small danger"
                onClick={() => onDelete(item.id)}
              >
                Delete
              </button>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

export default memo(ItemCard);
