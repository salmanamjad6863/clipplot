"use client";

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Clapperboard, Copy, ExternalLink, Info, Link2, Plus, Radar, Search, Smartphone } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GameChip } from "@/components/game-chip";
import { EmptyState, PageHeader, Segmented, SkeletonGrid, ease, inputCls } from "@/components/ui";
import { extractVideoId } from "@/lib/dedupe";
import { formatDuration, formatNumber, timeAgo } from "@/lib/format";
import { useClipFromTrend, useLookup, useRunDiscovery, useSettings, useTopics, useTrends } from "@/lib/queries";
import type { Trend, TrendStatus } from "@/lib/types";

const STATUS: Record<TrendStatus, { label: string; tone: string }> = {
  new: { label: "New", tone: "text-cyan bg-cyan/10" },
  used: { label: "Used", tone: "text-success bg-success/10" },
  duplicate: { label: "Duplicate", tone: "text-warning bg-warning/10" },
  below_threshold: { label: "Skipped", tone: "text-muted bg-white/5" },
};

type Filter = "all" | TrendStatus;
type Pending = { kind: "discover" } | { kind: "more" } | { kind: "clip"; trend: Trend; format: "short" | "long" } | null;

export default function TrendsPage() {
  const { data, isLoading } = useTrends();
  const { data: settings } = useSettings();
  const discover = useRunDiscovery();
  const makeClip = useClipFromTrend();
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<Pending>(null);
  const close = useCallback(() => setPending(null), []);

  const trends = (data ?? []).filter((t) => filter === "all" || t.status === filter);
  const dupes = data?.filter((t) => t.status === "duplicate").length ?? 0;
  const games = settings?.games.filter((g) => g.enabled).length ?? 1;

  return (
    <>
      <PageHeader title="Trend" accent="radar">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPending({ kind: "more" })}
            disabled={discover.isPending}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-fg/90 transition hover:bg-white/5 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Find more now
          </button>
          <button
            onClick={() => setPending({ kind: "discover" })}
            disabled={discover.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-sunset px-4 py-2 text-sm font-medium text-bg transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-70"
          >
            <Radar className={clsx("h-4 w-4", discover.isPending && "animate-spin")} />
            {discover.isPending ? "Scanning YouTube…" : "Run discovery"}
          </button>
        </div>
      </PageHeader>
      <p className="mt-2 text-sm text-muted">
        Ranked by speed (views/hour) <b className="text-fg/80">and</b> breakout (views far above the uploader&apos;s channel
        size — a hot topic, not just a big channel). Duplicate protection skipped{" "}
        <span className="text-warning">{dupes}</span> repeat{dupes === 1 ? "" : "s"}.
      </p>

      <LookupBar />

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
            body={filter === "all" ? "Hit “Run discovery”, or search a topic above." : undefined}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {trends.map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: Math.min(i, 12) * 0.03, ease }}
                className={clsx("glass flex flex-col rounded-2xl p-4 transition-colors hover:bg-surface-hover", t.status === "duplicate" && "opacity-70")}
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
                  {t.channel} · {formatNumber(t.views)} views · <span className="text-coral">{formatNumber(t.viewsPerHour)}/h</span> ·{" "}
                  {timeAgo(t.publishedAt)}
                </p>
                {t.duplicateReason && (
                  <p className={clsx("mt-2 inline-flex items-center gap-1.5 text-xs", t.status === "duplicate" ? "text-warning" : "text-muted")}>
                    {t.status === "duplicate" ? <Copy className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
                    {t.duplicateReason}
                  </p>
                )}
                {t.status !== "used" && (
                  <div className="mt-auto flex gap-2 pt-3">
                    <button
                      onClick={() => setPending({ kind: "clip", trend: t, format: "short" })}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-fg/90 transition hover:bg-white/10"
                    >
                      <Smartphone className="h-3.5 w-3.5" /> Make Short
                    </button>
                    <button
                      onClick={() => setPending({ kind: "clip", trend: t, format: "long" })}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted transition hover:bg-white/5 hover:text-fg"
                    >
                      <Clapperboard className="h-3.5 w-3.5" /> Full video
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* confirmations — every action that spends YouTube quota or Claude calls */}
      <ConfirmDialog
        open={pending?.kind === "discover"}
        title="Run discovery now?"
        confirmLabel="Scan YouTube"
        onConfirm={() => {
          close();
          discover.mutate({});
        }}
        onCancel={close}
      >
        <p>Scans today&apos;s trends (GTA 6 first, then fallbacks). Uses ~{102 * Math.min(games, settings?.maxFallbackDepth ?? 4)} quota units at most.</p>
        <p>Only makes new Shorts if today&apos;s count ({settings?.formats.short.perDay ?? 1}/day) isn&apos;t reached yet.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === "more"}
        title="Find one more Short now?"
        confirmLabel="Find more"
        onConfirm={() => {
          close();
          discover.mutate({ extra: true });
        }}
        onCancel={close}
      >
        <p>Scans YouTube again and makes 1 extra Short from the best fresh trend, even if today&apos;s count is reached.</p>
        <p>Costs ~102+ quota units and one Claude script.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === "clip"}
        title={pending?.kind === "clip" ? `Make a ${pending.format === "short" ? "Short" : "full video"} from this?` : ""}
        confirmLabel={makeClip.isPending ? "Creating…" : "Make clip"}
        busy={makeClip.isPending}
        onConfirm={() => {
          if (pending?.kind !== "clip") return;
          makeClip.mutate({ trendId: pending.trend.id, format: pending.format }, { onSettled: close });
        }}
        onCancel={close}
      >
        {pending?.kind === "clip" && (
          <>
            <p className="font-medium text-fg">“{pending.trend.title}”</p>
            <p>Claude writes an original script inspired by it (one call), then the worker renders it for your review.</p>
            {pending.trend.status === "duplicate" && <p className="text-warning">Heads-up: this looks like a story you already covered.</p>}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

/** Search any topic from the last 7 days, or paste a YouTube link — results join the radar. */
function LookupBar() {
  const lookup = useLookup();
  const topics = useTopics().filter((t) => t.enabled);
  const [text, setText] = useState("");
  const [picked, setGame] = useState<string | null>(null);
  const game = picked ?? topics[0]?.slug ?? "gta-6";
  const isLink = Boolean(extractVideoId(text.trim())) && /youtu|^[A-Za-z0-9_-]{11}$/.test(text.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    lookup.mutate(isLink ? { url: v, game } : { query: v, game }, { onSuccess: () => setText("") });
  };

  return (
    <form onSubmit={submit} className="glass mt-6 flex flex-wrap items-center gap-2 rounded-2xl p-2">
      <div className="relative min-w-56 flex-1">
        {isLink ? (
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coral" />
        ) : (
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search a topic (e.g. GTA 6 Vice City map) or paste a YouTube link"
          aria-label="Search YouTube or paste a link"
          className={`${inputCls} border-transparent bg-transparent pl-9`}
        />
      </div>
      <select
        value={game}
        onChange={(e) => setGame(e.target.value)}
        aria-label="Topic"
        className="cursor-pointer rounded-full border border-border bg-transparent px-3 py-2 text-xs text-fg outline-none"
      >
        {topics.map((g) => (
          <option key={g.slug} value={g.slug} className="bg-bg-elev">
            {g.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!text.trim() || lookup.isPending}
        className="rounded-full bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15 disabled:opacity-40"
      >
        {lookup.isPending ? "Looking…" : isLink ? "Add video" : "Search"}
      </button>
    </form>
  );
}
