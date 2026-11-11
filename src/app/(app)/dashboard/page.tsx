"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Flame, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { GameChip } from "@/components/game-chip";
import { ReviewCard } from "@/components/clip-card";
import { FilterBar, applyFilters, type FormatFilter } from "@/components/filter-bar";
import { EmptyState, FormatBadge, PageHeader, Section, SkeletonGrid, StatusPill, ease } from "@/components/ui";
import { formatDuration, formatNumber } from "@/lib/format";
import { useClips } from "@/lib/queries";
import type { Clip } from "@/lib/types";

const IN_PIPELINE = ["discovered", "scripting", "rendering"];

export default function Dashboard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useClips();
  const [game, setGame] = useState("all");
  const [format, setFormat] = useState<FormatFilter>("all");

  const all = data ?? [];
  const filtered = applyFilters(all, game, format);
  const review = filtered.filter((c) => c.status === "awaiting_approval");
  const pipeline = filtered.filter((c) => [...IN_PIPELINE, "scheduled", "failed"].includes(c.status));

  const { week, weekViews, best, avgPct } = lastWeek(all);

  const stats = [
    { label: "Needs review", value: all.filter((c) => c.status === "awaiting_approval").length, accent: true },
    { label: "In pipeline", value: all.filter((c) => IN_PIPELINE.includes(c.status)).length },
    { label: "Scheduled", value: all.filter((c) => c.status === "scheduled").length },
    { label: "Published", value: all.filter((c) => c.status === "published").length },
  ];

  return (
    <>
      <PageHeader title="Today's" accent="drops">
        <button
          onClick={() => refetch()}
          className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-fg/90 transition hover:bg-surface-hover"
        >
          <RefreshCw className={clsx("h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </button>
      </PageHeader>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 * i, ease }}
            className="glass relative overflow-hidden rounded-2xl p-4"
          >
            {s.accent && s.value > 0 && <span className="absolute inset-x-0 top-0 h-px bg-sunset" />}
            <p className="text-xs text-muted">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold">{isLoading ? "–" : s.value}</p>
          </motion.div>
        ))}
      </div>

      {week.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease }}
          className="glass mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl px-4 py-3 text-sm"
        >
          <span className="text-xs uppercase tracking-wider text-muted">Last 7 days</span>
          <span>
            <b className="font-display text-lg">{formatNumber(weekViews)}</b> <span className="text-muted">views</span>
          </span>
          {avgPct !== null && (
            <span>
              <b className="font-display text-lg">{Math.round(avgPct)}%</b> <span className="text-muted">avg watched</span>
            </span>
          )}
          {best && (
            <Link href={`/review/${best.id}`} className="min-w-0 flex-1 truncate text-muted hover:text-fg">
              Top: <span className="text-fg">{best.title}</span> · {formatNumber(best.views ?? 0)} views
            </Link>
          )}
        </motion.div>
      )}

      <div className="mt-8">
        <FilterBar id="dash" game={game} onGame={setGame} format={format} onFormat={setFormat} />
      </div>

      {isError && (
        <p className="glass mt-8 rounded-2xl border-danger/30 px-4 py-3 text-sm text-danger">
          Couldn&apos;t load clips — {error.message}
        </p>
      )}

      <Section
        title="Ready for your review"
        action={
          review.length > 0 && (
            <Link href="/review" className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-fg">
              Open queue <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )
        }
      >
        {isLoading ? (
          <SkeletonGrid />
        ) : review.length === 0 ? (
          <EmptyState title="Nothing waiting" body="New drafts land here every morning." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {review.slice(0, 4).map((c, i) => (
                <ReviewCard key={c.id} clip={c} i={i} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </Section>

      <Section title="Pipeline">
        {isLoading ? (
          <SkeletonGrid count={1} className="h-40 md:col-span-2" />
        ) : pipeline.length === 0 ? (
          <EmptyState title="Pipeline is clear" />
        ) : (
          <ul className="glass divide-y divide-border overflow-hidden rounded-2xl">
            <AnimatePresence initial={false}>
              {pipeline.map((c, i) => (
                <motion.li
                  key={c.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.45, delay: i * 0.03, ease }}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover"
                >
                  <StatusPill status={c.status} />
                  <Link href={`/review/${c.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline" title={c.error ?? c.title}>
                    {c.title}
                    {c.status === "failed" && c.error && <span className="ml-2 text-xs text-danger">· {c.error}</span>}
                  </Link>
                  <span className="hidden md:inline-flex">
                    <GameChip slug={c.game} fallback={c.isFallback} />
                  </span>
                  <span className="hidden sm:inline-flex">
                    <FormatBadge format={c.format} />
                  </span>
                  <span className="hidden w-10 text-right font-mono text-xs text-muted sm:inline">{formatDuration(c.durationSec)}</span>
                  <span className="flex w-10 items-center justify-end gap-1 font-mono text-xs text-muted">
                    <Flame className="h-3.5 w-3.5 text-coral" />
                    {c.viralScore}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Section>
    </>
  );
}

/** Published in the last 7 days with stats. Clips only exist client-side (after hydration), so reading the clock here is safe. */
function lastWeek(all: Clip[]) {
  if (all.length === 0) return { week: [] as Clip[], weekViews: 0, best: undefined, avgPct: null };
  const now = Date.now();
  const week = all.filter((c) => c.status === "published" && c.publishedAt && now - Date.parse(c.publishedAt) < 7 * 86_400_000 && c.views !== undefined);
  const withPct = week.filter((c) => c.avgViewPct !== undefined);
  return {
    week,
    weekViews: week.reduce((n, c) => n + (c.views ?? 0), 0),
    best: [...week].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0],
    avgPct: withPct.length ? withPct.reduce((n, c) => n + c.avgViewPct!, 0) / withPct.length : null,
  };
}
