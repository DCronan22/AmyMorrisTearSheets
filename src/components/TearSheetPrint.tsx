import type { Item, Project } from "../types";
import { formatPrice, safeImageUrl, PLACEHOLDER_IMG } from "../util";
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
 * browser's "Save as PDF" produces clean tear sheets.
 */
export default function TearSheetPrint({ project, items }: Props) {
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
              onError={(e) => {
                (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
              }}
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

/**
 * Build the price line, e.g. "Price: $7,020 + Fabric + Freight". Upholstered
 * pieces get "+ Fabric + Freight"; everything else just "+ Freight" (matching
 * the Cameron/Century chairs+beds vs. the Jasper console). Returns null when the
 * item has no price, so the line is omitted entirely.
 */
function priceLine(it: Item): string | null {
  if (it.price === null || it.price === undefined) return null;
  const suffix = it.upholstered === false ? "+ Freight" : "+ Fabric + Freight";
  return `Price: ${formatPrice(it.price)} ${suffix}`;
}
