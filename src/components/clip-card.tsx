"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Check, Flame, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "./confirm-dialog";
import { GameChip } from "./game-chip";
import { FormatBadge, Segmented, StatusPill, ease } from "./ui";
import { formatDuration } from "@/lib/format";
import { useSettings, useTopicMap, useUpdateClip } from "@/lib/queries";
import { FORMAT_META, type Clip, type Privacy } from "@/lib/types";

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
  const { data: settings } = useSettings();
  const [confirm, setConfirm] = useState<"scheduled" | "rejected" | null>(null);
  const topic = useTopicMap()[clip.game];
  const [picked, setPrivacy] = useState<Privacy | null>(null);
  const privacy: Privacy = picked ?? clip.privacy ?? settings?.youtubePrivacy ?? "private";
  const pad = size === "md" ? "px-5 py-2 text-sm" : "px-4 py-1.5 text-xs";
  const close = useCallback(() => setConfirm(null), []);

  const act = (status: "scheduled" | "rejected") => {
    setConfirm(null);
    update.mutate({ id: clip.id, patch: status === "scheduled" ? { status, privacy } : { status } });
    toast(status === "scheduled" ? "Approved" : "Skipped", {
      description: clip.title,
      action: {
        label: "Undo",
        onClick: () => update.mutate({ id: clip.id, patch: { status: "awaiting_approval" } }),
      },
    });
  };

  // spell out exactly what Approve will do with the current settings
  const approveWhat = !settings?.youtubeConnected
    ? "YouTube isn't connected yet — it uploads as soon as you connect your channel in Settings."
    : settings.autopilot
      ? `It waits for the daily upload slot (${settings.uploadTime} UTC), then uploads as ${privacy}.`
      : `It uploads to YouTube right away as ${privacy}.`;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setConfirm("scheduled")}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full bg-sunset font-medium text-bg transition-transform hover:scale-105 active:scale-95",
          pad,
        )}
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      <button
        onClick={() => setConfirm("rejected")}
        className={clsx("inline-flex items-center gap-1.5 rounded-full bg-white/5 text-muted transition hover:bg-white/10 hover:text-fg", pad)}
      >
        <X className="h-3.5 w-3.5" /> Skip
      </button>

      <ConfirmDialog
        open={confirm === "scheduled"}
        title="Approve this video?"
        confirmLabel="Approve & publish"
        onConfirm={() => act("scheduled")}
        onCancel={close}
      >
        <p className="font-medium text-fg">“{clip.title}”</p>
        <p>
          {FORMAT_META[clip.format].label} · {formatDuration(clip.durationSec)} ·{" "}
          {clip.format === "short" ? (topic?.playlistTitle ?? clip.game) : `${topic?.name ?? clip.game} — Full Videos`} playlist
        </p>
        <div>
          <p className="mb-1.5 text-xs">Visibility for this video</p>
          <Segmented
            id={`privacy-${clip.id}`}
            value={privacy}
            onChange={setPrivacy}
            options={[
              { value: "private", label: "Private" },
              { value: "unlisted", label: "Unlisted" },
              { value: "public", label: "Public" },
            ]}
          />
        </div>
        <p>{approveWhat}</p>
        {privacy !== "private" && (
          <p className="text-[11px]">If your Google project hasn&apos;t passed YouTube&apos;s API audit yet, YouTube still forces Private.</p>
        )}
        {clip.riskScore >= 40 && (
          <p className="flex items-start gap-1.5 text-warning">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Policy risk {clip.riskScore}/100 — check the script notes first.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "rejected"}
        title="Skip this video?"
        confirmLabel="Skip it"
        tone="danger"
        onConfirm={() => act("rejected")}
        onCancel={close}
      >
        <p className="font-medium text-fg">“{clip.title}”</p>
        <p>It won&apos;t be uploaded. You can still find it in Library → Skipped, and its trend won&apos;t be picked again.</p>
      </ConfirmDialog>
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
