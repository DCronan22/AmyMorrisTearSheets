import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  /** Heading for the dialog. */
  title?: string;
  /** The body text / question. */
  message: ReactNode;
  /** Label for the confirming action (default "Confirm"). */
  confirmLabel?: string;
  /** Label for the cancel action (default "Cancel"). */
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

/**
 * App-wide confirmation dialog. Exposes `useConfirm()` returning a function that
 * pops a styled modal and resolves to true/false — a drop-in async replacement
 * for window.confirm used for every destructive action (deletes) and sign-out.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  // The awaiting promise's resolver, kept in a ref so resolution stays outside
  // the state updater (which StrictMode double-invokes in development).
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // Replace any in-flight prompt, resolving the old one as cancelled so its
      // awaiter never hangs (shouldn't happen in practice — the modal blocks UI).
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setPending(opts);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(ok);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          options={pending}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop confirm-backdrop" onClick={onCancel}>
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="confirm-title">
          {options.title ?? "Are you sure?"}
        </h2>
        <div className="confirm-body">{options.message}</div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            className={`btn ${options.danger ? "danger-solid" : "primary"}`}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
