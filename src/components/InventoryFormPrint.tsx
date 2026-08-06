import { memo } from "react";
import type { FirmStyle, InventoryItem } from "../types";
import { onImgError, safeImageUrl, safeLogoUrl } from "../util";
import {
  FORM,
  FORM_LAYOUT as L,
  FORM_TITLE,
  inventoryFormRows,
} from "../inventoryForm";

interface Props {
  items: InventoryItem[];
  /** Supplies the letterhead logo and the footer tagline. */
  style: FirmStyle;
  /** Set as a wordmark when the firm has no logo, as the Word export does. */
  firmName: string;
  /** Only the active print layout is shown to the print dialog. */
  active: boolean;
}

const inches = (n: number) => `${n}in`;

/**
 * The firm's "INVENTORY DETAIL FORM", one entry per US Letter page, rendered
 * for the browser's print / Save-as-PDF dialog.
 *
 * This is the same form the Word export produces (src/docxExport.ts) and the
 * PowerPoint export produces (src/inventoryFormPptx.ts): all three read their
 * wording, value formatting and geometry from src/inventoryForm.ts, and all
 * three position from the same absolute page coordinates, so printing an entry
 * and exporting it give the same page rather than three near-misses.
 *
 * Hidden on screen and revealed only while printing (see App.css). Kept
 * mounted alongside the tear-sheet layout so photos are loaded by the time the
 * print dialog opens; `active` decides which of the two actually prints.
 */
function InventoryFormPrint({ items, style, firmName, active }: Props) {
  const logo = safeLogoUrl(style.logoUrl);
  const footer = style.footerText.trim();

  return (
    <div className="ivf-root" data-active={active ? "1" : "0"} aria-hidden>
      {items.map((item) => (
        <section
          className="ivf-page"
          key={item.id}
          style={{ width: inches(FORM.pageW), height: inches(FORM.pageH) }}
        >
          {/* Letterhead */}
          <div
            className="ivf-head"
            style={{
              left: inches(L.contentX),
              top: inches(L.logoY),
              width: inches(L.contentW),
              height: inches(FORM.logoH),
            }}
          >
            {logo ? (
              <img className="ivf-logo" src={logo} alt="" onError={onImgError} />
            ) : (
              <span
                className="ivf-wordmark"
                style={{ fontSize: `${FORM.wordmarkPt}pt` }}
              >
                {firmName}
              </span>
            )}
          </div>

          <h1
            className="ivf-title"
            style={{
              left: inches(L.contentX),
              top: inches(L.titleY),
              width: inches(L.contentW),
              fontSize: `${FORM.titlePt}pt`,
              lineHeight: inches(L.titleH),
            }}
          >
            {FORM_TITLE}
          </h1>

          <div
            className="ivf-fields"
            style={{
              left: inches(L.contentX),
              top: inches(L.fieldsY),
              width: inches(L.contentW),
              fontSize: `${FORM.bodyPt}pt`,
            }}
          >
            {inventoryFormRows(item).map((row) => (
              <p
                className="ivf-row"
                key={row.left.label}
                style={{ height: inches(L.lineH), lineHeight: inches(L.lineH) }}
              >
                <span className="ivf-label">{row.left.label}</span>{" "}
                <span className="ivf-value">{row.left.value}</span>
                {row.right && (
                  <span
                    className="ivf-second"
                    style={{ left: inches(FORM.secondCol) }}
                  >
                    <span className="ivf-label">{row.right.label}</span>{" "}
                    <span className="ivf-value">{row.right.value}</span>
                  </span>
                )}
              </p>
            ))}
          </div>

          {/* The bordered box prints whether or not there's a photo — a blank
              box is what the firm's own form has before a picture goes in. */}
          <div
            className="ivf-box"
            style={{
              left: inches(L.boxX),
              top: inches(L.boxY),
              width: inches(FORM.boxW),
              height: inches(FORM.boxH),
              borderWidth: `${FORM.borderPt}pt`,
            }}
          />
          {item.imageUrl && (
            <img
              className="ivf-photo"
              src={safeImageUrl(item.imageUrl)}
              alt=""
              onError={onImgError}
              style={{
                left: inches(L.photoX),
                top: inches(L.photoY),
                width: inches(FORM.photoW),
                maxHeight: inches(FORM.boxH - (L.photoY - L.boxY) * 2),
              }}
            />
          )}

          {footer && (
            <div
              className="ivf-foot"
              style={{
                left: inches(L.contentX),
                top: inches(L.footerY),
                width: inches(L.contentW),
                fontSize: `${FORM.footerPt}pt`,
              }}
            >
              {footer}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export default memo(InventoryFormPrint);
