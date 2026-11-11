"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ExternalLink, Flame, Save, ShieldAlert } from "lucide-react";
import { ApproveSkip, Thumb } from "@/components/clip-card";
import { GameChip } from "@/components/game-chip";
import { ScriptPanel } from "@/components/script-panel";
import { EmptyState, FormatBadge, StatusPill, ease, inputCls } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { useClip, useTopicMap, useTrends, useUpdateClip } from "@/lib/queries";
import { FORMAT_META, type Clip } from "@/lib/types";

export function ReviewDetail({ id }: { id: string }) {
  const { data: clip, isLoading, isError } = useClip(id);
  // key includes the script time so the edit form picks up a regenerated title/description

  if (isLoading) return <div className="skeleton h-[32rem] rounded-2xl" />;
  if (isError || !clip) return <EmptyState title="Clip not found" body="It may have been removed." />;

  // key resets the edit form when navigating between clips
  return <Detail key={`${clip.id}-${clip.script?.generatedAt ?? ""}`} clip={clip} />;
}

function Detail({ clip }: { clip: Clip }) {
  const update = useUpdateClip();
  const { data: trends } = useTrends();
  const [title, setTitle] = useState(clip.title);
  const [description, setDescription] = useState(clip.description);
  const [tags, setTags] = useState(clip.tags.join(", "));

  const game = useTopicMap()[clip.game];
  const sources = trends?.filter((t) => clip.trendIds.includes(t.id)) ?? [];
  const dirty = title !== clip.title || description !== clip.description || tags !== clip.tags.join(", ");
  const reviewable = clip.status === "awaiting_approval";

  const save = () =>
    update.mutate({
      id: clip.id,
      patch: { title, description, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) },
    });

  return (
    <>
      <Link
        href={clip.status === "awaiting_approval" ? "/review" : "/dashboard"}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> {clip.status === "awaiting_approval" ? "Back to queue" : "Back to dashboard"}
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[auto_1fr]">
        {/* Preview */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease }}
          className={clip.format === "short" ? "mx-auto w-64 lg:w-72" : "w-full lg:w-[24rem] xl:w-[30rem]"}
        >
          {clip.renderUrl ? (
            <video
              src={clip.renderUrl}
              controls
              playsInline
              className={`${FORMAT_META[clip.format].aspect} w-full rounded-2xl bg-black object-cover`}
            />
          ) : (
            <div className="relative">
              <Thumb clip={clip} className="w-full rounded-2xl" />
              <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-fg/70">
                Preview appears after render
              </p>
            </div>
          )}
          <p className="mt-3 text-center font-mono text-xs text-muted">
            {FORMAT_META[clip.format].ratio} · {formatDuration(clip.durationSec)}
          </p>
        </motion.div>

        {/* Meta + editor */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease }}
          className="min-w-0"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={clip.status} />
            <FormatBadge format={clip.format} />
            <GameChip slug={clip.game} fallback={clip.isFallback} />
            <span className="flex items-center gap-1 font-mono text-xs text-muted">
              <Flame className="h-3.5 w-3.5 text-coral" /> {clip.viralScore}
            </span>
            <span className="flex items-center gap-1 font-mono text-xs text-muted">
              <ShieldAlert className="h-3.5 w-3.5 text-warning" /> risk {clip.riskScore}
            </span>
          </div>

          <p className="mt-4 text-sm text-muted">
            Hook: <span className="text-fg">“{clip.hook}”</span>
          </p>

          <div className="glass mt-6 space-y-4 rounded-2xl p-5">
            <label className="block">
              <span className="flex justify-between text-xs text-muted">
                Title <span className={title.length > 100 ? "text-danger" : ""}>{title.length}/100</span>
              </span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={`${inputCls} mt-1.5`} />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Description</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={`${inputCls} mt-1.5 resize-y`} />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Tags (comma separated)</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            {game && (
              <p className="text-xs text-muted">
                Added on upload: <span className="text-fg/80">{game.hashtags.join(" ")}</span> · Playlist{" "}
                <span className="text-fg/80">
                  {clip.format === "short" ? game.playlistTitle : `${game.name} — Full Videos`}
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {reviewable && <ApproveSkip clip={clip} size="md" />}
              <button
                onClick={save}
                disabled={!dirty || update.isPending}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-fg/90 transition hover:bg-white/5 disabled:opacity-40"
              >
                <Save className="h-4 w-4" /> Save edits
              </button>
            </div>
          </div>

          <ScriptPanel clip={clip} />

          <div className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
              Based on {sources.length || clip.trendIds.length} trending video{clip.trendIds.length > 1 ? "s" : ""}
            </h3>
            <ul className="mt-3 space-y-2">
              {(sources.length ? sources : [{ id: "x", url: clip.trendUrl, title: "Trend source", channel: "" }]).map((t) => (
                <li key={t.id}>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="glass flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.channel && <span className="hidden text-xs text-muted sm:inline">{t.channel}</span>}
                    <ExternalLink className="h-3.5 w-3.5 text-muted" />
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Links only — the original videos are never downloaded or stored.</p>
          </div>
        </motion.div>
      </div>
    </>
  );
}
