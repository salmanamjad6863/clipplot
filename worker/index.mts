/**
 * ClipPilot worker — runs on your Mac. Renders videos and uploads approved ones to YouTube.
 *   pnpm worker          poll for render + upload jobs every 30s
 *   pnpm worker --once   process at most one job, then exit
 *   pnpm worker --local <clip.json>   render a clip JSON file offline (no server, no upload)
 *
 * Needs: ffmpeg + ffprobe (brew install ffmpeg), macOS `say`.
 * Full-quality videos stay in worker/output/<clipId>/; only a small preview is uploaded for review.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import type { Clip } from "../src/lib/types.ts";
import { run } from "./proc.mts";
import { fullPathFor, renderClip } from "./render.mts";
import { uploadToYouTube, type UploadMetadata } from "./youtube.mts";

const API = (process.env.CLIPPILOT_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.WORKER_SECRET;
const WORKER_ID = `${os.hostname()}-${process.pid}`.slice(0, 64);
const POLL_MS = 30_000;

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
  const { job, clip } = await call<{ job: { id: string; attempts: number } | null; clip?: Clip }>("claim", {
    workerId: WORKER_ID,
    type,
  });
  if (!job || !clip) return false;

  log(`▶ ${type} ${job.id.slice(0, 8)} · ${clip.format} · "${clip.title}" (attempt ${job.attempts})`);
  const started = Date.now();
  try {
    if (type === "render") {
      const r = await renderClip(clip, (m) => log(`  ${m}`));
      log("  uploading preview…");
      await uploadPreview(job.id, r.previewPath);
      await call("complete", { jobId: job.id, durationSec: r.durationSec });
      log(`✓ rendered in ${((Date.now() - started) / 1000).toFixed(0)}s → ${r.fullPath}`);
    } else {
      // full-quality file from the render step; re-render if it was deleted or rendered elsewhere
      let file = fullPathFor(clip);
      if (!existsSync(file)) {
        log("  full video not on this machine — re-rendering it first");
        file = (await renderClip(clip, (m) => log(`  ${m}`))).fullPath;
      }
      const plan = await call<{ accessToken: string; metadata: UploadMetadata }>("upload-plan", { jobId: job.id });
      log(`  uploading to YouTube as ${String(plan.metadata.status.privacyStatus)}…`);
      const videoId = await uploadToYouTube(file, plan.metadata, plan.accessToken, (m) => log(`  ${m}`));
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
    const clip = JSON.parse(await readFile(args[1], "utf8")) as Clip;
    const r = await renderClip(clip, (m) => log(m));
    log(`✓ ${r.fullPath} (${r.durationSec.toFixed(1)}s), preview ${r.previewPath}`);
    return;
  }

  if (!SECRET) throw new Error("WORKER_SECRET missing (it's in .env.local)");
  log(`ClipPilot worker ${WORKER_ID} → ${API}`);

  if (args.includes("--once")) {
    if (!(await processNext())) log("no render or upload jobs waiting");
    return;
  }

  let stop = false;
  process.on("SIGINT", () => {
    log("stopping after the current job…");
    stop = true;
  });
  while (!stop) {
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
