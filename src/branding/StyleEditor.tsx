import { useRef, useState } from "react";
import type { Firm, FirmStyle } from "../types";
import {
  FONT_STACKS,
  TEAR_SHEET_LAYOUTS,
  defaultFirmStyle,
} from "../types";
import { saveFirmStyle } from "../data/firmStyle";
import { compressImageFile, compressLogoFile } from "../lib/extract";
import { detectStyleFromSample } from "../lib/styleDetect";
import { safeLogoUrl } from "../util";
import StylePreview from "./StylePreview";

interface Props {
  firm: Firm;
  /** First-run mode shows the welcome framing + a "Skip for now" action. */
  onboarding?: boolean;
  onClose: () => void;
  /** Called after a successful save with the updated firm row. */
  onSaved: (firm: Firm) => void;
  /** First-run only: dismiss without configuring. */
  onSkip?: () => void;
}

const FONT_OPTIONS = Object.entries(FONT_STACKS).map(([value, v]) => ({
  value: value as keyof typeof FONT_STACKS,
  label: v.label,
}));

export default function StyleEditor({
  firm,
  onboarding,
  onClose,
  onSaved,
  onSkip,
}: Props) {
  const [draft, setDraft] = useState<FirmStyle>(
    firm.style ?? defaultFirmStyle()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI sample auto-detect state.
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [aiDisabled, setAiDisabled] = useState(false);
  const sampleInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  function set<K extends keyof FirmStyle>(k: K, v: FirmStyle[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function onLogoPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      set("logoUrl", await compressLogoFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that logo.");
    }
  }

  async function onSamplePick(file: File | undefined) {
    if (!file) return;
    setDetecting(true);
    setDetectMsg(null);
    setError(null);
    try {
      const dataUrl = await compressImageFile(file, 1600, 0.85);
      const result = await detectStyleFromSample(dataUrl);
      if (result.disabled) {
        setAiDisabled(true);
        setDetectMsg(
          "AI auto-detect isn't switched on yet — it activates once the AI add-on is enabled. You can still set everything by hand below."
        );
        return;
      }
      // Merge only the fields the AI actually returned, over the current draft.
      setDraft((d) => ({ ...d, ...result.style }));
      const hits = Object.keys(result.style).length;
      setDetectMsg(
        hits
          ? `Applied ${hits} detected setting${hits === 1 ? "" : "s"} — review and tweak below.`
          : result.warnings[0] || "Couldn't read a clear style from that sample."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't analyze that sample.");
    } finally {
      setDetecting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveFirmStyle(draft);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your style.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal style-modal">
        <header className="style-head">
          <div>
            <h2>{onboarding ? `Set up ${firm.name}'s tear sheet style` : "Tear sheet style"}</h2>
            <p className="muted small">
              {onboarding
                ? "An optional one-time setup so your exports look like your firm's. You can change this anytime."
                : "Controls how your printed / PDF tear sheets look. Applies to every project."}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="style-body">
          <div className="style-controls">
            {/* AI sample auto-detect (dormant until enabled) */}
            <section className="style-sample">
              <div className="style-sample-head">
                <strong>Start from an existing tear sheet</strong>
                {aiDisabled && <span className="badge">Coming soon</span>}
              </div>
              <p className="muted small">
                Upload a sample of a tear sheet you already use and we'll suggest a
                matching style. Optional — you can also just set things by hand.
              </p>
              <button
                className="btn"
                disabled={detecting}
                onClick={() => sampleInput.current?.click()}
              >
                {detecting ? "Analyzing…" : "Upload a sample…"}
              </button>
              <input
                ref={sampleInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onSamplePick(e.target.files?.[0])}
              />
              {detectMsg && <p className="style-detect-msg small">{detectMsg}</p>}
            </section>

            <hr className="style-sep" />

            <label className="style-field">
              <span>Firm logo</span>
              <div className="logo-row">
                {safeLogoUrl(draft.logoUrl) ? (
                  <img
                    className="logo-thumb"
                    src={safeLogoUrl(draft.logoUrl)}
                    alt="Logo"
                  />
                ) : (
                  <span className="logo-thumb empty">No logo</span>
                )}
                <button className="btn ghost small" onClick={() => logoInput.current?.click()}>
                  {draft.logoUrl ? "Replace" : "Upload"}
                </button>
                {draft.logoUrl && (
                  <button className="btn ghost small" onClick={() => set("logoUrl", "")}>
                    Remove
                  </button>
                )}
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => onLogoPick(e.target.files?.[0])}
                />
              </div>
            </label>

            <div className="style-grid">
              <label className="style-field">
                <span>Accent color</span>
                <input
                  type="color"
                  value={draft.accentColor}
                  onChange={(e) => set("accentColor", e.target.value)}
                />
              </label>
              <label className="style-field">
                <span>Text color</span>
                <input
                  type="color"
                  value={draft.textColor}
                  onChange={(e) => set("textColor", e.target.value)}
                />
              </label>
              <label className="style-field">
                <span>Font</span>
                <select
                  value={draft.font}
                  onChange={(e) => set("font", e.target.value as FirmStyle["font"])}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="style-field">
              <span>Layout</span>
              <div className="layout-choices">
                {TEAR_SHEET_LAYOUTS.map((l) => (
                  <button
                    key={l.value}
                    className={`layout-choice${draft.layout === l.value ? " active" : ""}`}
                    onClick={() => set("layout", l.value)}
                    type="button"
                  >
                    <strong>{l.label}</strong>
                    <span className="muted small">{l.hint}</span>
                  </button>
                ))}
              </div>
            </label>

            <fieldset className="style-toggles">
              <legend>Show on each item</legend>
              <label>
                <input
                  type="checkbox"
                  checked={draft.showPrice}
                  onChange={(e) => set("showPrice", e.target.checked)}
                />{" "}
                Prices
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.showSku}
                  onChange={(e) => set("showSku", e.target.checked)}
                />{" "}
                SKU / model
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.showDimensions}
                  onChange={(e) => set("showDimensions", e.target.checked)}
                />{" "}
                Dimensions
              </label>
            </fieldset>

            <div className="style-grid">
              <label className="style-field">
                <span>Cover title</span>
                <input
                  placeholder={firm.name}
                  value={draft.coverTitle}
                  onChange={(e) => set("coverTitle", e.target.value)}
                />
              </label>
              <label className="style-field">
                <span>Footer text</span>
                <input
                  placeholder={`${firm.name} Tear Sheets`}
                  value={draft.footerText}
                  onChange={(e) => set("footerText", e.target.value)}
                />
              </label>
            </div>
          </div>

          {/* Live preview */}
          <div className="style-preview-pane">
            <span className="muted small">Preview</span>
            <StylePreview style={draft} firmName={firm.name} />
          </div>
        </div>

        {error && <p className="status-err">{error}</p>}

        <div className="modal-actions">
          {onboarding ? (
            <button className="btn ghost" onClick={onSkip} disabled={saving}>
              Skip for now
            </button>
          ) : (
            <button
              className="btn ghost"
              onClick={() => setDraft(defaultFirmStyle())}
              disabled={saving}
            >
              Reset to default
            </button>
          )}
          <span className="spacer" />
          {!onboarding && (
            <button className="btn ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save style"}
          </button>
        </div>
      </div>
    </div>
  );
}
