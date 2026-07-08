import { memo } from "react";
import type { Item, Project } from "../types";
import { onImgError, priceLine, safeImageUrl } from "../util";
import logoUrl from "../assets/amy-morris-logo.png";

interface Props {
  project: Project;
  /** Items to print; defaults to the whole project. */
  items?: Item[];
}

/**
 * Amy Morris Interiors tear sheet — one product per page, matching the firm's
 * PowerPoint template exactly: a tall 9:16 portrait card with the logo at top,
 * an optional room label, the product photo centered, and a centered taupe
 * details block (name / dimensions / price / lead time) at the bottom.
 *
 * Hidden on screen (see App.css) and revealed only while printing, so the
 * browser's "Save as PDF" produces clean tear sheets. Memoized: it stays
 * mounted (so images are loaded before the print dialog opens) and renders a
 * page per item, so it must not re-render on every workspace keystroke.
 */
function TearSheetPrint({ project, items }: Props) {
  const list = items ?? project.items;
  return (
    <div className="ts-print-root" aria-hidden>
      {list.map((it) => (
        <section className="ts-page" key={it.id}>
          <img className="ts-logo" src={logoUrl} alt="Amy Morris Interiors" />

          {it.room.trim() && <p className="ts-room">{it.room.trim()}</p>}

          <div className="ts-photo-wrap">
            <img
              className="ts-photo"
              src={safeImageUrl(it.imageUrl)}
              alt={it.name}
              onError={onImgError}
            />
          </div>

          <div className="ts-details">
            <p className="ts-name">{it.name || "Untitled item"}</p>
            {it.dimensions.trim() && <p>Dimensions: {it.dimensions.trim()}</p>}
            {priceLine(it) && <p>{priceLine(it)}</p>}
            {it.leadTime.trim() && <p>Lead Time: {it.leadTime.trim()}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

export default memo(TearSheetPrint);
