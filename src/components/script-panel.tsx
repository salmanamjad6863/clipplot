"use client";

import { motion } from "motion/react";
import clsx from "clsx";
import { AlertTriangle, Clapperboard, Lightbulb, RefreshCw, ShieldAlert, Type } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { useRegenerateScript } from "@/lib/queries";
import type { Clip } from "@/lib/types";
import { ease } from "./ui";

const LOCKED = ["scheduled", "published"];

export function ScriptPanel({ clip }: { clip: Clip }) {
  const regen = useRegenerateScript();
  const busy = clip.status === "scripting" || regen.isPending;
  const s = clip.script;
  const words = s?.segments.reduce((n, seg) => n + seg.voiceover.split(/\s+/).filter(Boolean).length, 0) ?? 0;

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Script</h3>
        {!LOCKED.includes(clip.status) && (
          <button
            onClick={() => regen.mutate(clip.id)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-fg/90 transition hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", busy && "animate-spin")} />
            {busy ? "Claude is writing…" : s ? "Regenerate" : "Write script"}
          </button>
        )}
      </div>

      {clip.error && clip.status === "failed" && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {clip.error}
        </p>
      )}

      {busy && !s && <div className="skeleton mt-3 h-48 rounded-2xl" />}

      {!s && !busy && !clip.error && (
        <p className="mt-3 text-sm text-muted">No script yet — Claude writes one right after discovery.</p>
      )}

      {s && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: busy ? 0.5 : 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="mt-3 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="glass rounded-xl p-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted">
                <Lightbulb className="h-3.5 w-3.5 text-amber" /> Our angle
              </p>
              <p className="mt-1 text-sm">{s.angle}</p>
            </div>
            <div className="glass rounded-xl p-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted">
                <Type className="h-3.5 w-3.5 text-violet" /> Cover text
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-sunset">{s.thumbnailText}</p>
            </div>
          </div>

          <ol className="glass divide-y divide-border overflow-hidden rounded-2xl">
            {s.segments.map((seg, i) => (
              <li key={i} className="grid grid-cols-[3rem_1fr] gap-3 px-4 py-3">
                <span className="pt-0.5 font-mono text-xs text-coral">{formatDuration(seg.startSec)}</span>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm leading-relaxed">{seg.voiceover}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {seg.onScreenText && (
                      <span className="inline-flex items-center gap-1">
                        <Type className="h-3 w-3" /> “{seg.onScreenText}”
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clapperboard className="h-3 w-3" /> {seg.visual}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-muted">
            <span>
              {s.segments.length} beats · {words} words · ~{formatDuration(words / 2.5)} spoken
            </span>
            <span>
              {s.model} · {new Date(s.generatedAt).toLocaleString()}
            </span>
          </div>

          {s.riskNotes && (
            <p
              className={clsx(
                "flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs",
                clip.riskScore >= 40 ? "border border-warning/30 bg-warning/5 text-warning" : "bg-white/[0.03] text-muted",
              )}
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>Risk {clip.riskScore}/100.</b> {s.riskNotes}
              </span>
            </p>
          )}
        </motion.div>
      )}
    </section>
  );
}
