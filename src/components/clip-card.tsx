"use client";

import Link from "next/link";
import { motion } from "motion/react";
import clsx from "clsx";
import { Check, Flame, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { GameChip } from "./game-chip";
import { FormatBadge, StatusPill, ease } from "./ui";
import { formatDuration } from "@/lib/format";
import { useUpdateClip } from "@/lib/queries";
import { FORMAT_META, type Clip } from "@/lib/types";

export function Thumb({ clip, className }: { clip: Clip; className?: string }) {
  return (
    <div
      className={clsx(
        "relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet/40 via-coral/30 to-amber/30",
        FORMAT_META[clip.format].aspect,
        className,
      )}
    >
      {clip.renderUrl ? (
        // first frame of the rendered preview as the thumbnail (metadata-only load)
        <video
          src={`${clip.renderUrl}#t=1`}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.18),transparent_55%)]" />
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px]">
        {formatDuration(clip.durationSec)}
      </span>
    </div>
  );
}

export function ApproveSkip({ clip, size = "sm" }: { clip: Clip; size?: "sm" | "md" }) {
  const update = useUpdateClip();
  const pad = size === "md" ? "px-5 py-2 text-sm" : "px-4 py-1.5 text-xs";

  const act = (status: "scheduled" | "rejected") => {
    update.mutate({ id: clip.id, patch: { status } });
    toast(status === "scheduled" ? "Approved — queued for upload" : "Skipped", {
      description: clip.title,
      action: {
        label: "Undo",
        onClick: () => update.mutate({ id: clip.id, patch: { status: "awaiting_approval" } }),
      },
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => act("scheduled")}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full bg-sunset font-medium text-bg transition-transform hover:scale-105 active:scale-95",
          pad,
        )}
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      <button
        onClick={() => act("rejected")}
        className={clsx("inline-flex items-center gap-1.5 rounded-full bg-white/5 text-muted transition hover:bg-white/10 hover:text-fg", pad)}
      >
        <X className="h-3.5 w-3.5" /> Skip
      </button>
    </div>
  );
}

export function ReviewCard({ clip, i }: { clip: Clip; i: number }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }}
      transition={{ duration: 0.55, delay: i * 0.06, ease }}
      className="glass group flex min-w-0 gap-3 rounded-2xl p-4 transition-colors hover:bg-surface-hover sm:gap-4"
    >
      <Link href={`/review/${clip.id}`} className={clip.format === "short" ? "w-20 shrink-0 sm:w-24" : "w-28 shrink-0 self-start sm:w-36"}>
        <Thumb clip={clip} className="w-full transition-transform duration-500 group-hover:scale-[1.03]" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={clip.status} />
          <FormatBadge format={clip.format} />
          <span className="ml-auto flex items-center gap-1 font-mono text-xs text-muted">
            <Flame className="h-3.5 w-3.5 text-coral" />
            {clip.viralScore}
          </span>
        </div>
        <div className="mt-2.5">
          <GameChip slug={clip.game} fallback={clip.isFallback} />
        </div>
        <Link href={`/review/${clip.id}`} className="mt-2 font-display text-base font-semibold leading-snug hover:underline">
          {clip.title}
        </Link>
        <p className="mt-1 line-clamp-2 text-sm text-muted">“{clip.hook}”</p>
        {clip.riskScore >= 20 && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-warning">
            <ShieldAlert className="h-3.5 w-3.5" /> Policy risk {clip.riskScore}/100 — check before approving
          </p>
        )}
        <div className="mt-auto pt-4">
          <ApproveSkip clip={clip} />
        </div>
      </div>
    </motion.article>
  );
}
