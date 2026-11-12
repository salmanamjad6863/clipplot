/**
 * ClipPilot worker — runs on your Mac. Renders videos and uploads approved ones to YouTube.
 *   pnpm worker          poll for render + upload jobs every 30s
 *   pnpm worker --once   process at most one job, then exit
 *   pnpm worker --drain  one scheduler tick, then every waiting job, then exit (cloud runs: GitHub Actions)
 *   pnpm worker --tick   run one scheduler tick and show the next discovery/upload times
 *   pnpm worker --local <clip.json>   render a clip JSON file offline (no server, no upload)
 *
 * Needs: ffmpeg + ffprobe. Voices: Kokoro (any OS); macOS `say` voices only on a Mac.
 * Full-quality videos stay in worker/output/<clipId>/; only a small preview is uploaded for review.
 */
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_RENDER, type Clip, type RenderSettings } from "../src/lib/types.ts";
import { run } from "./proc.mts";
import { OUTPUT_DIR, fullPathFor, renderClip, setCloudFootage, setEditPlanner, setMusicSearch, setStockSearch, sourceFlagFor, thumbPathFor } from "./render.mts";
import { setThumbnail, uploadToYouTube, type UploadMetadata } from "./youtube.mts";

const API = (process.env.CLIPPILOT_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.WORKER_SECRET;
const WORKER_ID = `${os.hostname()}-${process.pid}`.slice(0, 64);
const POLL_MS = 30_000;
const TICK_MS = 5 * 60_000; // scheduler clock

const log = (m: string) => console.log(`${new Date().toLocaleTimeString()}  ${m}`);

async function call<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/api/worker/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${route}: ${data.error ?? res.status}`);
  return data;
}

async function uploadPreview(jobId: string, file: string) {
  const { path, token } = await call<{ path: string; token: string }>("upload", { jobId, ext: "mp4" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Worker needs NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  // signed upload: the publishable key + one-time token only allow writing this exact path
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, await readFile(file), {
    contentType: "video/mp4",
    upsert: true,
  });
  if (error) throw new Error(`upload: ${error.message}`);
}

type JobKind = "render" | "upload";

/* ---------- heartbeat: lets the app show "working / idle / stopped" ---------- */
const KIND = process.env.WORKER_KIND === "cloud" ? "cloud" : "mac";
const beat: { state: "idle" | "rendering" | "uploading" | "stopped"; title?: string; progress?: string } = { state: "idle" };
async function sendBeat() {
  await call("heartbeat", { workerId: WORKER_ID, kind: KIND, ...beat }).catch(() => {}); // never break a job over status
}
function setBeat(next: typeof beat) {
  Object.assign(beat, { title: undefined, progress: undefined }, next);
  void sendBeat();
}
let beatTimer: ReturnType<typeof setInterval> | null = null;
function startBeats() {
  void sendBeat();
  beatTimer = setInterval(sendBeat, 20_000);
}
async function stopBeats() {
  if (beatTimer) clearInterval(beatTimer);
  beat.state = "stopped";
  await sendBeat();
}

async function processOne(type: JobKind): Promise<boolean> {
  const { job, clip, render } = await call<{ job: { id: string; attempts: number } | null; clip?: Clip; render?: RenderSettings }>("claim", {
    workerId: WORKER_ID,
    type,
  });
  if (!job || !clip) return false;

  log(`▶ ${type} ${job.id.slice(0, 8)} · ${clip.format} · "${clip.title}" (attempt ${job.attempts})`);
  setBeat({ state: type === "render" ? "rendering" : "uploading", title: clip.title });
  const started = Date.now();
  try {
    if (type === "render") {
      // pure edits ask the server (Claude) to pick moments from the transcript — tied to this job
      setEditPlanner((transcript, durationSec) => call("edit-plan", { jobId: job.id, transcript, durationSec }));
      const r = await renderClip(clip, (m) => log(`  ${m}`), render);
      log("  uploading preview…");
      await uploadPreview(job.id, r.previewPath);
      if (r.credits.length) log(`  credits: ${r.credits.length} line(s) for the description`);
      const done = await call<{ credits?: number }>("complete", { jobId: job.id, durationSec: r.durationSec, chapters: r.chapters, testRender: r.testRender, credits: r.credits });
      if (r.credits.length && done.credits !== r.credits.length) log(`  ⚠ server saved ${done.credits ?? "no"} credit line(s) of ${r.credits.length}`);
      log(`✓ rendered in ${((Date.now() - started) / 1000).toFixed(0)}s → ${r.fullPath}`);
    } else {
      // full-quality file from the render step; re-render if it was deleted or rendered elsewhere
      let file = fullPathFor(clip);
      if (!existsSync(file)) {
        log("  full video not on this machine — re-rendering it first");
        file = (await renderClip(clip, (m) => log(`  ${m}`), render)).fullPath;
      }
      if (existsSync(sourceFlagFor(clip))) log("  note: background footage is from the source creator's video");
      const plan = await call<{ accessToken: string; channel: string | null; metadata: UploadMetadata }>("upload-plan", { jobId: job.id });
      log(`  uploading to YouTube${plan.channel ? ` (${plan.channel})` : ""} as ${String(plan.metadata.status.privacyStatus)}…`);
      const videoId = await uploadToYouTube(file, plan.metadata, plan.accessToken, (m) => {
        log(`  ${m}`);
        const pct = m.match(/upload (\d+)%/)?.[1];
        if (pct) beat.progress = `${pct}%`; // goes out with the next heartbeat
      });
      const thumb = thumbPathFor(clip);
      if (clip.format === "long" && existsSync(thumb)) {
        const err = await setThumbnail(videoId, await readFile(thumb), plan.accessToken);
        log(err ? `  thumbnail not set (${err}) — verify your channel's phone number to allow custom thumbnails` : "  custom thumbnail set");
      }
      const done = await call<{ youtubeUrl: string; playlistId: string | null }>("published", { jobId: job.id, videoId });
      log(`✓ published ${done.youtubeUrl}${done.playlistId ? " (+ playlist)" : ""} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`✗ ${type} failed: ${msg}`);
    await call<{ final: boolean }>("fail", { jobId: job.id, error: msg.slice(0, 400) }).catch((e) =>
      log(`  couldn't report failure: ${e.message}`),
    );
  }
  setBeat({ state: "idle" });
  return true;
}

interface TickResult {
  workspaceName: string;
  discovery: string;
  release: { status: string; queued: number };
  recovered: number;
  cleanedUp: string[];
  nextDiscoveryAt: string;
  nextReleaseAt: string;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Drives every workspace's daily schedule and removes local files of videos published > 7 days ago. */
async function tick(verbose = false) {
  const results = await call<TickResult[]>("tick", {});
  for (const r of results) {
    const ws = results.length > 1 ? `[${r.workspaceName}] ` : "";
    if (r.discovery === "started") log(`⏰ ${ws}daily discovery started (YouTube trends → Claude scripts)`);
    if (r.discovery === "breaking") log(`📰 ${ws}breaking-news check running`);
    if (r.release.status === "released") log(`⏰ ${ws}upload slot: ${r.release.queued} approved video(s) released`);
    if (r.recovered) log(`↺ ${ws}recovered ${r.recovered} stuck clip(s)`);
    for (const id of r.cleanedUp) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue; // only ever delete clip-id folders
      await rm(path.join(OUTPUT_DIR, id), { recursive: true, force: true });
    }
    if (r.cleanedUp.length) log(`🧹 ${ws}removed ${r.cleanedUp.length} old published video(s) from worker/output`);
    if (verbose || r.discovery === "started") {
      log(`${ws}next discovery ${hhmm(r.nextDiscoveryAt)} · next upload slot ${hhmm(r.nextReleaseAt)} · uploads: ${r.release.status}`);
    }
  }
}

/** Renders first (so new clips reach review fast), then uploads. */
async function processNext(): Promise<boolean> {
  return (await processOne("render")) || (await processOne("upload"));
}

async function preflight() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    await run("which", [bin], { quiet: true }).catch(() => {
      throw new Error(`${bin} not found — install ffmpeg (Mac: brew install ffmpeg · Linux: apt install ffmpeg)`);
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  await preflight();

  if (args[0] === "--local") {
    const clip = JSON.parse(await readFile(args[1], "utf8")) as Clip & { render?: Partial<RenderSettings> };
    const r = await renderClip(clip, (m) => log(m), { ...DEFAULT_RENDER, ...clip.render });
    log(`✓ ${r.fullPath} (${r.durationSec.toFixed(1)}s), preview ${r.previewPath}`);
    return;
  }

  if (!SECRET) throw new Error("WORKER_SECRET missing (it's in .env.local)");
  log(`ClipPilot worker ${WORKER_ID} → ${API}`);
  // footage uploaded in Settings → Footage (signed download links, valid 1h)
  // free stock video (Pixabay / Pexels) — the server holds the API keys
  setStockSearch(async (queries, portrait) =>
    (await call<{ videos: { id: string; url: string }[] }>("stock", { queries, orientation: portrait ? "portrait" : "landscape", perQuery: 2 })).videos,
  );
  setMusicSearch(async (mood) => (await call<{ tracks: { id: string; url: string; credit: string | null }[] }>("music", { mood })).tracks);
  setCloudFootage(async (game) => (await call<{ files: { name: string; url: string; size: number }[] }>("footage", { game })).files);

  if (args.includes("--tick")) {
    await tick(true);
    return;
  }

  if (args.includes("--drain")) {
    // cloud run: stop starting new jobs after DRAIN_MINUTES so the runner never hits its time limit
    const until = Date.now() + Number(process.env.DRAIN_MINUTES || 45) * 60_000;
    startBeats();
    await tick(true).catch((e) => log(`tick error: ${e instanceof Error ? e.message : e}`));
    let n = 0;
    while (Date.now() < until) {
      const did = await processNext().catch((e) => {
        log(`job error: ${e instanceof Error ? e.message : e}`);
        return true; // failed job is recorded server-side; try the next one
      });
      if (!did) break;
      n++;
    }
    log(n ? `drained ${n} job(s)` : "no render or upload jobs waiting");
    await stopBeats();
    return;
  }

  if (args.includes("--once")) {
    if (!(await processNext())) log("no render or upload jobs waiting");
    return;
  }

  let stop = false;
  const onStop = () => {
    if (stop) process.exit(0); // second signal → quit now
    log("stopping after the current job…");
    stop = true;
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);
  startBeats();
  let lastTick = 0;
  while (!stop) {
    if (Date.now() - lastTick >= TICK_MS) {
      const first = lastTick === 0;
      lastTick = Date.now();
      await tick(first).catch((e) => log(`tick error: ${e instanceof Error ? e.message : e}`));
    }
    try {
      const didWork = await processNext();
      if (didWork) continue; // check for more right away
    } catch (err) {
      log(`poll error: ${err instanceof Error ? err.message : err}`);
    }
    // sleep in small steps so Stop takes effect quickly
    for (let t = 0; t < POLL_MS && !stop; t += 1000) await new Promise((r) => setTimeout(r, 1000));
  }
  await stopBeats();
  log("worker stopped");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
