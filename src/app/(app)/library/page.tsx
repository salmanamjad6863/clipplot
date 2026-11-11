"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { ExternalLink, Eye, Loader2, MessageCircle, ThumbsUp } from "lucide-react";
import clsx from "clsx";
import { GameChip } from "@/components/game-chip";
import { FilterBar, applyFilters, type FormatFilter } from "@/components/filter-bar";
import { EmptyState, FormatBadge, PageHeader, Segmented, SkeletonGrid, StatusPill, ease } from "@/components/ui";
import { formatDuration, formatNumber, timeAgo } from "@/lib/format";
import type { Clip } from "@/lib/types";
import { useClips } from "@/lib/queries";

type Tab = "published" | "scheduled" | "rejected";

export default function LibraryPage() {
  const { data, isLoading } = useClips();
  const [game, setGame] = useState("all");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [tab, setTab] = useState<Tab>("published");

  const rows = applyFilters(data ?? [], game, format).filter((c) => c.status === tab);

  return (
    <>
      <PageHeader title="Library" />
      <p className="mt-2 text-sm text-muted">Every video ClipPilot has made — links and metadata only.</p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Segmented
          id="lib-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: "published", label: "Published" },
            { value: "scheduled", label: "Scheduled" },
            { value: "rejected", label: "Skipped" },
          ]}
        />
        <FilterBar id="lib" game={game} onGame={setGame} format={format} onFormat={setFormat} />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <SkeletonGrid count={1} className="h-48 md:col-span-2" />
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing here yet" />
        ) : (
          <div className="glass overflow-hidden rounded-2xl">
            {rows.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.03, ease }}
                className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5 last:border-0 hover:bg-surface-hover"
              >
                <StatusPill status={c.status} />
                <Link href={`/review/${c.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {c.title}
                </Link>
                <GameChip slug={c.game} fallback={c.isFallback} />
                <FormatBadge format={c.format} />
                <span className="w-10 text-right font-mono text-xs text-muted">{formatDuration(c.durationSec)}</span>
                {c.status === "published" && <Perf clip={c} />}
                <span className="w-24 text-right text-xs text-muted">
                  {timeAgo(c.publishedAt ?? c.scheduledFor ?? c.createdAt)}
                </span>
                {c.youtubeUrl ? (
                  <a
                    href={c.youtubeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-fg/90 hover:bg-white/15"
                  >
                    Watch <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : c.uploadState ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-violet">
                    <Loader2 className={`h-3.5 w-3.5 ${c.uploadState === "uploading" ? "animate-spin" : ""}`} />
                    {c.uploadState === "uploading" ? "Uploading…" : "Waiting for worker"}
                  </span>
                ) : (
                  <span className="w-4" />
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Views · likes · comments · % watched (refreshed every 6h; % watched needs the Analytics permission) */
function Perf({ clip }: { clip: Clip }) {
  if (clip.views === undefined) {
    return <span className="w-44 text-right text-[11px] text-muted">stats soon</span>;
  }
  return (
    <span className="flex w-44 items-center justify-end gap-2.5 font-mono text-[11px] text-muted" title={clip.statsAt ? `Updated ${timeAgo(clip.statsAt)}` : undefined}>
      <span className="inline-flex items-center gap-1 text-fg/90">
        <Eye className="h-3 w-3" /> {formatNumber(clip.views)}
      </span>
      <span className="inline-flex items-center gap-1">
        <ThumbsUp className="h-3 w-3" /> {formatNumber(clip.likes ?? 0)}
      </span>
      <span className="inline-flex items-center gap-1">
        <MessageCircle className="h-3 w-3" /> {formatNumber(clip.comments ?? 0)}
      </span>
      {clip.avgViewPct !== undefined && (
        <span className={clsx(clip.avgViewPct >= 70 ? "text-success" : clip.avgViewPct >= 45 ? "text-amber" : "text-danger")}>
          {Math.round(clip.avgViewPct)}%
        </span>
      )}
    </span>
  );
}
