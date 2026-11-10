import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Clip } from "../src/lib/types.ts";
import { captionFrame, chunkCaption, framePath, type Canvas } from "./captions.mts";
import { ffmpeg, probeDuration } from "./proc.mts";
import { speak } from "./tts.mts";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const OUTPUT_DIR = path.join(ROOT, "output");
export const FOOTAGE_DIR = path.join(ROOT, "footage");

const GAP = 0.25; // pause between beats (s)
const LEAD_IN = 0.3;
const TAIL = 0.8;
const BRAND = process.env.WORKER_BRAND ?? "ClipPilot";
const PREVIEW_MAX_MB = 45; // Supabase free-tier file limit is 50 MB

export interface RenderResult {
  fullPath: string;
  previewPath: string;
  durationSec: number;
  usedFootage: string | null;
}

/** Rights-safe footage YOU provide: worker/footage/<game-slug>/*.mp4 (own gameplay, official trailers). */
async function pickFootage(game: string): Promise<string | null> {
  const dir = path.join(FOOTAGE_DIR, game);
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f));
  if (files.length === 0) return null;
  return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

export async function renderClip(clip: Clip, log: (m: string) => void = console.log): Promise<RenderResult> {
  const script = clip.script;
  if (!script?.segments.length) throw new Error("Clip has no script segments");

  const vertical = clip.format === "short";
  const canvas: Canvas = vertical ? { w: 1080, h: 1920, vertical } : { w: 1920, h: 1080, vertical };
  const work = path.join(OUTPUT_DIR, clip.id, "work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  // 1. Voiceover per beat → real timeline
  log(`tts: ${script.segments.length} beats`);
  const beats: { start: number; end: number; file: string; seg: (typeof script.segments)[number] }[] = [];
  let cursor = LEAD_IN;
  for (const [i, seg] of script.segments.entries()) {
    if (!seg.voiceover.trim()) continue;
    const v = await speak(seg.voiceover, work, `vo-${i}`);
    beats.push({ start: cursor, end: cursor + v.duration, file: v.file, seg });
    cursor += v.duration + GAP;
  }
  if (beats.length === 0) throw new Error("Script has no voiceover text");
  const total = Math.round((cursor - GAP + TAIL) * 100) / 100;
  log(`timeline: ${total.toFixed(1)}s`);

  // 2. Caption frames (concat list: each image held for its duration)
  const list: string[] = [];
  let f = 0;
  let t = 0;
  const hold = async (until: number, opts: Parameters<typeof captionFrame>[2]) => {
    const d = until - t;
    if (d <= 0.01) return;
    const file = await captionFrame(framePath(work, f++), canvas, { ...opts, brand: BRAND });
    list.push(`file '${file}'`, `duration ${d.toFixed(3)}`);
    t = until;
  };
  const wordsPerChunk = vertical ? 3 : 6;
  for (const b of beats) {
    const title = b.seg.onScreenText?.trim() || undefined;
    await hold(b.start, { title });
    for (const c of chunkCaption(b.seg.voiceover, b.start, b.end - b.start, wordsPerChunk)) {
      await hold(c.end, { caption: c.text, title });
    }
  }
  await hold(total, {});
  list.push(list[list.length - 2]); // concat demuxer needs the last file repeated
  const listFile = path.join(work, "captions.txt");
  await writeFile(listFile, list.join("\n"));

  // 3. Background: your footage, else an animated gradient (always rights-safe)
  const footage = await pickFootage(clip.game);
  const bgInput: string[] = [];
  let bgFilter: string;
  if (footage) {
    const len = await probeDuration(footage);
    const offset = len > total + 5 ? Math.random() * (len - total - 2) : 0;
    bgInput.push("-ss", offset.toFixed(2), "-stream_loop", "-1", "-i", footage);
    bgFilter = `[0:v]scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h},eq=brightness=-0.06:saturation=1.1,fps=30,setsar=1[bg]`;
    log(`footage: ${path.relative(ROOT, footage)} @${offset.toFixed(1)}s`);
  } else {
    bgInput.push(
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${canvas.w}x${canvas.h}:c0=0x2a0f2e:c1=0x0d0d1a:c2=0x3a1430:c3=0x0f1638:nb_colors=4:speed=0.008:r=30:d=${total}`,
    );
    bgFilter = `[0:v]format=yuv420p,setsar=1[bg]`;
    log("footage: none in worker/footage/" + clip.game + " → animated gradient background");
  }

  // 4. One FFmpeg pass: bg + caption track + progress bar + voice mix
  const voiceInputs = beats.flatMap((b) => ["-i", b.file]);
  const firstVoice = 3; // inputs: 0 bg, 1 captions, 2 progress-bar color, 3.. voices
  const delays = beats
    .map((b, i) => `[${firstVoice + i}:a]adelay=${Math.round(b.start * 1000)}:all=1[a${i}]`)
    .join(";");
  const mix = `${beats.map((_, i) => `[a${i}]`).join("")}amix=inputs=${beats.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total},loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  const barH = vertical ? 12 : 8;
  const filter = [
    bgFilter,
    `[1:v]format=rgba[cap]`,
    `[bg][cap]overlay=0:0:eof_action=pass[v1]`,
    `[v1][2:v]overlay=x='-w+w*t/${total}':y=H-h:eval=frame[v2]`,
    delays,
    mix,
  ].join(";");

  const fullPath = path.join(OUTPUT_DIR, clip.id, `${clip.format}-full.mp4`);
  log("encoding full quality…");
  await ffmpeg([
    ...bgInput,
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-f", "lavfi", "-i", `color=c=0xff5e7e:s=${canvas.w}x${barH}:r=30:d=${total}`,
    ...voiceInputs,
    "-filter_complex", filter,
    "-map", "[v2]", "-map", "[aout]",
    "-t", String(total),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    fullPath,
  ]);

  // 5. Small preview for the dashboard (fits the 50 MB storage limit)
  const previewPath = path.join(OUTPUT_DIR, clip.id, "preview.mp4");
  const kbps = Math.max(300, Math.min(1500, Math.floor((PREVIEW_MAX_MB * 8 * 1000) / total) - 96));
  log(`encoding preview @${kbps}k…`);
  await ffmpeg([
    "-i", fullPath,
    "-vf", vertical ? "scale=720:-2" : "scale=-2:480",
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${kbps * 1.5}k`, "-bufsize", `${kbps * 2}k`,
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    previewPath,
  ]);
  const mb = (await stat(previewPath)).size / 1e6;
  if (mb > 49) throw new Error(`Preview is ${mb.toFixed(1)} MB — over the 50 MB storage limit`);

  if (!process.env.WORKER_KEEP_WORK) await rm(work, { recursive: true, force: true });
  return { fullPath, previewPath, durationSec: await probeDuration(fullPath), usedFootage: footage };
}
