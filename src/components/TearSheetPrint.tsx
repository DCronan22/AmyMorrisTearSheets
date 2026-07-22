import { memo } from "react";
import type { CSSProperties } from "react";
import type { FirmStyle, Item, Project } from "../types";
import { FONT_STACKS } from "../types";
import { onImgError, priceLine, safeImageUrl, safeLogoUrl } from "../util";
import { layoutSheet } from "../branding/sheetLayout";
import type { SheetEl } from "../branding/sheetLayout";

interface Props {
  project: Project;
  /** The firm's export branding; drives logo, colors, fonts and field toggles. */
  style: FirmStyle;
  /** Shown as a text wordmark when the firm has no logo uploaded. */
  firmName: string;
  /** Items to print; defaults to the whole project. */
  items?: Item[];
}

/**
 * Tear sheet — one product per page: a tall 9:16 portrait card with the firm's
 * logo (or name) at top, an optional room label, the product photo centered,
 * and a centered details block (name / SKU / dimensions / price / lead time)
 * at the bottom. The firm's style controls the logo, colors, fonts and which
 * fields appear (see FirmStyle).
 *
 * Hidden on screen (see App.css) and revealed only while printing, so the
 * browser's "Save as PDF" produces clean tear sheets. Memoized: it stays
 * mounted (so images are loaded before the print dialog opens) and renders a
 * page per item, so it must not re-render on every workspace keystroke.
 */
function TearSheetPrint({ project, style, firmName, items }: Props) {
  const list = items ?? project.items;

  // Firms with a custom layout print via the absolute-positioned renderer; the
  // default template below is left exactly as-is (the pixel-matched path).
  if (style.sheet) {
    return (
      <div className="ts-print-root" aria-hidden>
        {list.map((it) => (
          <section className="ts-page ts-custom" key={it.id}>
            {layoutSheet(it, style, firmName).map((el, i) => (
              <PrintEl el={el} key={i} />
            ))}
          </section>
        ))}
      </div>
    );
  }

  const fonts = FONT_STACKS[style.font];
  const vars = {
    "--ts-accent": style.accentColor,
    "--ts-text": style.textColor,
    "--ts-head": fonts.head,
    "--ts-body": fonts.body,
  } as CSSProperties;
  const logo = safeLogoUrl(style.logoUrl);
  const wordmark = style.coverTitle.trim() || firmName;
  const footer = style.footerText.trim();

  return (
    <div className="ts-print-root" style={vars} aria-hidden>
      {list.map((it) => (
        <section className="ts-page" key={it.id}>
          {logo ? (
            <img className="ts-logo" src={logo} alt="" />
          ) : (
            <p className="ts-wordmark">{wordmark}</p>
          )}

          {style.showRoom && it.room.trim() && (
            <p className="ts-room">{it.room.trim()}</p>
          )}

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
            {style.showSku && it.sku.trim() && <p>SKU: {it.sku.trim()}</p>}
            {style.showDimensions && it.dimensions.trim() && (
              <p>Dimensions: {it.dimensions.trim()}</p>
            )}
            {style.showPrice && priceLine(it) && <p>{priceLine(it)}</p>}
            {it.leadTime.trim() && <p>Lead Time: {it.leadTime.trim()}</p>}
          </div>

          {footer && <p className="ts-footer">{footer}</p>}
        </section>
      ))}
    </div>
  );
}

/** One custom-layout element on a print page — positions in %, sizes in pt so
 *  the physical print matches what the editor shows. */
function PrintEl({ el }: { el: SheetEl }) {
  const base: CSSProperties = {
    position: "absolute",
    left: `${el.x * 100}%`,
    top: `${el.y * 100}%`,
    width: `${el.w * 100}%`,
  };
  if (el.t === "image") {
    if (el.key === "photo") {
      return (
        <div className="sv-photo" style={{ ...base, height: `${(el.h ?? 0.4) * 100}%` }}>
          <img src={el.src} alt="" onError={onImgError} />
        </div>
      );
    }
    return <img className="sv-logo" style={base} src={el.src} alt="" />;
  }
  return (
    <div
      style={{
        ...base,
        fontFamily: el.font,
        fontSize: `${el.sizePt}pt`,
        color: el.color,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? "italic" : "normal",
        textAlign: el.align,
        lineHeight: 1,
        whiteSpace: "pre-wrap",
      }}
    >
      {el.text}
    </div>
  );
}

export default memo(TearSheetPrint);
