/**
 * ClipPilot worker — runs on your Mac. Renders videos and uploads approved ones to YouTube.
 *   pnpm worker          poll for render + upload jobs every 30s
 *   pnpm worker --once   process at most one job, then exit
 *   pnpm worker --tick   run one scheduler tick and show the next discovery/upload times
 *   pnpm worker --local <clip.json>   render a clip JSON file offline (no server, no upload)
 *
 * Needs: ffmpeg + ffprobe (brew install ffmpeg), macOS `say`.
 * Full-quality videos stay in worker/output/<clipId>/; only a small preview is uploaded for review.
 */
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_RENDER, type Clip, type RenderSettings } from "../src/lib/types.ts";
import { run } from "./proc.mts";
import { OUTPUT_DIR, fullPathFor, renderClip, sourceFlagFor, thumbPathFor } from "./render.mts";
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

async function processOne(type: JobKind): Promise<boolean> {
  const { job, clip, render } = await call<{ job: { id: string; attempts: number } | null; clip?: Clip; render?: RenderSettings }>("claim", {
    workerId: WORKER_ID,
    type,
  });
  if (!job || !clip) return false;

  log(`▶ ${type} ${job.id.slice(0, 8)} · ${clip.format} · "${clip.title}" (attempt ${job.attempts})`);
  const started = Date.now();
  try {
    if (type === "render") {
      const r = await renderClip(clip, (m) => log(`  ${m}`), render);
      log("  uploading preview…");
      await uploadPreview(job.id, r.previewPath);
      await call("complete", { jobId: job.id, durationSec: r.durationSec, chapters: r.chapters, testRender: r.testRender });
      log(`✓ rendered in ${((Date.now() - started) / 1000).toFixed(0)}s → ${r.fullPath}`);
    } else {
      // full-quality file from the render step; re-render if it was deleted or rendered elsewhere
      let file = fullPathFor(clip);
      if (!existsSync(file)) {
        log("  full video not on this machine — re-rendering it first");
        file = (await renderClip(clip, (m) => log(`  ${m}`), render)).fullPath;
      }
      if (existsSync(sourceFlagFor(clip))) {
        throw new Error("Test render made from the source creator's video — not uploaded. Set Background footage to My footage and Regenerate to publish.");
      }
      const plan = await call<{ accessToken: string; channel: string | null; metadata: UploadMetadata }>("upload-plan", { jobId: job.id });
      log(`  uploading to YouTube${plan.channel ? ` (${plan.channel})` : ""} as ${String(plan.metadata.status.privacyStatus)}…`);
      const videoId = await uploadToYouTube(file, plan.metadata, plan.accessToken, (m) => log(`  ${m}`));
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
  for (const bin of ["ffmpeg", "ffprobe", "say"]) {
    await run("which", [bin], { quiet: true }).catch(() => {
      throw new Error(`${bin} not found — install with: brew install ffmpeg`);
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

  if (args.includes("--tick")) {
    await tick(true);
    return;
  }

  if (args.includes("--once")) {
    if (!(await processNext())) log("no render or upload jobs waiting");
    return;
  }

  let stop = false;
  process.on("SIGINT", () => {
    log("stopping after the current job…");
    stop = true;
  });
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
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
