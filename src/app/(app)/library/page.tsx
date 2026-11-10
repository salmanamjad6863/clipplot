"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { GameChip } from "@/components/game-chip";
import { FilterBar, applyFilters, type FormatFilter } from "@/components/filter-bar";
import { EmptyState, FormatBadge, PageHeader, Segmented, SkeletonGrid, StatusPill, ease } from "@/components/ui";
import { formatDuration, timeAgo } from "@/lib/format";
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
                <span className="w-24 text-right text-xs text-muted">
                  {timeAgo(c.publishedAt ?? c.scheduledFor ?? c.createdAt)}
                </span>
                {c.youtubeUrl ? (
                  <a href={c.youtubeUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-fg" aria-label="Open on YouTube">
                    <ExternalLink className="h-4 w-4" />
                  </a>
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
