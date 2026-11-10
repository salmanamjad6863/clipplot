"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { Clapperboard, Smartphone } from "lucide-react";
import { FORMAT_META, STATUS_META, type ClipStatus, type VideoFormat } from "@/lib/types";

export const ease = [0.22, 1, 0.36, 1] as const;

export function PageHeader({ title, accent, children }: { title: string; accent?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
        className="font-display text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        {title} {accent && <span className="text-sunset">{accent}</span>}
      </motion.h1>
      {children}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: ClipStatus }) {
  const m = STATUS_META[status];
  return <span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium", m.tone)}>{m.label}</span>;
}

export function FormatBadge({ format }: { format: VideoFormat }) {
  const Icon = format === "short" ? Smartphone : Clapperboard;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-fg/80">
      <Icon className="h-3 w-3" />
      {FORMAT_META[format].label}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
        checked ? "bg-sunset" : "bg-white/10",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={clsx("absolute top-1 h-4 w-4 rounded-full bg-white shadow", checked ? "right-1" : "left-1")}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  id,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  /** unique id so the sliding highlight animates within this control only */
  id: string;
}) {
  return (
    <div className="glass inline-flex rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative rounded-full px-3 py-1.5 text-xs transition-colors",
            value === o.value ? "text-bg" : "text-muted hover:text-fg",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              transition={{ type: "spring", stiffness: 400, damping: 34 }}
              className="absolute inset-0 rounded-full bg-sunset"
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="glass rounded-2xl px-6 py-10 text-center">
      <p className="font-display text-base font-semibold">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

export function SkeletonGrid({ count = 2, className = "h-44" }: { count?: number; className?: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }, (_, k) => (
        <div key={k} className={clsx("skeleton rounded-2xl", className)} />
      ))}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-border bg-white/[0.03] px-3 py-2 text-sm text-fg outline-none transition placeholder:text-muted/60 focus:border-coral/60 focus:bg-white/[0.05]";
