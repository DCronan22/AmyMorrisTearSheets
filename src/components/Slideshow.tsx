import { useCallback, useEffect, useState } from "react";
import type { Item, Project } from "../types";
import { formatPrice, lineTotal, PLACEHOLDER_IMG, safeImageUrl } from "../util";

interface Props {
  project: Project;
  startIndex: number;
  onClose: () => void;
}

/** Full-screen, one-item-per-slide presentation mode. */
export default function Slideshow({ project, startIndex, onClose }: Props) {
  const items = project.items;
  const [index, setIndex] = useState(
    Math.min(Math.max(0, startIndex), Math.max(0, items.length - 1))
  );

  const next = useCallback(
    () => setIndex((i) => Math.min(i + 1, items.length - 1)),
    [items.length]
  );
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

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

  const it: Item = items[index];
  const total = lineTotal(it);
  const atStart = index === 0;
  const atEnd = index === items.length - 1;

  return (
    <div className="show">
      <div className="show-bar">
        <div className="show-meta">
          <strong>{project.name}</strong>
          {project.client && <span> · {project.client}</span>}
        </div>
        <div className="show-count">
          {index + 1} / {items.length}
        </div>
        <button className="show-close" onClick={onClose}>
          Close ✕
        </button>
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

        <div className="slide">
          <div className="slide-img">
            <img
              src={safeImageUrl(it.imageUrl)}
              alt={it.name}
              onError={(e) => {
                (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
              }}
            />
          </div>
          <div className="slide-info">
            {it.category && <p className="slide-cat">{it.category}</p>}
            <h2 className="slide-title">{it.name || "Untitled item"}</h2>
            {(it.vendor || it.collection) && (
              <p className="slide-vendor">
                {[it.vendor, it.collection].filter(Boolean).join(" · ")}
              </p>
            )}

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

            {it.notes && <p className="slide-notes">{it.notes}</p>}

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
