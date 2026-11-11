"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Clapperboard, Copy, Film, Radar, Save, Smartphone, Timer, SquarePlay } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TopicsManager } from "@/components/topics-manager";
import { PageHeader, Segmented, Toggle, ease, inputCls } from "@/components/ui";
import { DISCOVERY_LEAD_HOURS } from "@/lib/schedule-time";
import {
  useDeleteWorkspace,
  useDisconnectYouTube,
  useRenameWorkspace,
  useSaveSettings,
  useSettings,
  useWorkspaces,
} from "@/lib/queries";
import { VOICES, type RenderSettings, type Settings } from "@/lib/types";

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  if (isLoading || !data) return <div className="skeleton h-[40rem] rounded-2xl" />;
  // Re-mount the form whenever the server copy changes (after save)
  return <SettingsForm key={JSON.stringify(data)} initial={data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const save = useSaveSettings();
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setShort = (patch: Partial<Settings["formats"]["short"]>) =>
    setS((p) => ({ ...p, formats: { ...p.formats, short: { ...p.formats.short, ...patch } } }));
  const setRender = (patch: Partial<RenderSettings>) => setS((p) => ({ ...p, render: { ...p.render, ...patch } }));
  const setLong = (patch: Partial<Settings["formats"]["long"]>) =>
    setS((p) => ({ ...p, formats: { ...p.formats, long: { ...p.formats.long, ...patch } } }));

  return (
    <>
      <PageHeader title="Settings">
        <button
          onClick={() => {
            // send only what changed (formats as a whole object when any part changed)
            const changed = Object.fromEntries(
              Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k as keyof Settings])),
            ) as Partial<Settings>;
            save.mutate(changed);
          }}
          disabled={!dirty || save.isPending}
          className="inline-flex items-center gap-2 rounded-full bg-sunset px-5 py-2 text-sm font-medium text-bg transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40"
        >
          <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save changes"}
        </button>
      </PageHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Workspace */}
        <WorkspaceCard />

        {/* Topics */}
        <Card i={0} icon={Radar} title="Topics (games & niches)" className="lg:row-span-2">
          <TopicsManager s={s} setS={setS} />
        </Card>

        {/* Formats */}
        <Card i={1} icon={Timer} title="Video formats & length">
          <FormatRow
            icon={Smartphone}
            title="Shorts / reels"
            sub="Vertical 9:16 · YouTube allows up to 3 min"
            enabled={s.formats.short.enabled}
            onEnabled={(enabled) => setShort({ enabled })}
          >
            <NumberField label="Min (sec)" value={s.formats.short.minSec} onChange={(minSec) => setShort({ minSec })} />
            <NumberField label="Max (sec)" value={s.formats.short.maxSec} max={180} onChange={(maxSec) => setShort({ maxSec })} />
            {s.topicMode === "per_topic" ? (
              <div className="text-xs text-muted">
                <span className="text-xs">Per day</span>
                <p className="mt-2.5 text-fg/80">set per topic</p>
              </div>
            ) : (
              <NumberField label="Per day" value={s.formats.short.perDay} max={6} onChange={(perDay) => setShort({ perDay })} />
            )}
          </FormatRow>

          <div className="my-5 h-px bg-border" />

          <FormatRow
            icon={Clapperboard}
            title="Full videos"
            sub="Horizontal 16:9 · compilation of the best trends"
            enabled={s.formats.long.enabled}
            onEnabled={(enabled) => setLong({ enabled })}
          >
            <NumberField label="Min (min)" value={s.formats.long.minSec / 60} onChange={(m) => setLong({ minSec: m * 60 })} />
            <NumberField label="Max (min)" value={s.formats.long.maxSec / 60} max={60} onChange={(m) => setLong({ maxSec: m * 60 })} />
            <NumberField label="Clips each" value={s.formats.long.clipsPerVideo} max={20} onChange={(clipsPerVideo) => setLong({ clipsPerVideo })} />
            <div className="col-span-3">
              <Segmented
                id="cadence"
                value={s.formats.long.cadence}
                onChange={(cadence) => setLong({ cadence })}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
            </div>
          </FormatRow>
        </Card>

        {/* Dedupe + discovery */}
        <Card i={2} icon={Copy} title="Duplicate protection & discovery">
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Don't repeat for (days)" value={s.dedupeWindowDays} max={30} onChange={(v) => set("dedupeWindowDays", v)} />
            <NumberField label="Look back (hours)" value={s.lookbackHours} max={168} onChange={(v) => set("lookbackHours", v)} />
            <NumberField label="Min views / hour" value={s.minViewsPerHour} step={500} max={1_000_000} onChange={(v) => set("minViewsPerHour", v)} />
            <NumberField label="Fallback depth" value={s.maxFallbackDepth} max={s.games.length} onChange={(v) => set("maxFallbackDepth", v)} />
          </div>
          <label className="mt-4 block">
            <span className="flex justify-between text-xs text-muted">
              Same-story match <span className="font-mono text-fg">{Math.round(s.titleSimilarity * 100)}%</span>
            </span>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={s.titleSimilarity}
              onChange={(e) => set("titleSimilarity", Number(e.target.value))}
              className="mt-2 w-full accent-[var(--coral)]"
            />
          </label>
          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li>• Same video ID is never used twice (watch, youtu.be, /shorts links all match).</li>
            <li>• Re-uploads with a similar title within the window are skipped.</li>
            <li>• Skipped repeats show on the Trends page with the reason.</li>
          </ul>
        </Card>

        {/* Video & copyright */}
        <Card i={4} icon={Film} title="Video & copyright" className="lg:col-span-2">
          <VideoSettings r={s.render} set={setRender} />
        </Card>

        {/* Publishing */}
        <Card i={3} icon={SquarePlay} title="Publishing">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Autopilot</p>
              <p className="text-xs text-muted">Upload approved videos automatically at the daily slot.</p>
            </div>
            <Toggle label="Autopilot" checked={s.autopilot} onChange={(v) => set("autopilot", v)} />
          </div>
          <UploadTimes times={s.uploadTimes} onChange={(t) => setS((p) => ({ ...p, uploadTimes: t, uploadTime: [...t].sort()[0] }))} />
          <ScheduleStatus s={s} saved={initial} />
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Breaking-news mode</p>
              <p className="text-xs text-muted">
                Extra GTA 6 checks during the day; only exceptional trends (viral score 90+) become extra Shorts, max 2/day.
              </p>
            </div>
            <Toggle label="Breaking-news mode" checked={s.breakingNews} onChange={(v) => set("breakingNews", v)} />
          </div>
          {s.breakingNews && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              Check every
              <select
                value={s.breakingEveryHours}
                onChange={(e) => set("breakingEveryHours", Number(e.target.value))}
                className="cursor-pointer rounded-lg border border-border bg-transparent px-2 py-1 text-fg outline-none"
              >
                {[2, 3, 4, 6].map((h) => (
                  <option key={h} value={h} className="bg-bg-elev">
                    {h} hours
                  </option>
                ))}
              </select>
              ≈ {Math.round((24 / s.breakingEveryHours) * 102)} quota units/day
            </label>
          )}
          <YouTubeConnection connected={s.youtubeConnected} channelTitle={s.youtubeChannelTitle} scopes={s.youtubeScopes} />
          <div className="mt-4">
            <p className="text-xs text-muted">Upload visibility</p>
            <div className="mt-1.5">
              <Segmented
                id="privacy"
                value={s.youtubePrivacy}
                onChange={(v) => set("youtubePrivacy", v)}
                options={[
                  { value: "private", label: "Private" },
                  { value: "unlisted", label: "Unlisted" },
                  { value: "public", label: "Public" },
                ]}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Until your Google Cloud project passes YouTube&apos;s API audit, YouTube locks API uploads to{" "}
              <b className="text-fg/80">private</b> — publish them by hand in YouTube Studio, or request the audit.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

/** Rename / delete the current workspace (one per YouTube channel). */
function WorkspaceCard() {
  const { data } = useWorkspaces();
  const rename = useRenameWorkspace();
  const del = useDeleteWorkspace();
  const current = data?.workspaces.find((w) => w.id === data.currentId);
  const [name, setName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const stopConfirming = useCallback(() => setConfirming(false), []);
  if (!current) return null;
  const value = name ?? current.name;
  const only = (data?.workspaces.length ?? 0) <= 1;

  return (
    <motion.section
      id="workspace"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease }}
      className="glass scroll-mt-24 rounded-2xl p-5 lg:col-span-2"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-48 flex-1">
          <span className="text-xs text-muted">Workspace name</span>
          <input value={value} maxLength={40} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1.5`} />
        </label>
        <button
          onClick={() => rename.mutate({ id: current.id, name: value.trim() }, { onSuccess: () => setName(null) })}
          disabled={!value.trim() || value.trim() === current.name || rename.isPending}
          className="rounded-full border border-border px-4 py-2 text-sm transition hover:bg-white/5 disabled:opacity-40"
        >
          Rename
        </button>
        <button
          onClick={() => setConfirming(true)}
          disabled={only}
          title={only ? "You need at least one workspace" : undefined}
          className="rounded-full px-4 py-2 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-40"
        >
          Delete workspace
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Everything on this page belongs to <b className="text-fg/80">{current.name}</b>
        {current.youtubeConnected ? ` (${current.channelTitle})` : ""}. Switch or add workspaces from the sidebar — one per YouTube
        channel. All workspaces share your Google project&apos;s YouTube quota (10,000 units/day ≈ 6 uploads in total) and the
        worker&apos;s footage folder.
      </p>
      <ConfirmDialog
        open={confirming}
        title={`Delete "${current.name}"?`}
        confirmLabel={del.isPending ? "Deleting…" : "Delete forever"}
        tone="danger"
        busy={del.isPending}
        onConfirm={() => del.mutate(current.id, { onSettled: stopConfirming })}
        onCancel={stopConfirming}
      >
        <p>This permanently deletes its settings, trends, clips, review queue and previews, and disconnects its channel.</p>
        <p>Videos already on YouTube stay there. This can&apos;t be undone.</p>
      </ConfirmDialog>
    </motion.section>
  );
}

/** How the worker builds every video. Applied to the next render (re-render a clip to apply to it). */
function VideoSettings({ r, set }: { r: RenderSettings; set: (p: Partial<RenderSettings>) => void }) {
  const voiceKnown = VOICES.some((v) => v.id === r.voice);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <p className="text-xs text-muted">Background footage</p>
          <div className="mt-1.5">
            <Segmented
              id="footage-mode"
              value={r.footageMode}
              onChange={(v) => set({ footageMode: v })}
              options={[
                { value: "auto", label: "My footage (cut up)" },
                { value: "gradient", label: "Gradient only" },
                { value: "source", label: "Source video (test)" },
              ]}
            />
          </div>
          {r.footageMode === "source" && (
            <p className="mt-1.5 text-[11px] text-amber-300">
              Test mode: cuts up the trending video itself (needs yt-dlp on your Mac). Preview only — YouTube upload is blocked
              for these renders.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-muted">
            Footage comes from <code className="text-fg/70">worker/footage/&lt;game&gt;/</code> on your Mac — your own gameplay or
            short official trailer clips. No footage → animated gradient.
          </p>
        </div>

        <motion.div animate={{ opacity: r.footageMode !== "gradient" ? 1 : 0.35 }} className={clsx("space-y-4", r.footageMode === "gradient" && "pointer-events-none")}>
          <label className="block">
            <span className="flex justify-between text-xs text-muted">
              Max seconds per footage cut
              <span className="font-mono text-fg">{r.maxCutSec === 0 ? "no limit" : `${r.maxCutSec}s`}</span>
            </span>
            <input
              type="range"
              min={0}
              max={15}
              step={0.5}
              value={r.maxCutSec}
              onChange={(e) => set({ maxCutSec: Number(e.target.value) })}
              className="mt-2 w-full accent-[var(--coral)]"
            />
            <span className="text-[11px] text-muted">
              Shorter cuts = no long stretch of any one source on screen. 2–4s is a good balance.
            </span>
          </label>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm">Keep footage sound</p>
              <p className="text-[11px] text-muted">Off = picture only. Audio is what Content ID matches most — keep it off for trailers.</p>
            </div>
            <Toggle label="Keep footage sound" checked={r.keepFootageAudio} onChange={(v) => set({ keepFootageAudio: v })} />
          </div>
          {r.keepFootageAudio && (
            <label className="block">
              <span className="flex justify-between text-xs text-muted">
                Footage volume under the voice <span className="font-mono text-fg">{r.footageVolume}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={r.footageVolume}
                onChange={(e) => set({ footageVolume: Number(e.target.value) })}
                className="mt-2 w-full accent-[var(--coral)]"
              />
            </label>
          )}
        </motion.div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted">Narrator voice</span>
            <select
              value={voiceKnown ? r.voice : "__custom"}
              onChange={(e) => set({ voice: e.target.value === "__custom" ? "" : e.target.value })}
              className={`${inputCls} mt-1.5 cursor-pointer`}
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id} className="bg-bg-elev">
                  {v.label}
                </option>
              ))}
              <option value="__custom" className="bg-bg-elev">
                Other…
              </option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Speed (words/min)</span>
            <input
              type="number"
              min={120}
              max={260}
              step={5}
              value={r.voiceRate}
              onChange={(e) => set({ voiceRate: Number(e.target.value) })}
              className={`${inputCls} mt-1.5 font-mono`}
            />
          </label>
        </div>
        {!voiceKnown && (
          <input
            value={r.voice}
            onChange={(e) => set({ voice: e.target.value })}
            placeholder="Exact macOS voice name, e.g. Ava (Premium)"
            className={inputCls}
          />
        )}
        <p className="-mt-2 text-[11px] text-muted">
          Natural voices are generated free on your Mac (first render downloads the ~90 MB voice model once).
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted">Words per caption</span>
            <input
              type="number"
              min={1}
              max={8}
              value={r.captionWords}
              onChange={(e) => set({ captionWords: Number(e.target.value) })}
              className={`${inputCls} mt-1.5 font-mono`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Watermark</span>
            <input
              value={r.brandText}
              maxLength={30}
              onChange={(e) => set({ brandText: e.target.value })}
              placeholder="none"
              className={`${inputCls} mt-1.5`}
            />
          </label>
        </div>
        <p className="text-[11px] text-muted">Changes apply to the next render. Full videos use twice the caption words.</p>
      </div>
    </div>
  );
}

/** Daily upload slots (UTC). Shorts are spread across them. */
function UploadTimes({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  const sorted = [...times].sort();
  const [adding, setAdding] = useState("18:00");
  return (
    <div className="mt-4">
      <span className="text-xs text-muted">Upload times (UTC) — Shorts are spread across them</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {sorted.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/[0.04] py-1 pl-3 pr-1 font-mono text-sm">
            {t}
            <button
              type="button"
              onClick={() => onChange(sorted.filter((x) => x !== t))}
              disabled={sorted.length <= 1}
              aria-label={`Remove ${t}`}
              className="grid h-5 w-5 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-fg disabled:opacity-30"
            >
              ×
            </button>
          </span>
        ))}
        {sorted.length < 6 && (
          <span className="inline-flex items-center gap-1">
            <input
              type="time"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              aria-label="New upload time"
              className="rounded-lg border border-border bg-transparent px-2 py-1 font-mono text-sm text-fg outline-none"
            />
            <button
              type="button"
              onClick={() => adding && !sorted.includes(adding) && onChange([...sorted, adding].sort())}
              className="rounded-full bg-white/5 px-3 py-1 text-xs transition hover:bg-white/10"
            >
              + Add
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/** Explains the daily rhythm and shows last/next runs (times in your local timezone). */
function ScheduleStatus({ s, saved }: { s: Settings; saved: Settings }) {
  const sch = saved.schedule;
  const first = [...s.uploadTimes].sort()[0] ?? s.uploadTime;
  const [h, m] = first.split(":").map(Number);
  const discoveryUtc = `${String((h - DISCOVERY_LEAD_HOURS + 24) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const timeChanged = JSON.stringify([...s.uploadTimes].sort()) !== JSON.stringify([...saved.uploadTimes].sort());
  const slots = s.uploadTimes.length;
  const perSlot = Math.max(1, Math.ceil(s.formats.short.perDay / slots));

  return (
    <div className="mt-3 rounded-xl bg-white/[0.03] p-3 text-xs text-muted">
      <p>
        Daily at <b className="text-fg/90">{discoveryUtc} UTC</b> ClipPilot finds trends and Claude writes scripts (
        {DISCOVERY_LEAD_HOURS}h before upload) so you can review.{" "}
        {s.autopilot ? (
          <>
            At{" "}
            <b className="text-fg/90">
              {[...s.uploadTimes].sort().join(", ")} UTC
            </b>{" "}
            up to {perSlot} approved Short{perSlot > 1 ? "s" : ""} upload{slots > 1 ? " per slot" : ""} (+ the full video at the
            first slot).
          </>
        ) : (
          <>Autopilot is off — approved videos upload right away.</>
        )}
      </p>
      {!sch?.ready ? (
        <p className="mt-2 text-warning">Scheduler needs the latest migrations — run them in the Supabase SQL Editor.</p>
      ) : timeChanged ? (
        <p className="mt-2 text-amber">Save to update the next run times.</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          <span>Next discovery: <span className="text-fg/80">{fmtTime(sch.nextDiscoveryAt)}</span></span>
          <span>Last: <span className="text-fg/80">{fmtTime(sch.lastDiscoveryAt)}</span></span>
          {s.autopilot && (
            <>
              <span>Next upload slot: <span className="text-fg/80">{fmtTime(sch.nextReleaseAt)}</span></span>
              <span>Last: <span className="text-fg/80">{fmtTime(sch.lastReleaseAt)}</span></span>
            </>
          )}
        </div>
      )}
      <p className="mt-2">The worker on your Mac (<code className="text-fg/70">pnpm worker</code>) is the clock — keep it running.</p>
    </div>
  );
}

function YouTubeConnection({
  connected,
  channelTitle,
  scopes,
}: {
  connected: boolean;
  channelTitle?: string;
  scopes?: Settings["youtubeScopes"];
}) {
  const disconnect = useDisconnectYouTube();
  const [asking, setAsking] = useState(false);
  const stopAsking = useCallback(() => setAsking(false), []);

  // result of the Google redirect (?youtube=connected / ?youtube_error=...)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("youtube") === "connected") toast.success("YouTube channel connected");
    const err = q.get("youtube_error");
    if (err) toast.error(err);
    if (q.has("youtube") || err) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          YouTube channel
          <span className={clsx("h-2 w-2 rounded-full", connected ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-white/20")} />
        </p>
        <p className="truncate text-xs text-muted">
          {connected ? `Connected: ${channelTitle ?? "your channel"}` : "Not connected — approved videos wait until you connect"}
        </p>
      </div>
      {connected ? (
        <button
          onClick={() => setAsking(true)}
          disabled={disconnect.isPending}
          className="shrink-0 rounded-full border border-border px-4 py-1.5 text-xs text-muted transition hover:bg-white/5 hover:text-fg disabled:opacity-50"
        >
          Disconnect
        </button>
      ) : (
        // full navigation: Google's consent screen, then back to /settings
        <a
          href="/api/youtube/connect"
          className="shrink-0 rounded-full bg-sunset px-4 py-1.5 text-xs font-medium text-bg transition-transform hover:scale-105"
        >
          Connect YouTube
        </a>
      )}
      {connected && scopes && (!scopes.analytics || !scopes.comments) && (
        <p className="basis-full text-[11px] text-amber">
          Missing {[!scopes.analytics && "Analytics (% watched)", !scopes.comments && "comment posting"].filter(Boolean).join(" and ")} —{" "}
          <a href="/api/youtube/connect" className="underline hover:text-fg">
            reconnect
          </a>{" "}
          and tick every permission to enable them.
        </p>
      )}
      <ConfirmDialog
        open={asking}
        title="Disconnect YouTube?"
        confirmLabel="Disconnect"
        tone="danger"
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate(undefined, { onSettled: () => setAsking(false) })}
        onCancel={stopAsking}
      >
        <p>ClipPilot loses access to {channelTitle ?? "your channel"}. Videos already on YouTube stay there.</p>
        <p>Approved videos wait until you connect again. Playlists are re-linked on reconnect.</p>
      </ConfirmDialog>
    </div>
  );
}

function Card({
  i,
  icon: Icon,
  title,
  className,
  children,
}: {
  i: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: i * 0.06, ease }}
      className={clsx("glass rounded-2xl p-5", className)}
    >
      <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold">
        <Icon className="h-4 w-4 text-coral" /> {title}
      </h2>
      {children}
    </motion.section>
  );
}

function FormatRow({
  icon: Icon,
  title,
  sub,
  enabled,
  onEnabled,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-amber">
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted">{sub}</p>
        </div>
        <Toggle label={title} checked={enabled} onChange={onEnabled} />
      </div>
      <motion.div
        animate={{ opacity: enabled ? 1 : 0.35 }}
        className={clsx("mt-4 grid grid-cols-3 gap-3", !enabled && "pointer-events-none")}
      >
        {children}
      </motion.div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${inputCls} mt-1.5 font-mono`}
      />
    </label>
  );
}
