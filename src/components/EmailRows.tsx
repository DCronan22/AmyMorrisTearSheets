import { useEffect, useRef } from "react";
import { looksLikeEmail } from "../lib/emails";

const BAD = "Check this address";

/**
 * One input per email, with "+ Add another" below. Enter in a row adds a new
 * row; pasting a list into a row splits it into rows. `lockedEmail` is shown
 * first as a read-only row (e.g. the person filling in the form).
 */
export default function EmailRows({
  rows,
  onChange,
  lockedEmail,
  lockedNote = "you",
  addLabel = "+ Add another person",
  ariaLabel = "Email address",
}: {
  rows: string[];
  onChange: (rows: string[]) => void;
  lockedEmail?: string;
  lockedNote?: string;
  addLabel?: string;
  ariaLabel?: string;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  // Focus a row that was just added (after it renders).
  useEffect(() => {
    if (focusIndex.current == null) return;
    inputs.current[focusIndex.current]?.focus();
    focusIndex.current = null;
  });

  const locked = lockedEmail?.trim().toLowerCase();
  const seen = new Map<string, number>();
  const problem = rows.map((r, i) => {
    const v = r.trim().toLowerCase();
    if (!v) return null;
    if (!looksLikeEmail(v)) return BAD;
    if (v === locked) return "That's you, already included";
    if (seen.has(v)) return "Already listed";
    seen.set(v, i);
    return null;
  });

  function set(i: number, value: string) {
    // A pasted list (commas, spaces, new lines) becomes one row each.
    const parts = value.split(/[\s,;]+/).filter(Boolean);
    if (parts.length > 1) {
      const next = [...rows.slice(0, i), ...parts, ...rows.slice(i + 1)];
      focusIndex.current = i + parts.length - 1;
      onChange(next);
      return;
    }
    onChange(rows.map((r, j) => (j === i ? value : r)));
  }

  function add(at = rows.length) {
    focusIndex.current = at;
    onChange([...rows.slice(0, at), "", ...rows.slice(at)]);
  }

  function remove(i: number) {
    const next = rows.filter((_, j) => j !== i);
    focusIndex.current = Math.max(0, Math.min(i, next.length - 1));
    onChange(next.length ? next : [""]);
  }

  return (
    <div className="email-rows">
      {locked && (
        <div className="email-row is-locked">
          <input value={locked} readOnly tabIndex={-1} aria-label={`${ariaLabel} (${lockedNote})`} />
          <span className="email-row-note">{lockedNote}</span>
        </div>
      )}
      {rows.map((r, i) => (
        <div className={`email-row${problem[i] === BAD ? " has-problem" : ""}`} key={i}>
          <input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="name@yourfirm.com"
            aria-label={`${ariaLabel} ${i + 1}`}
            aria-invalid={problem[i] === BAD ? true : undefined}
            value={r}
            onChange={(e) => set(i, e.target.value)}
            onPaste={(e) => {
              // Inputs drop line breaks from pasted text, so split a pasted
              // list here, before the browser flattens it.
              const text = e.clipboardData.getData("text");
              if (text.split(/[\s,;]+/).filter(Boolean).length < 2) return;
              e.preventDefault();
              set(i, `${r.trim()} ${text}`);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(i + 1);
              } else if (e.key === "Backspace" && !r && rows.length > 1) {
                e.preventDefault();
                remove(i);
              }
            }}
          />
          <button
            type="button"
            className="email-row-remove"
            aria-label={`Remove ${r || "this row"}`}
            title="Remove"
            onClick={() => remove(i)}
          >
            ×
          </button>
          {problem[i] && <span className="email-row-problem">{problem[i]}</span>}
        </div>
      ))}
      <button type="button" className="email-rows-add" onClick={() => add()}>
        {addLabel}
      </button>
    </div>
  );
}

