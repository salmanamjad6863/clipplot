"use client";

import { useEffect, useState } from "react";
import { Reorder, motion, useDragControls } from "motion/react";
import clsx from "clsx";
import { Clapperboard, Copy, GripVertical, Radar, Save, Smartphone, Timer, SquarePlay } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Segmented, Toggle, ease, inputCls } from "@/components/ui";
import { GAMES_BY_SLUG } from "@/lib/games";
import { useDisconnectYouTube, useSaveSettings, useSettings } from "@/lib/queries";
import type { Settings } from "@/lib/types";

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
        {/* Games */}
        <Card i={0} icon={Radar} title="Games & fallback order" className="lg:row-span-2">
          <p className="text-sm text-muted">
            Drag to reorder. The top game is tried first; if it has no strong trend, ClipPilot moves down the list
            (max <b className="text-fg">{s.maxFallbackDepth}</b> games). Each game uploads to its own playlist.
          </p>
          <Reorder.Group axis="y" values={s.games} onReorder={(games) => set("games", games)} className="mt-4 space-y-2">
            {s.games.map((g, idx) => (
              <GameRow
                key={g.slug}
                item={g}
                index={idx}
                withinDepth={idx < s.maxFallbackDepth}
                onToggle={(enabled) => {
                  if (!enabled && s.games.filter((x) => x.enabled).length === 1) {
                    toast.error("Keep at least one game enabled");
                    return;
                  }
                  set("games", s.games.map((x) => (x.slug === g.slug ? { ...x, enabled } : x)));
                }}
              />
            ))}
          </Reorder.Group>
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
            <NumberField label="Per day" value={s.formats.short.perDay} max={6} onChange={(perDay) => setShort({ perDay })} />
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
            <NumberField label="Don't repeat for (days)" value={s.dedupeWindowDays} max={90} onChange={(v) => set("dedupeWindowDays", v)} />
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

        {/* Publishing */}
        <Card i={3} icon={SquarePlay} title="Publishing">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Autopilot</p>
              <p className="text-xs text-muted">Upload approved videos automatically at the daily slot.</p>
            </div>
            <Toggle label="Autopilot" checked={s.autopilot} onChange={(v) => set("autopilot", v)} />
          </div>
          <label className="mt-4 block">
            <span className="text-xs text-muted">Daily upload time (UTC)</span>
            <input type="time" value={s.uploadTime} onChange={(e) => set("uploadTime", e.target.value)} className={`${inputCls} mt-1.5 w-40`} />
          </label>
          <YouTubeConnection connected={s.youtubeConnected} channelTitle={s.youtubeChannelTitle} />
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

function YouTubeConnection({ connected, channelTitle }: { connected: boolean; channelTitle?: string }) {
  const disconnect = useDisconnectYouTube();

  // result of the Google redirect (?youtube=connected / ?youtube_error=...)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("youtube") === "connected") toast.success("YouTube channel connected");
    const err = q.get("youtube_error");
    if (err) toast.error(err);
    if (q.has("youtube") || err) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-border p-3">
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
          onClick={() => {
            if (confirm("Disconnect YouTube? Queued uploads will wait until you reconnect.")) disconnect.mutate();
          }}
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

function GameRow({
  item,
  index,
  withinDepth,
  onToggle,
}: {
  item: Settings["games"][number];
  index: number;
  withinDepth: boolean;
  onToggle: (v: boolean) => void;
}) {
  const controls = useDragControls();
  const game = GAMES_BY_SLUG[item.slug];
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 40px -12px rgb(0 0 0 / 0.6)" }}
      className={clsx(
        "flex items-center gap-3 rounded-xl border border-border bg-bg-elev/70 px-3 py-2.5",
        !item.enabled && "opacity-50",
      )}
    >
      <button
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none text-muted active:cursor-grabbing"
        aria-label={`Drag ${game.name}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 font-mono text-xs text-muted">{index + 1}</span>
      <span className="h-2 w-2 rounded-full" style={{ background: game.color, boxShadow: `0 0 8px ${game.color}` }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {game.name}
          {index === 0 && <span className="ml-2 text-[10px] uppercase tracking-wider text-coral">primary</span>}
        </p>
        <p className="truncate text-[11px] text-muted">
          {game.playlistTitle}
          {!withinDepth && " · beyond fallback depth"}
        </p>
      </div>
      <Toggle label={`Enable ${game.name}`} checked={item.enabled} onChange={onToggle} />
    </Reorder.Item>
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
