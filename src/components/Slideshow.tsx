import { useCallback, useEffect, useState } from "react";
import type { Item } from "../types";
import {
  formatPrice,
  lineTotal,
  onImgError,
  safeImageUrl,
  safeLinkUrl,
} from "../util";

// Sheets per screen in the grid layout (2×2).
const GRID_SIZE = 4;

interface Props {
  /** The items to present, in presentation order. */
  items: Item[];
  /** Shown in the top bar — the project name, a room name, "Selection", … */
  title?: string;
  startIndex: number;
  onClose: () => void;
  /** Show the vendor on each slide (visual only — matches the card toggle). */
  showVendor?: boolean;
}

/** Full-screen presentation mode: one item per screen, or a 2×2 grid of four. */
export default function Slideshow({
  items,
  title,
  startIndex,
  onClose,
  showVendor = true,
}: Props) {
  const [layout, setLayout] = useState<"single" | "grid">("single");
  const [index, setIndex] = useState(
    Math.min(Math.max(0, startIndex), Math.max(0, items.length - 1))
  );

  // In grid layout, navigation moves a whole page (4 items) at a time; the
  // index snaps to the start of the neighboring page so switching back to
  // single layout lands on an item that was just on screen.
  const next = useCallback(
    () =>
      setIndex((i) =>
        layout === "grid"
          ? Math.min(
              (Math.floor(i / GRID_SIZE) + 1) * GRID_SIZE,
              items.length - 1
            )
          : Math.min(i + 1, items.length - 1)
      ),
    [items.length, layout]
  );
  const prev = useCallback(
    () =>
      setIndex((i) =>
        layout === "grid"
          ? Math.max((Math.floor(i / GRID_SIZE) - 1) * GRID_SIZE, 0)
          : Math.max(i - 1, 0)
      ),
    [layout]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  if (items.length === 0) {
    return (
      <div className="show">
        <button className="show-close" onClick={onClose}>
          Close ✕
        </button>
        <div className="show-empty">No items to present.</div>
      </div>
    );
  }

  const page = Math.floor(index / GRID_SIZE);
  const pageCount = Math.ceil(items.length / GRID_SIZE);
  const atStart = layout === "grid" ? page === 0 : index === 0;
  const atEnd =
    layout === "grid" ? page === pageCount - 1 : index === items.length - 1;
  const pageItems = items.slice(page * GRID_SIZE, (page + 1) * GRID_SIZE);

  // Vendor is hidden when the toggle is off; collection still shows.
  const vendorLine = (it: Item) =>
    [showVendor ? it.vendor : "", it.collection].filter(Boolean).join(" · ");

  const it: Item = items[index];
  const total = lineTotal(it);

  return (
    <div className="show">
      <div className="show-bar">
        <div className="show-meta">{title && <strong>{title}</strong>}</div>
        <div className="show-bar-right">
          <div className="show-layout" role="tablist" aria-label="Layout">
            <button
              className={layout === "single" ? "active" : ""}
              onClick={() => setLayout("single")}
            >
              One per screen
            </button>
            <button
              className={layout === "grid" ? "active" : ""}
              onClick={() => setLayout("grid")}
            >
              Four per screen
            </button>
          </div>
          <div className="show-count">
            {layout === "grid"
              ? `${page + 1} / ${pageCount}`
              : `${index + 1} / ${items.length}`}
          </div>
          <button className="show-close" onClick={onClose}>
            Close ✕
          </button>
        </div>
      </div>

      <div className="show-stage">
        <button
          className="show-nav left"
          onClick={prev}
          disabled={atStart}
          aria-label="Previous"
        >
          ‹
        </button>

        {layout === "grid" ? (
          <div className="show-grid">
            {pageItems.map((gi) => (
              <div className="show-cell" key={gi.id}>
                <div className="show-cell-img">
                  <img
                    src={safeImageUrl(gi.imageUrl)}
                    alt={gi.name}
                    onError={onImgError}
                  />
                </div>
                <div className="show-cell-info">
                  {gi.category && <p className="slide-cat">{gi.category}</p>}
                  <h3 className="show-cell-title">
                    {gi.name || "Untitled item"}
                  </h3>
                  {vendorLine(gi) && (
                    <p className="slide-vendor">{vendorLine(gi)}</p>
                  )}
                  <SpecList it={gi} />
                  {gi.price !== null && (
                    <p className="slide-price">
                      {formatPrice(gi.price)}
                      {gi.quantity > 1 && (
                        <span className="slide-price-sub">
                          {" "}
                          × {gi.quantity} = {formatPrice(lineTotal(gi))}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="slide">
            <div className="slide-img">
              <img
                src={safeImageUrl(it.imageUrl)}
                alt={it.name}
                onError={onImgError}
              />
            </div>
            <div className="slide-info">
              {it.category && <p className="slide-cat">{it.category}</p>}
              <h2 className="slide-title">{it.name || "Untitled item"}</h2>
              {vendorLine(it) && <p className="slide-vendor">{vendorLine(it)}</p>}

              <SpecList it={it} />

              {it.notes && <p className="slide-notes">{it.notes}</p>}

              {safeLinkUrl(it.productUrl) && (
                <p>
                  <a
                    className="link-btn"
                    href={safeLinkUrl(it.productUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View product page ↗
                  </a>
                </p>
              )}

              {it.price !== null && (
                <p className="slide-price">
                  {formatPrice(it.price)}
                  {it.quantity > 1 && (
                    <span className="slide-price-sub">
                      {" "}
                      × {it.quantity} = {formatPrice(total)}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        <button
          className="show-nav right"
          onClick={next}
          disabled={atEnd}
          aria-label="Next"
        >
          ›
        </button>
      </div>

      <div className="show-hint muted">
        Use ← → arrow keys · Esc to exit
      </div>
    </div>
  );
}

/** The spec lines shown on a slide (shared by the 1-up and grid layouts). */
function SpecList({ it }: { it: Item }) {
  return (
    <dl className="slide-specs">
      {it.sku && (
        <div>
          <dt>SKU</dt>
          <dd>{it.sku}</dd>
        </div>
      )}
      {it.dimensions && (
        <div>
          <dt>Dimensions</dt>
          <dd>{it.dimensions}</dd>
        </div>
      )}
      {it.material && (
        <div>
          <dt>Material</dt>
          <dd>{it.material}</dd>
        </div>
      )}
      {it.color && (
        <div>
          <dt>Color</dt>
          <dd>{it.color}</dd>
        </div>
      )}
      {it.leadTime && (
        <div>
          <dt>Lead time</dt>
          <dd>{it.leadTime}</dd>
        </div>
      )}
      {it.room && (
        <div>
          <dt>Room</dt>
          <dd>{it.room}</dd>
        </div>
      )}
    </dl>
  );
}
