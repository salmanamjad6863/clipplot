"use client";

import { useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Copy, ExternalLink, Info, Radar, Sparkles } from "lucide-react";
import { GameChip } from "@/components/game-chip";
import { EmptyState, PageHeader, Segmented, SkeletonGrid, ease } from "@/components/ui";
import { formatDuration, formatNumber, timeAgo } from "@/lib/format";
import { useRunDiscovery, useTrends } from "@/lib/queries";
import type { TrendStatus } from "@/lib/types";

const STATUS: Record<TrendStatus, { label: string; tone: string }> = {
  new: { label: "New", tone: "text-cyan bg-cyan/10" },
  used: { label: "Used", tone: "text-success bg-success/10" },
  duplicate: { label: "Duplicate", tone: "text-warning bg-warning/10" },
  below_threshold: { label: "Skipped", tone: "text-muted bg-white/5" },
};

type Filter = "all" | TrendStatus;

export default function TrendsPage() {
  const { data, isLoading } = useTrends();
  const discover = useRunDiscovery();
  const [filter, setFilter] = useState<Filter>("all");
  const trends = (data ?? []).filter((t) => filter === "all" || t.status === filter);
  const dupes = data?.filter((t) => t.status === "duplicate").length ?? 0;

  return (
    <>
      <PageHeader title="Trend" accent="radar">
        <button
          onClick={() => discover.mutate()}
          disabled={discover.isPending}
          className="inline-flex items-center gap-2 rounded-full bg-sunset px-4 py-2 text-sm font-medium text-bg transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-70"
        >
          <Radar className={clsx("h-4 w-4", discover.isPending && "animate-spin")} />
          {discover.isPending ? "Scanning YouTube…" : "Run discovery"}
        </button>
      </PageHeader>
      <p className="mt-2 text-sm text-muted">
        Viral videos from the last 48 h — GTA 6 first, then the fallback games. Duplicate protection skipped{" "}
        <span className="text-warning">{dupes}</span> repeat{dupes === 1 ? "" : "s"}.
      </p>

      <div className="mt-6">
        <Segmented
          id="trend-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "new", label: "New" },
            { value: "used", label: "Used" },
            { value: "duplicate", label: "Duplicates" },
            { value: "below_threshold", label: "Skipped" },
          ]}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <SkeletonGrid count={4} className="h-28" />
        ) : trends.length === 0 ? (
          <EmptyState
            title={filter === "all" ? "No trends yet" : "No trends in this view"}
            body={filter === "all" ? "Hit “Run discovery” to scan today's viral videos." : undefined}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {trends.map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.03, ease }}
                className={clsx("glass rounded-2xl p-4 transition-colors hover:bg-surface-hover", t.status === "duplicate" && "opacity-70")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS[t.status].tone)}>{STATUS[t.status].label}</span>
                  <GameChip slug={t.game} />
                  <span className="ml-auto font-mono text-xs text-muted">{formatDuration(t.durationSec)}</span>
                </div>
                <a href={t.url} target="_blank" rel="noreferrer" className="mt-3 flex items-start gap-2 text-sm font-medium hover:underline">
                  <span className="flex-1">{t.title}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                </a>
                <p className="mt-1 text-xs text-muted">
                  {t.channel} · {formatNumber(t.views)} views ·{" "}
                  <span className="text-coral">{formatNumber(t.viewsPerHour)}/h</span> · {timeAgo(t.publishedAt)}
                </p>
                {t.duplicateReason && (
                  <p
                    className={clsx(
                      "mt-2 inline-flex items-center gap-1.5 text-xs",
                      t.status === "duplicate" ? "text-warning" : "text-muted",
                    )}
                  >
                    {t.status === "duplicate" ? <Copy className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
                    {t.duplicateReason}
                  </p>
                )}
                {t.status === "new" && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet">
                    <Sparkles className="h-3.5 w-3.5" /> Will be scripted on the next run
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
