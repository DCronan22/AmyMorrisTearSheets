import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FirmStyle, SheetBox, SheetStyle, SheetTextKey, TextStyle } from "../types";
import { SHEET_FONT_LABELS } from "../types";
import { safeLogoUrl } from "../util";
import { layoutSheet, sampleSheetItem, PAGE_H_PT } from "./sheetLayout";
import SheetView from "./SheetView";

interface Props {
  style: FirmStyle; // style.sheet is guaranteed non-null by the parent
  firmName: string;
  onChange: (sheet: SheetStyle) => void;
}

/** The draggable groups on the page and which box each one owns. */
type Group = "logo" | "photo" | "room" | "details" | "footer";
const BOX_OF: Record<Group, keyof Omit<SheetStyle, "text">> = {
  logo: "logo",
  photo: "photo",
  room: "room",
  details: "details",
  footer: "footer",
};

/** The panel's element list → the group it belongs to and its text key (if any). */
const ELEMENTS: { label: string; group: Group; textKey?: SheetTextKey }[] = [
  { label: "Logo / firm name", group: "logo", textKey: "wordmark" },
  { label: "Photo", group: "photo" },
  { label: "Room label", group: "room", textKey: "room" },
  { label: "Product name", group: "details", textKey: "name" },
  { label: "SKU", group: "details", textKey: "sku" },
  { label: "Dimensions", group: "details", textKey: "dimensions" },
  { label: "Price", group: "details", textKey: "price" },
  { label: "Lead time", group: "details", textKey: "leadTime" },
  { label: "Footer", group: "footer", textKey: "footer" },
];

const clamp01 = (n: number) => Math.min(1.2, Math.max(-0.2, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export default function SheetLayoutEditor({ style, firmName, onChange }: Props) {
  const sheet = style.sheet!;
  const sample = sampleSheetItem();
  const hasLogo = Boolean(safeLogoUrl(style.logoUrl));

  const [selIdx, setSelIdx] = useState(0); // index into ELEMENTS
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasH, setCanvasH] = useState(460);

  // Keep the px-per-point conversion in the preview honest as the canvas resizes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setCanvasH(el.clientHeight || 460);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sel = ELEMENTS[selIdx];
  const selGroup = sel.group;

  function setBox(group: Group, patch: Partial<SheetBox>) {
    const key = BOX_OF[group];
    onChange({ ...sheet, [key]: { ...sheet[key], ...patch } });
  }
  function setText(key: SheetTextKey, patch: Partial<TextStyle>) {
    onChange({ ...sheet, text: { ...sheet.text, [key]: { ...sheet.text[key], ...patch } } });
  }

  // --- Drag / resize (pointer-based, in canvas fractions) -------------------
  const drag = useRef<{
    group: Group;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    box: SheetBox;
  } | null>(null);

  function onPointerDown(
    e: ReactPointerEvent,
    group: Group,
    mode: "move" | "resize"
  ) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      group,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      box: { ...sheet[BOX_OF[group]] },
    };
    // Select the element that owns this group.
    const idx = ELEMENTS.findIndex((el) => el.group === group);
    if (idx >= 0) setSelIdx(idx);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dfx = (e.clientX - d.startX) / rect.width;
    const dfy = (e.clientY - d.startY) / rect.height;
    if (d.mode === "move") {
      setBox(d.group, { x: round3(clamp01(d.box.x + dfx)), y: round3(clamp01(d.box.y + dfy)) });
    } else {
      const w = round3(Math.min(2, Math.max(0.05, d.box.w + dfx)));
      const patch: Partial<SheetBox> = { w };
      if (d.group === "photo") patch.h = round3(Math.min(2, Math.max(0.03, d.box.h + dfy)));
      setBox(d.group, patch);
    }
  }
  function onPointerUp(e: ReactPointerEvent) {
    if (drag.current) {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      drag.current = null;
    }
  }

  // Bounding heights (page fractions) for the transparent drag frames.
  const els = layoutSheet(sample, style, firmName);
  const detailEls = els.filter((el) => el.t === "text" && el.group === "details");
  const detailsBottom = detailEls.reduce(
    (m, el) => Math.max(m, el.y + (el as { sizePt: number }).sizePt / PAGE_H_PT),
    sheet.details.y
  );
  const frames: { group: Group; box: SheetBox; h: number; show: boolean }[] = [
    { group: "logo", box: sheet.logo, h: hasLogo ? 0.09 : sheet.text.wordmark.size / PAGE_H_PT, show: true },
    { group: "photo", box: sheet.photo, h: sheet.photo.h, show: true },
    { group: "room", box: sheet.room, h: sheet.text.room.size / PAGE_H_PT, show: style.showRoom },
    { group: "details", box: sheet.details, h: Math.max(0.03, detailsBottom - sheet.details.y), show: true },
    { group: "footer", box: sheet.footer, h: sheet.text.footer.size / PAGE_H_PT, show: Boolean(style.footerText.trim()) },
  ];

  // The controls shown depend on the selected element.
  const isImage = (selGroup === "logo" && hasLogo) || selGroup === "photo";
  const textKey = sel.textKey;
  const ts = textKey ? sheet.text[textKey] : null;
  const box = sheet[BOX_OF[selGroup]];

  return (
    <div className="sheet-editor">
      <div
        className="sheet-canvas"
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <SheetView style={style} item={sample} firmName={firmName} heightPx={canvasH} />
        {frames
          .filter((f) => f.show)
          .map((f) => {
            const active = f.group === selGroup;
            const canResize = f.group === "photo" || (f.group === "logo" && hasLogo);
            return (
              <div
                key={f.group}
                className={`sheet-frame${active ? " active" : ""}`}
                style={{
                  left: `${f.box.x * 100}%`,
                  top: `${f.box.y * 100}%`,
                  width: `${f.box.w * 100}%`,
                  height: `${f.h * 100}%`,
                }}
                onPointerDown={(e) => onPointerDown(e, f.group, "move")}
                title={`Drag to move ${f.group}`}
              >
                {active && canResize && (
                  <span
                    className="sheet-resize"
                    onPointerDown={(e) => onPointerDown(e, f.group, "resize")}
                    title="Drag to resize"
                  />
                )}
              </div>
            );
          })}
      </div>

      <div className="sheet-panel">
        <label className="style-field">
          <span>Element</span>
          <select value={selIdx} onChange={(e) => setSelIdx(Number(e.target.value))}>
            {ELEMENTS.map((el, i) => (
              <option key={el.label} value={i}>
                {el.label}
              </option>
            ))}
          </select>
        </label>

        {isImage && (
          <p className="muted small">
            Drag the highlighted box on the page to move it, or drag its corner
            handle to resize.
          </p>
        )}

        {ts && textKey && !isImage && (
          <>
            <div className="sheet-row">
              <label className="style-field">
                <span>Font</span>
                <select
                  value={ts.font}
                  onChange={(e) => setText(textKey, { font: e.target.value as TextStyle["font"] })}
                >
                  {SHEET_FONT_LABELS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="style-field narrow">
                <span>Size (pt)</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={ts.size}
                  onChange={(e) =>
                    setText(textKey, { size: Math.min(120, Math.max(5, Number(e.target.value) || ts.size)) })
                  }
                />
              </label>
            </div>

            <div className="sheet-row">
              <label className="style-field narrow">
                <span>Color</span>
                <input
                  type="color"
                  value={ts.color || "#907c67"}
                  onChange={(e) => setText(textKey, { color: e.target.value })}
                />
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={ts.color === ""}
                  onChange={(e) => setText(textKey, { color: e.target.checked ? "" : "#907c67" })}
                />
                Auto color
              </label>
            </div>

            <div className="sheet-row">
              <label className="checkbox-inline">
                <input type="checkbox" checked={ts.bold} onChange={(e) => setText(textKey, { bold: e.target.checked })} />
                Bold
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" checked={ts.italic} onChange={(e) => setText(textKey, { italic: e.target.checked })} />
                Italic
              </label>
              <div className="sheet-align" role="group" aria-label="Alignment">
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={ts.align === a ? "active" : ""}
                    onClick={() => setText(textKey, { align: a })}
                    aria-label={a}
                  >
                    {a === "left" ? "⌫" : a === "center" ? "≡" : "⌦"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="sheet-row">
          <label className="style-field narrow">
            <span>X %</span>
            <input
              type="number"
              value={Math.round(box.x * 100)}
              onChange={(e) => setBox(selGroup, { x: round3(clamp01((Number(e.target.value) || 0) / 100)) })}
            />
          </label>
          <label className="style-field narrow">
            <span>Y %</span>
            <input
              type="number"
              value={Math.round(box.y * 100)}
              onChange={(e) => setBox(selGroup, { y: round3(clamp01((Number(e.target.value) || 0) / 100)) })}
            />
          </label>
          <label className="style-field narrow">
            <span>Width %</span>
            <input
              type="number"
              value={Math.round(box.w * 100)}
              onChange={(e) =>
                setBox(selGroup, { w: round3(Math.min(2, Math.max(0.05, (Number(e.target.value) || 5) / 100))) })
              }
            />
          </label>
          {selGroup === "photo" && (
            <label className="style-field narrow">
              <span>Height %</span>
              <input
                type="number"
                value={Math.round(box.h * 100)}
                onChange={(e) =>
                  setBox("photo", { h: round3(Math.min(2, Math.max(0.03, (Number(e.target.value) || 3) / 100))) })
                }
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
