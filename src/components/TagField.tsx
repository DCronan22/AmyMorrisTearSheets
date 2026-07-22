import { useEffect, useRef, useState } from "react";
import { joinTags, parseTags } from "../lib/tags";

interface Props {
  label: string;
  /** The stored comma-separated value. */
  value: string;
  onChange: (value: string) => void;
  /** Existing values across the catalog, offered in the dropdown. */
  options: string[];
  placeholder?: string;
  /** Span the full width of the form grid. */
  full?: boolean;
}

/**
 * A multi-value ("chips") text field with a dropdown of existing values. Used
 * for vendor and category, which can each hold more than one value. Typing +
 * Enter (or comma) adds a new tag; the ▾ dropdown lists values already used
 * elsewhere so entries stay consistent. The value is stored/emitted as a plain
 * comma-separated string, so every other consumer is unaffected.
 */
export default function TagField({
  label,
  value,
  onChange,
  options,
  placeholder,
  full,
}: Props) {
  const tags = parseTags(value);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());

  function addTag(raw: string) {
    const t = raw.trim();
    if (t && !has(t)) onChange(joinTags([...tags, t]));
    setText("");
  }
  function removeTag(t: string) {
    onChange(joinTags(tags.filter((x) => x.toLowerCase() !== t.toLowerCase())));
  }

  // Close the dropdown when clicking outside the field.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Existing values not already chosen, narrowed by whatever's typed.
  const q = text.trim().toLowerCase();
  const available = options.filter(
    (o) => !has(o) && (!q || o.toLowerCase().includes(q))
  );
  // Offer to create the typed value when it isn't an existing option.
  const canCreate = Boolean(q) && !options.some((o) => o.toLowerCase() === q) && !has(text);

  return (
    <div className={`tag-field${full ? " full" : ""}`} ref={wrapRef}>
      <span>{label}</span>
      <div className="tag-box" onClick={() => inputRef.current?.focus()}>
        {tags.map((t) => (
          <span className="tag-chip" key={t}>
            {t}
            <button
              type="button"
              className="tag-x"
              aria-label={`Remove ${t}`}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(t);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-input"
          value={text}
          placeholder={tags.length ? "" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(text);
            } else if (e.key === "Backspace" && !text && tags.length) {
              removeTag(tags[tags.length - 1]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="tag-toggle"
          aria-label="Show existing values"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
        >
          ▾
        </button>
      </div>
      {open && (canCreate || available.length > 0) && (
        <ul className="tag-menu">
          {canCreate && (
            <li>
              <button type="button" onClick={() => addTag(text)}>
                <span className="tag-create">＋ Add “{text.trim()}”</span>
              </button>
            </li>
          )}
          {available.map((o) => (
            <li key={o}>
              <button
                type="button"
                onClick={() => {
                  addTag(o);
                  inputRef.current?.focus();
                }}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
