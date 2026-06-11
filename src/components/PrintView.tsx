import type { CSSProperties } from "react";
import type { FirmStyle, Item, Project } from "../types";
import { FONT_STACKS, defaultFirmStyle } from "../types";
import {
  formatPrice,
  lineTotal,
  projectTotal,
  PLACEHOLDER_IMG,
  safeImageUrl,
  safeLogoUrl,
} from "../util";

interface Props {
  project: Project;
  firmName: string;
  /** The firm's export style. Falls back to the default look when absent. */
  style?: FirmStyle | null;
  /** Items to print; defaults to the whole project. */
  items?: Item[];
}

/**
 * Print-optimized layout. Hidden on screen (see print.css) and revealed only
 * during printing, so the browser's "Save as PDF" produces clean tear sheets.
 * The firm's style drives colors, fonts, logo, layout, and which fields show.
 */
export default function PrintView({ project, firmName, style, items: itemsProp }: Props) {
  const s = style ?? defaultFirmStyle();
  const items = itemsProp ?? project.items;
  const rooms = groupByRoom(items);
  const total = projectTotal(items);

  const fonts = FONT_STACKS[s.font];
  const vars = {
    "--ts-accent": s.accentColor,
    "--ts-text": s.textColor,
    "--ts-head": fonts.head,
    "--ts-body": fonts.body,
  } as CSSProperties;

  const logo = safeLogoUrl(s.logoUrl || project.logoUrl);
  const coverTitle = s.coverTitle.trim() || firmName;

  return (
    <div className={`print-root layout-${s.layout}`} style={vars} aria-hidden>
      <header className="print-cover">
        {logo && <img className="print-logo" src={logo} alt="" />}
        <h1 className="print-firm">{coverTitle}</h1>
        <h2 className="print-project">{project.name}</h2>
        <p className="print-sub">
          {[project.client, project.location].filter(Boolean).join(" · ")}
        </p>
        {project.date && (
          <p className="print-date">
            {new Date(project.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
        {project.notes && <p className="print-notes">{project.notes}</p>}
      </header>

      {rooms.map(([room, roomItems]) => (
        <section className="print-room" key={room}>
          <h3 className="print-room-title">{room}</h3>
          <div className="print-room-items">
            {roomItems.map((it) => (
              <article className="print-item" key={it.id}>
                <div className="print-item-img">
                  <img
                    src={safeImageUrl(it.imageUrl)}
                    alt={it.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
                    }}
                  />
                </div>
                <div className="print-item-info">
                  <h4>{it.name || "Untitled item"}</h4>
                  {(it.vendor || it.collection) && (
                    <p className="print-vendor">
                      {[it.vendor, it.collection].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <table className="print-specs">
                    <tbody>
                      {s.showSku && it.sku && <Spec label="SKU / Model" value={it.sku} />}
                      {it.collection && (
                        <Spec label="Collection" value={it.collection} />
                      )}
                      {it.category && <Spec label="Category" value={it.category} />}
                      {s.showDimensions && it.dimensions && (
                        <Spec label="Dimensions" value={it.dimensions} />
                      )}
                      {it.material && <Spec label="Material" value={it.material} />}
                      {it.color && <Spec label="Color" value={it.color} />}
                      {it.leadTime && <Spec label="Lead time" value={it.leadTime} />}
                      <Spec label="Quantity" value={String(it.quantity)} />
                    </tbody>
                  </table>
                  {it.notes && <p className="print-item-notes">{it.notes}</p>}
                </div>
                {s.showPrice && (
                  <div className="print-item-price">
                    {it.price !== null && (
                      <>
                        <span className="print-price-main">
                          {formatPrice(it.price)}
                        </span>
                        {it.quantity > 1 && (
                          <span className="print-price-ext">
                            Ext. {formatPrice(lineTotal(it))}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      {s.showPrice && (
        <footer className="print-foot">
          <span>Project total (priced items)</span>
          <strong>{formatPrice(total)}</strong>
        </footer>
      )}
      {s.footerText.trim() && <p className="print-tagline">{s.footerText.trim()}</p>}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{value}</td>
    </tr>
  );
}

/** Group items by room, preserving first-seen room order; unroomed last. */
function groupByRoom(items: Project["items"]): [string, Project["items"]][] {
  const map = new Map<string, Project["items"]>();
  for (const it of items) {
    const room = it.room?.trim() || "Additional Items";
    if (!map.has(room)) map.set(room, []);
    map.get(room)!.push(it);
  }
  return [...map.entries()];
}
