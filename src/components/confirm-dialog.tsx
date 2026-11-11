"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ease } from "./ui";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen — shown above the buttons */
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger = red confirm button (skip/disconnect), primary = sunset gradient (approve) */
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible modal confirm: Esc / backdrop click cancels, focus starts on Cancel (the safe choice). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  // portals only after hydration (the server has no document.body)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onCancel}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.3, ease }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border bg-bg-elev/95 p-6 shadow-2xl backdrop-blur-xl"
          >
            <h2 id={titleId} className="font-display text-lg font-semibold">
              {title}
            </h2>
            {children && <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={onCancel}
                className="rounded-full px-4 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className={clsx(
                  "rounded-full px-5 py-2 text-sm font-medium transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-60",
                  tone === "danger" ? "bg-danger text-bg" : "bg-sunset text-bg",
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
