import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RENDER, type Clip, type RenderSettings } from "../src/lib/types.ts";
import sharp from "sharp";
import { captionFrame, chunkCaption, framePath, type Canvas } from "./captions.mts";
import { ffmpeg, probeDuration, run } from "./proc.mts";
import { speak } from "./tts.mts";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const OUTPUT_DIR = path.join(ROOT, "output");
export const FOOTAGE_DIR = path.join(ROOT, "footage");

const GAP = 0.25; // pause between beats (s)
const LEAD_IN = 0.3;
const TAIL = 0.8;
const PREVIEW_MAX_MB = 45; // Supabase free-tier file limit is 50 MB

export const fullPathFor = (clip: Pick<Clip, "id" | "format">) => path.join(OUTPUT_DIR, clip.id, `${clip.format}-full.mp4`);

export interface RenderResult {
  fullPath: string;
  previewPath: string;
  durationSec: number;
  /** Background was cut from the source creator's video */
  testRender: boolean;
  /** Footage files used for the background (empty = gradient) */
  usedFootage: string[];
  /** Number of footage cuts in the montage */
  cuts: number;
  /** Full videos: chapter marks from the real beat timing (YouTube needs ≥3, first at 0:00, ≥10s apart) */
  chapters: { t: number; title: string }[];
  /** Full videos: 1280×720 thumbnail with the cover text */
  thumbnailPath: string | null;
}

export const thumbPathFor = (clip: Pick<Clip, "id">) => path.join(OUTPUT_DIR, clip.id, "thumbnail.jpg");

function chaptersFrom(beats: { start: number; seg: { onScreenText: string; voiceover: string } }[]): { t: number; title: string }[] {
  const out: { t: number; title: string }[] = [];
  for (const [i, b] of beats.entries()) {
    const t = i === 0 ? 0 : Math.floor(b.start);
    if (out.length && t - out[out.length - 1].t < 10) continue; // YouTube: chapters ≥ 10s apart
    const title = (b.seg.onScreenText || b.seg.voiceover.split(/\s+/).slice(0, 5).join(" ")).replace(/[\r\n]+/g, " ").trim();
    out.push({ t, title: i === 0 ? `Intro — ${title}` : title });
  }
  return out.length >= 3 ? out : [];
}

/** Thumbnail for full videos: a frame from the render, darkened, with the cover text huge. */
async function makeThumbnail(fullPath: string, out: string, text: string, total: number) {
  const frame = out.replace(/\.jpg$/, "-frame.jpg");
  await ffmpeg(["-ss", (total * 0.3).toFixed(2), "-i", fullPath, "-frames:v", "1", "-vf", "scale=1280:720,gblur=sigma=18,eq=brightness=-0.08:saturation=1.25", frame]);
  const lines = text.toUpperCase().split(/\s+/).reduce<string[]>((acc, w) => {
    const last = acc[acc.length - 1];
    if (last && (last + " " + w).length <= 12) acc[acc.length - 1] = `${last} ${w}`;
    else acc.push(w);
    return acc;
  }, []).slice(0, 3);
  const size = lines.length > 2 ? 110 : 140;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".78"/><stop offset=".7" stop-color="#000" stop-opacity=".1"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#g)"/>
    <rect x="60" y="${360 - (lines.length * size * 1.05) / 2 - 30}" width="14" height="${lines.length * size * 1.05}" fill="#ff5e7e"/>
    ${lines
      .map(
        (l, i) =>
          `<text x="100" y="${360 - (lines.length * size * 1.05) / 2 + (i + 0.82) * size * 1.05 - 30}" font-family="Impact, Anton, Arial Black, Archivo Black" font-size="${size}" fill="${i === lines.length - 1 ? "#ffd84d" : "#fff"}" stroke="#000" stroke-width="10" paint-order="stroke">${esc(l)}</text>`,
      )
      .join("")}
  </svg>`;
  await sharp(frame).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 88 }).toFile(out);
  await rm(frame, { force: true });
}

/**
 * Footage YOU provide (own gameplay, official trailers): worker/footage/<game-slug>/*.mp4 on this machine,
 * plus files uploaded in Settings → Footage (cloud storage, downloaded once into worker/cache/footage/).
 */
const CLOUD_FOOTAGE_DIR = path.join(ROOT, "cache", "footage");
export type CloudFootage = (game: string) => Promise<{ name: string; url: string; size: number }[]>;
let cloudFootage: CloudFootage | null = null;
export const setCloudFootage = (fn: CloudFootage) => (cloudFootage = fn);

async function listFootage(game: string, log: (m: string) => void = () => {}): Promise<string[]> {
  const isVideo = (f: string) => /\.(mp4|mov|mkv|webm)$/i.test(f);
  const files: string[] = [];
  const dir = path.join(FOOTAGE_DIR, game);
  if (existsSync(dir)) files.push(...(await readdir(dir)).filter(isVideo).map((f) => path.join(dir, f)));
  if (cloudFootage) {
    try {
      const remote = (await cloudFootage(game)).filter((f) => isVideo(f.name));
      const cdir = path.join(CLOUD_FOOTAGE_DIR, game);
      await mkdir(cdir, { recursive: true });
      for (const f of remote) {
        const local = path.join(cdir, path.basename(f.name));
        if (!existsSync(local) || (await stat(local)).size !== f.size) {
          log(`footage: downloading ${f.name} from Settings → Footage…`);
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`download ${f.name}: ${res.status}`);
          await writeFile(local, Buffer.from(await res.arrayBuffer()));
        }
        files.push(local);
      }
    } catch (e) {
      log(`footage: cloud footage unavailable (${e instanceof Error ? e.message : e})`);
    }
  }
  return files.sort(); // stable order → same cuts on every re-render
}

/** Small seeded RNG (mulberry32) so a clip's montage is identical when re-rendered for upload. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marker in a clip's output folder: background came from the source creator's video. */
export const sourceFlagFor = (clip: Pick<Clip, "id" | "format">) => path.join(path.dirname(fullPathFor(clip)), "SOURCE_FOOTAGE");
const SOURCE_DIR = path.join(ROOT, "cache", "sources");

function youtubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/** TEST ONLY: download (≤720p, first 15 min) the trend's own video with yt-dlp. */
async function sourceFootage(clip: Clip, log: (m: string) => void): Promise<string[]> {
  const id = youtubeId(clip.trendUrl ?? "");
  if (!id) return [];
  const file = path.join(SOURCE_DIR, `${id}.mp4`);
  if (!existsSync(file)) {
    await mkdir(SOURCE_DIR, { recursive: true });
    log(`footage: downloading source video ${id} (test mode)…`);
    try {
      await run("yt-dlp", [
        "-q", "--no-playlist", "--no-warnings",
        "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b",
        "--merge-output-format", "mp4",
        "--download-sections", "*0-900",
        "-o", file,
        `https://www.youtube.com/watch?v=${id}`,
      ], { quiet: true });
    } catch (e) {
      log(`footage: source download failed (${e instanceof Error ? e.message.split("\n")[0] : e}) — is yt-dlp installed? (brew install yt-dlp)`);
      return [];
    }
  }
  return existsSync(file) ? [file] : [];
}

async function hasAudio(file: string): Promise<boolean> {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return out.trim().length > 0;
}

const MAX_CUTS = 400;

/**
 * Background montage from your footage: random pieces of at most `maxCutSec` seconds each, drawn from
 * all files for the game, so no single source plays for long. Optional footage audio (low volume).
 * Each piece is normalized (size, fps, audio format) and the pieces are joined with the concat demuxer.
 */
async function buildMontage(
  files: string[],
  total: number,
  canvas: Canvas,
  r: RenderSettings,
  work: string,
  log: (m: string) => void,
  seed: string,
): Promise<{ file: string; cuts: number }> {
  const random = seededRandom(seed);
  const meta = await Promise.all(files.map(async (f) => ({ f, len: await probeDuration(f), audio: await hasAudio(f) })));
  const usable = meta.filter((m) => m.len >= 1);
  if (!usable.length) throw new Error("Footage files are shorter than 1 second");

  const cut = r.maxCutSec > 0 ? r.maxCutSec : total;
  const vf = `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h},eq=brightness=-0.06:saturation=1.1,fps=30,setsar=1,format=yuv420p`;
  const pieces: string[] = [];
  let covered = 0;
  let last = -1;
  while (covered < total - 0.01) {
    if (pieces.length >= MAX_CUTS) throw new Error(`Montage would need over ${MAX_CUTS} cuts — raise "max seconds per cut"`);
    // random file (avoid repeating the previous one when there's a choice)
    let idx = Math.floor(random() * usable.length);
    if (usable.length > 1 && idx === last) idx = (idx + 1) % usable.length;
    last = idx;
    const m = usable[idx];
    const len = Math.min(cut, m.len - 0.2, total - covered + 0.05);
    const offset = random() * Math.max(0, m.len - len - 0.1);
    const out = path.join(work, `bg-${String(pieces.length).padStart(4, "0")}.mp4`);
    const audioIn = r.keepFootageAudio && !m.audio ? ["-f", "lavfi", "-t", len.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"] : [];
    const audioOut = r.keepFootageAudio
      ? ["-map", m.audio ? "0:a:0" : "1:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k"]
      : ["-an"];
    await ffmpeg([
      "-ss", offset.toFixed(3), "-t", len.toFixed(3), "-i", m.f,
      ...audioIn,
      "-map", "0:v:0", "-vf", vf,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
      ...audioOut,
      "-t", len.toFixed(3),
      out,
    ]);
    pieces.push(out);
    covered += len;
  }
  const list = path.join(work, "bg.txt");
  await writeFile(list, pieces.map((p) => `file '${p}'`).join("\n"));
  const file = path.join(work, "bg.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", file]);
  log(`footage: ${pieces.length} cut(s) ≤${cut.toFixed(1)}s from ${usable.length} file(s)${r.keepFootageAudio ? `, footage audio ${r.footageVolume}%` : ", no footage audio"}`);
  return { file, cuts: pieces.length };
}

export async function renderClip(
  clip: Clip,
  log: (m: string) => void = console.log,
  r: RenderSettings = DEFAULT_RENDER,
): Promise<RenderResult> {
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
    const v = await speak(seg.voiceover, work, `vo-${i}`, { voice: clip.script?.voice || r.voice, rate: r.voiceRate });
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
    const file = await captionFrame(framePath(work, f++), canvas, { ...opts, brand: r.brandText || undefined });
    list.push(`file '${file}'`, `duration ${d.toFixed(3)}`);
    t = until;
  };
  const wordsPerChunk = vertical ? r.captionWords : r.captionWords * 2;
  for (const b of beats) {
    const title = b.seg.onScreenText?.trim() || undefined;
    await hold(b.start, { title });
    for (const c of chunkCaption(b.seg.voiceover, b.start, b.end - b.start, wordsPerChunk)) {
      await hold(c.end, { caption: c.text, title, emphasis: b.seg.emphasis });
    }
  }
  await hold(total, {});
  list.push(list[list.length - 2]); // concat demuxer needs the last file repeated
  const listFile = path.join(work, "captions.txt");
  await writeFile(listFile, list.join("\n"));

  // 3. Background: montage of your footage (short cuts), else an animated gradient (always rights-safe)
  let footage: string[] = [];
  let testRender = false;
  const flag = sourceFlagFor(clip);
  await mkdir(path.dirname(flag), { recursive: true });
  await rm(flag, { force: true });
  if (r.footageMode === "source") {
    footage = await sourceFootage(clip, log);
    testRender = footage.length > 0;
    if (footage.length) await writeFile(flag, `rendered from ${clip.trendUrl} — source footage\n`);
    else footage = await listFootage(clip.game, log);
  } else if (r.footageMode === "auto") footage = await listFootage(clip.game, log);
  const bgInput: string[] = [];
  let bgFilter: string;
  let cuts = 0;
  let footageAudio = false;
  if (footage.length) {
    const m = await buildMontage(footage, total, canvas, r, work, log, `${clip.id}:${r.maxCutSec}`);
    cuts = m.cuts;
    footageAudio = r.keepFootageAudio;
    bgInput.push("-i", m.file);
    bgFilter = `[0:v]setpts=PTS-STARTPTS,format=yuv420p[bg]`;
  } else {
    bgInput.push(
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${canvas.w}x${canvas.h}:c0=0x2a0f2e:c1=0x0d0d1a:c2=0x3a1430:c3=0x0f1638:nb_colors=4:speed=0.008:r=30:d=${total}`,
    );
    bgFilter = `[0:v]format=yuv420p,setsar=1[bg]`;
    log(r.footageMode === "gradient" ? "footage: off (gradient mode)" : `footage: none in worker/footage/${clip.game} → animated gradient background`);
  }

  // 4. One FFmpeg pass: bg + caption track + progress bar + voice mix
  const voiceInputs = beats.flatMap((b) => ["-i", b.file]);
  const firstVoice = 3; // inputs: 0 bg, 1 captions, 2 progress-bar color, 3.. voices
  const delays = beats
    .map((b, i) => `[${firstVoice + i}:a]adelay=${Math.round(b.start * 1000)}:all=1[a${i}]`)
    .join(";");
  // optional footage sound, ducked well under the voice
  const bed = footageAudio ? `[0:a]volume=${(r.footageVolume / 100).toFixed(2)},apad[bed];` : "";
  const mixInputs = beats.map((_, i) => `[a${i}]`).join("") + (footageAudio ? "[bed]" : "");
  const mix = `${bed}${mixInputs}amix=inputs=${beats.length + (footageAudio ? 1 : 0)}:normalize=0:dropout_transition=0,apad,atrim=0:${total},loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  const barH = vertical ? 12 : 8;
  const filter = [
    bgFilter,
    `[1:v]format=rgba[cap]`,
    `[bg][cap]overlay=0:0:eof_action=pass[v1]`,
    `[v1][2:v]overlay=x='-w+w*t/${total}':y=H-h:eval=frame[v2]`,
    delays,
    mix,
  ].join(";");

  const fullPath = fullPathFor(clip);
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

  let thumbnailPath: string | null = null;
  if (!vertical && script.thumbnailText) {
    thumbnailPath = thumbPathFor(clip);
    await makeThumbnail(fullPath, thumbnailPath, script.thumbnailText, total).catch((e) => {
      log(`thumbnail skipped: ${e instanceof Error ? e.message : e}`);
      thumbnailPath = null;
    });
  }

  if (!process.env.WORKER_KEEP_WORK) await rm(work, { recursive: true, force: true });
  return {
    fullPath,
    previewPath,
    durationSec: await probeDuration(fullPath),
    usedFootage: footage,
    testRender,
    cuts,
    chapters: vertical ? [] : chaptersFrom(beats),
    thumbnailPath,
  };
}
