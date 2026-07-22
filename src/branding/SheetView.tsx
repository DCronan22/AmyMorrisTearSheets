import type { CSSProperties } from "react";
import type { FirmStyle, Item } from "../types";
import { onImgError } from "../util";
import { layoutSheet, PAGE_H_PT } from "./sheetLayout";
import type { SheetEl } from "./sheetLayout";

interface Props {
  style: FirmStyle;
  item: Item;
  firmName: string;
  /** Rendered page height in px; text sizes (points) scale off this. */
  heightPx: number;
}

/**
 * Read-only on-screen render of one custom-layout tear-sheet page. Positions are
 * page fractions (so they scale with the container); point sizes are converted
 * to px against the page height. Shared by the style preview and the editor
 * canvas so what you arrange is what prints / exports.
 */
export default function SheetView({ style, item, firmName, heightPx }: Props) {
  if (!style.sheet) return null;
  const els = layoutSheet(item, style, firmName);
  const pxPerPt = heightPx / PAGE_H_PT;
  return <>{els.map((el, i) => renderEl(el, i, pxPerPt))}</>;
}

function renderEl(el: SheetEl, i: number, pxPerPt: number) {
  const base: CSSProperties = {
    position: "absolute",
    left: `${el.x * 100}%`,
    top: `${el.y * 100}%`,
    width: `${el.w * 100}%`,
  };
  if (el.t === "image") {
    if (el.key === "photo") {
      return (
        <div
          key={i}
          className="sv-photo"
          style={{ ...base, height: `${(el.h ?? 0.4) * 100}%` }}
        >
          <img src={el.src} alt="" onError={onImgError} />
        </div>
      );
    }
    return <img key={i} className="sv-logo" style={base} src={el.src} alt="" />;
  }
  return (
    <div
      key={i}
      style={{
        ...base,
        fontFamily: el.font,
        fontSize: el.sizePt * pxPerPt,
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
