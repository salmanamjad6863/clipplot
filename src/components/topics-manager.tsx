"use client";

import { useState } from "react";
import { Reorder, motion, useDragControls } from "motion/react";
import clsx from "clsx";
import { GripVertical, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "./confirm-dialog";
import { Segmented, Toggle, inputCls } from "./ui";
import { TOPIC_COLORS, dailyShortsTotal, slugify, type Topic, type TopicMode } from "@/lib/topics";
import type { Settings } from "@/lib/types";

const list = (v: string) =>
  v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Settings → Topics: the games / niches this channel covers. Edit presets, add your own,
 * choose fallback order or a daily count per topic, and give Claude style notes.
 */
export function TopicsManager({ s, setS }: { s: Settings; setS: React.Dispatch<React.SetStateAction<Settings>> }) {
  const [editing, setEditing] = useState<Topic | "new" | null>(null);
  const topics = s.topics;
  const perTopic = s.topicMode === "per_topic";
  const setTopics = (t: Topic[]) => setS((p) => ({ ...p, topics: t.map((x, i) => ({ ...x, priority: i })) }));
  const patch = (slug: string, v: Partial<Topic>) => setTopics(topics.map((t) => (t.slug === slug ? { ...t, ...v } : t)));

  return (
    <div>
      <Segmented
        id="topic-mode"
        value={s.topicMode}
        onChange={(v: TopicMode) => setS((p) => ({ ...p, topicMode: v }))}
        options={[
          { value: "fallback", label: "Fallback order" },
          { value: "per_topic", label: "Daily count per topic" },
        ]}
      />
      <p className="mt-2 text-xs text-muted">
        {perTopic ? (
          <>
            Every enabled topic gets its own Shorts each day — <b className="text-fg">{dailyShortsTotal(s)}/day</b> in total. Each
            topic is one search (~102 quota units).
          </>
        ) : (
          <>
            The top topic is tried first; if it has no strong trend, ClipPilot moves down the list (max{" "}
            <b className="text-fg">{s.maxFallbackDepth}</b>) until <b className="text-fg">{s.formats.short.perDay}</b> Short
            {s.formats.short.perDay > 1 ? "s" : ""}/day are found. Drag to reorder.
          </>
        )}
      </p>

      <Reorder.Group axis="y" values={topics} onReorder={setTopics} className="mt-4 space-y-2">
        {topics.map((t, idx) => (
          <TopicRow
            key={t.slug}
            t={t}
            index={idx}
            perTopic={perTopic}
            dim={!perTopic && idx >= s.maxFallbackDepth}
            onToggle={(enabled) => {
              if (!enabled && topics.filter((x) => x.enabled).length === 1) return toast.error("Keep at least one topic enabled");
              patch(t.slug, { enabled });
            }}
            onDaily={(n) => patch(t.slug, { dailyShorts: n })}
            onEdit={() => setEditing(t)}
          />
        ))}
      </Reorder.Group>

      <button
        type="button"
        onClick={() => setEditing("new")}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-4 py-2 text-sm text-fg/90 transition hover:bg-white/5"
      >
        <Plus className="h-4 w-4 text-coral" /> Add topic (any game or niche)
      </button>

      <label className="mt-5 block">
        <span className="flex justify-between text-xs text-muted">
          Channel style for Claude <span>{s.channelPersona.length}/600</span>
        </span>
        <textarea
          value={s.channelPersona}
          maxLength={600}
          rows={3}
          onChange={(e) => setS((p) => ({ ...p, channelPersona: e.target.value }))}
          placeholder="e.g. Energetic but trustworthy GTA news channel for 16–30 year olds. Always say what's confirmed vs rumor. Recurring sign-off: 'Stay frosty, Vice City.'"
          className={`${inputCls} mt-1.5 resize-y`}
        />
      </label>

      <TopicDialog
        key={editing === "new" ? "new" : (editing?.slug ?? "none")}
        topic={editing}
        existing={topics}
        onClose={() => setEditing(null)}
        onSave={(t) => {
          const isNew = !topics.some((x) => x.slug === t.slug);
          setTopics(isNew ? [...topics, t] : topics.map((x) => (x.slug === t.slug ? t : x)));
          setEditing(null);
          toast.success(isNew ? `"${t.name}" added — Save changes to keep it` : `"${t.name}" updated — Save changes to keep it`);
        }}
        onDelete={(slug) => {
          setTopics(topics.filter((x) => x.slug !== slug));
          setEditing(null);
        }}
      />
    </div>
  );
}

function TopicRow({
  t,
  index,
  perTopic,
  dim,
  onToggle,
  onDaily,
  onEdit,
}: {
  t: Topic;
  index: number;
  perTopic: boolean;
  dim: boolean;
  onToggle: (v: boolean) => void;
  onDaily: (n: number) => void;
  onEdit: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={t}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 40px -12px rgb(0 0 0 / 0.6)" }}
      className={clsx("flex items-center gap-3 rounded-xl border border-border bg-bg-elev/70 px-3 py-2.5", !t.enabled && "opacity-50")}
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none text-muted active:cursor-grabbing"
        aria-label={`Drag ${t.name}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 font-mono text-xs text-muted">{index + 1}</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color, boxShadow: `0 0 8px ${t.color}` }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {t.name}
          {!perTopic && index === 0 && <span className="ml-2 text-[10px] uppercase tracking-wider text-coral">primary</span>}
          {t.custom && <span className="ml-2 text-[10px] uppercase tracking-wider text-cyan">custom</span>}
        </p>
        <p className="truncate text-[11px] text-muted">
          {t.playlistTitle}
          {dim && " · beyond fallback depth"}
        </p>
      </div>
      {perTopic && (
        <label className="flex items-center gap-1 text-[11px] text-muted" title="Shorts per day for this topic">
          <input
            type="number"
            min={0}
            max={6}
            value={t.dailyShorts}
            onChange={(e) => onDaily(Math.max(0, Math.min(6, Number(e.target.value))))}
            className="w-12 rounded-lg border border-border bg-transparent px-1.5 py-1 text-center font-mono text-sm text-fg outline-none"
          />
          /day
        </label>
      )}
      <button type="button" onClick={onEdit} aria-label={`Edit ${t.name}`} className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-fg">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Toggle label={`Enable ${t.name}`} checked={t.enabled} onChange={onToggle} />
    </Reorder.Item>
  );
}

function TopicDialog({
  topic,
  existing,
  onClose,
  onSave,
  onDelete,
}: {
  topic: Topic | "new" | null;
  existing: Topic[];
  onClose: () => void;
  onSave: (t: Topic) => void;
  onDelete: (slug: string) => void;
}) {
  const isNew = topic === "new";
  const base: Topic | null =
    topic === "new"
      ? {
          slug: "",
          name: "",
          enabled: true,
          priority: existing.length,
          queries: [],
          keywords: [],
          hashtags: ["#Shorts"],
          playlistTitle: "",
          color: TOPIC_COLORS[existing.length % TOPIC_COLORS.length],
          dailyShorts: 1,
          notes: "",
          custom: true,
        }
      : topic;
  const [name, setName] = useState(base?.name ?? "");
  const [queries, setQueries] = useState(base?.queries.join("\n") ?? "");
  const [keywords, setKeywords] = useState(base?.keywords.join(", ") ?? "");
  const [hashtags, setHashtags] = useState(base?.hashtags.join(" ") ?? "");
  const [playlist, setPlaylist] = useState(base?.playlistTitle ?? "");
  const [color, setColor] = useState(base?.color ?? TOPIC_COLORS[0]);
  const [notes, setNotes] = useState(base?.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!base) return null;

  const save = () => {
    const n = name.trim();
    if (!n) return toast.error("Give the topic a name");
    const slug = isNew ? slugify(n) : base.slug;
    if (isNew && existing.some((t) => t.slug === slug)) return toast.error("A topic with that name already exists");
    const q = list(queries);
    const tags = hashtags
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/[^#\p{L}\p{N}_]/gu, ""))
      .filter((h) => h.length > 1)
      .slice(0, 3);
    onSave({
      ...base,
      slug,
      name: n,
      queries: q.length ? q.slice(0, 6) : [n],
      keywords: list(keywords).slice(0, 12),
      hashtags: tags,
      playlistTitle: playlist.trim() || `${n} Shorts`,
      color,
      notes: notes.trim().slice(0, 400),
    });
  };

  return (
    <>
      <ConfirmDialog
        open={!confirmDelete}
        title={isNew ? "Add a topic" : `Edit "${base.name}"`}
        confirmLabel={isNew ? "Add topic" : "Done"}
        onConfirm={save}
        onCancel={onClose}
      >
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-left">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Cyberpunk 2077, GTA lore, Racing games" className={inputCls} />
          </Field>
          <Field label="YouTube search terms (one per line)" hint="What to search for trends. Each run = one search.">
            <textarea value={queries} onChange={(e) => setQueries(e.target.value)} rows={3} placeholder={"Cyberpunk 2077\nPhantom Liberty"} className={`${inputCls} resize-none`} />
          </Field>
          <Field label="Title must contain (comma separated)" hint="Filters out off-topic results. Empty = use the name / built-in rule.">
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="cyberpunk, 2077, night city" className={inputCls} />
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Hashtags (max 3)">
              <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#Cyberpunk2077 #Shorts" className={inputCls} />
            </Field>
            <Field label="Color">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-[38px] w-14 cursor-pointer rounded-xl border border-border bg-transparent" />
            </Field>
          </div>
          <Field label="Playlist name" hint="Shorts go here; full videos go to “<name> — Full Videos”.">
            <input value={playlist} onChange={(e) => setPlaylist(e.target.value)} maxLength={100} placeholder={`${name || "Topic"} Shorts`} className={inputCls} />
          </Field>
          <Field label="Notes for Claude (optional)" hint="Angle, audience, things to always/never do for this topic.">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={400} placeholder="Focus on hidden details and lore; never spoil story missions." className={`${inputCls} resize-none`} />
          </Field>
          {!isNew && base.custom && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-danger hover:underline">
              Delete this topic…
            </button>
          )}
          {!isNew && !base.custom && <p className="text-[11px]">Built-in topic: switch it off in the list instead of deleting.</p>}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${base.name}"?`}
        confirmLabel="Delete topic"
        tone="danger"
        onConfirm={() => onDelete(base.slug)}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>It stops being searched. Existing clips and published videos stay. Click Save changes afterwards.</p>
      </ConfirmDialog>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <motion.label initial={false} className="block">
      <span className="text-xs text-fg/80">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </motion.label>
  );
}
