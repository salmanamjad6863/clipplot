import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RENDER, type Clip, type EditMoment, type RenderSettings } from "../src/lib/types.ts";
import sharp from "sharp";
import { STYLES, captionFrame, chunkCaption, framePath, type Canvas, type CaptionStyle } from "./captions.mts";
import { sfxFile, type Sfx } from "./sfx.mts";
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
  /** Attribution lines for Creative Commons visuals actually used (go into the YouTube description) */
  credits: string[];
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

/* ---------- free stock video (Pixabay / Pexels) — searched by the server, downloaded + cached here ---------- */
const STOCK_DIR = path.join(ROOT, "cache", "stock");
export type StockSearch = (
  queries: string[],
  portrait: boolean,
) => Promise<{ id: string | number; url: string; kind?: "video" | "image"; duration?: number; bytes?: number; credit?: string }[]>;
/** Attribution lines for files that need one (Creative Commons) — added to the YouTube description. */
const CREDITS = new Map<string, string>();
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const BIG_VIDEO_BYTES = 60 * 1024 * 1024;
let stockSearch: StockSearch | null = null;
export const setStockSearch = (fn: StockSearch) => (stockSearch = fn);

/** Mood searches for clips scripted before stockQueries existed. No game names — stock sites don't have them. */
const STOCK_DEFAULTS: Record<string, string[]> = {
  "gta-6": ["miami night skyline", "sports car night", "police lights", "palm trees beach", "neon city street"],
  "gta-5": ["los angeles freeway", "sports car racing", "city night timelapse", "police chase", "luxury mansion"],
  rdr2: ["wild west horse", "desert sunset", "cowboy riding", "old town western", "mountain river"],
  minecraft: ["forest aerial", "building blocks", "cave exploration", "village sunrise"],
  fortnite: ["colorful arcade lights", "gaming setup neon", "fireworks night", "esports crowd"],
  "call-of-duty": ["military helicopter", "soldier silhouette", "explosion smoke", "tactical training"],
  "elden-ring": ["dark castle", "medieval knight", "foggy forest", "dragon fire"],
  roblox: ["video game controller", "colorful toys", "kids gaming fun", "city blocks aerial"],
  "gaming-news": ["gaming setup neon", "video game controller", "esports arena crowd", "computer screen glow"],
  valorant: ["neon tactical", "esports arena crowd", "gaming setup rgb"],
  "ea-fc": ["football stadium", "soccer goal celebration", "football fans cheering"],
  pokemon: ["colorful nature meadow", "anime style city", "card collection"],
  nintendo: ["handheld game console", "colorful arcade", "family gaming fun"],
  cs2: ["tactical training", "esports arena crowd", "gaming setup rgb"],
  apex: ["futuristic city", "explosion smoke", "esports arena crowd"],
  "marvel-rivals": ["superhero city night", "comic style action", "explosion smoke"],
  genshin: ["fantasy landscape", "anime style sky", "magical forest"],
  "funny-gaming": ["funny gamer reaction", "gaming setup neon", "controller throw"],
};

async function stockFootage(clip: Clip, vertical: boolean, log: (m: string) => void): Promise<string[]> {
  if (!stockSearch) return [];
  const queries = clip.script?.stockQueries?.length
    ? clip.script.stockQueries
    : (STOCK_DEFAULTS[clip.game] ?? ["video game controller", "gaming setup neon", "city night timelapse"]);
  try {
    const found = (await stockSearch(queries, vertical)).slice(0, 10);
    if (!found.length) return [];
    await mkdir(STOCK_DIR, { recursive: true });
    const files: string[] = [];
    for (const v of found) {
      const safeId = String(v.id).replace(/[^\w-]/g, "").slice(0, 60);
      const image = v.kind === "image";
      const file = path.join(STOCK_DIR, image ? `${safeId}.jpg` : `${safeId}-${vertical ? "v" : "h"}.mp4`);
      try {
        if (!existsSync(file)) {
          if (image) {
            const res = await fetch(v.url, { signal: AbortSignal.timeout(30_000) });
            if (!res.ok) continue;
            // normalize any image format to a sane-size JPEG
            await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(file);
          } else if ((v.bytes ?? 0) > BIG_VIDEO_BYTES && v.duration) {
            // huge file (e.g. a 4K Commons video): grab just 20s from the middle over HTTP, 1080p H.264
            const start = Math.max(0, v.duration / 2 - 10);
            await ffmpeg(["-ss", start.toFixed(1), "-t", "20", "-i", v.url, "-an", "-vf", "scale=-2:1080", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", file]);
          } else {
            const res = await fetch(v.url, { signal: AbortSignal.timeout(90_000) });
            if (!res.ok) continue;
            await writeFile(file, Buffer.from(await res.arrayBuffer()));
          }
        }
        if (v.credit) CREDITS.set(file, v.credit);
        files.push(file);
      } catch (e) {
        log(`footage: skipped one stock item (${e instanceof Error ? e.message.split("\n")[0] : e})`);
        await rm(file, { force: true });
      }
    }
    if (files.length) {
      const imgs = files.filter((f) => IMAGE_RE.test(f)).length;
      log(`footage: ${files.length - imgs} stock video(s) + ${imgs} image(s) for "${queries.slice(0, 3).join(", ")}"…`);
    }
    return files;
  } catch (e) {
    log(`footage: stock video unavailable (${e instanceof Error ? e.message : e})`);
    return [];
  }
}

/* ---------- background music: your library (Settings → Music) or free CC0/CC BY music ---------- */
const MUSIC_DIR = path.join(ROOT, "cache", "music");
export type MusicSearch = (mood: string) => Promise<{ id: string; url: string; credit: string | null }[]>;
let musicSearch: MusicSearch | null = null;
export const setMusicSearch = (fn: MusicSearch) => (musicSearch = fn);

async function pickMusic(mood: string, seed: string, log: (m: string) => void): Promise<{ file: string; credit: string | null } | null> {
  if (!musicSearch) return null;
  try {
    const tracks = await musicSearch(mood);
    if (!tracks.length) return null;
    const rnd = seededRandom(`music:${seed}`);
    // try a couple in seeded order (some free hosts are slow/flaky)
    const order = [...tracks].sort(() => rnd() - 0.5).slice(0, 3);
    await mkdir(MUSIC_DIR, { recursive: true });
    for (const t of order) {
      const file = path.join(MUSIC_DIR, `${t.id.replace(/[^\w-]/g, "_").slice(-60)}.audio`);
      try {
        if (!existsSync(file)) {
          const res = await fetch(t.url, { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) continue;
          await writeFile(file, Buffer.from(await res.arrayBuffer()));
        }
        if ((await probeDuration(file)) < 10) continue;
        log(`music: ${mood} — ${t.credit ?? path.basename(t.id)}`);
        return { file, credit: t.credit };
      } catch {
        await rm(file, { force: true });
      }
    }
  } catch (e) {
    log(`music: unavailable (${e instanceof Error ? e.message : e})`);
  }
  return null;
}

/** Original trend clip → a 9:16/16:9 "receipt": the clip fitted over a blurred copy of itself, with its audio. */
async function cutReceipt(source: string, offset: number, len: number, canvas: Canvas, out: string) {
  const { w, h } = canvas;
  const audio = await hasAudio(source);
  await ffmpeg([
    "-ss", offset.toFixed(2), "-t", len.toFixed(2), "-i", source,
    ...(audio ? [] : ["-f", "lavfi", "-t", len.toFixed(2), "-i", "anullsrc=r=48000:cl=stereo"]),
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=28:4,eq=brightness=-0.18[bg];` +
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,setsar=1,format=yuv420p[v]`,
    "-map", "[v]", "-map", audio ? "0:a:0" : "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-t", len.toFixed(2),
    out,
  ]);
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
    log(`footage: downloading source video ${id}…`);
    const base = [
      "-q", "--no-playlist", "--no-warnings", "-N", "4",
      "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b",
      "--merge-output-format", "mp4",
      "-o", file,
      `https://www.youtube.com/watch?v=${id}`,
    ];
    try {
      // whole video is fastest (parallel fragments); huge/long ones fall back to the first 15 minutes
      await run("yt-dlp", [...base, "--max-filesize", "450M"], { quiet: true }).catch(() => undefined);
      if (!existsSync(file)) await run("yt-dlp", [...base, "--download-sections", "*0-900"], { quiet: true });
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
): Promise<{ file: string; cuts: number; used: string[] }> {
  const random = seededRandom(seed);
  // stills (stock photos) count as "infinitely long" with no audio; they get a slow zoom instead of a cut
  const meta = await Promise.all(
    files.map(async (f) =>
      IMAGE_RE.test(f) ? { f, len: 3600, audio: false, image: true } : { f, len: await probeDuration(f), audio: await hasAudio(f), image: false },
    ),
  );
  const used = new Set<string>();
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
    const len = Math.min(m.image ? Math.max(cut, 2.5) : cut, m.len - 0.2, total - covered + 0.05);
    used.add(m.f);
    const offset = random() * Math.max(0, m.len - len - 0.1);
    const out = path.join(work, `bg-${String(pieces.length).padStart(4, "0")}.mp4`);
    const audioIn = r.keepFootageAudio && !m.audio ? ["-f", "lavfi", "-t", len.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"] : [];
    const audioOut = r.keepFootageAudio
      ? ["-map", m.audio ? "0:a:0" : "1:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k"]
      : ["-an"];
    // still image → slow push-in (zoom from 1.0 to ~1.12), direction varies per cut
    const frames = Math.max(2, Math.round(len * 30));
    const pan = random() < 0.5 ? "iw/2-(iw/zoom/2)" : `(iw-iw/zoom)*on/${frames}`;
    const kenBurns = `scale=${canvas.w * 2}:${canvas.h * 2}:force_original_aspect_ratio=increase,crop=${canvas.w * 2}:${canvas.h * 2},zoompan=z='1+0.12*on/${frames}':x='${pan}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${canvas.w}x${canvas.h}:fps=30,eq=brightness=-0.06:saturation=1.1,setsar=1,format=yuv420p`;
    await ffmpeg([
      ...(m.image ? ["-i", m.f] : ["-ss", offset.toFixed(3), "-t", len.toFixed(3), "-i", m.f]),
      ...audioIn,
      "-map", "0:v:0", "-vf", m.image ? kenBurns : vf,
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
  return { file, cuts: pieces.length, used: [...used] };
}

export async function renderClip(
  clip: Clip,
  log: (m: string) => void = console.log,
  r: RenderSettings = DEFAULT_RENDER,
): Promise<RenderResult> {
  const script = clip.script;
  if (script?.style === "edit") return renderEdit(clip, log, r);
  if (!script?.segments.length) throw new Error("Clip has no script segments");

  const vertical = clip.format === "short";
  const canvas: Canvas = vertical ? { w: 1080, h: 1920, vertical } : { w: 1920, h: 1080, vertical };
  const work = path.join(OUTPUT_DIR, clip.id, "work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  const style: CaptionStyle = STYLES[Math.floor(seededRandom(`style:${clip.id}`)() * STYLES.length)];
  const fxOn = r.effects !== false;

  // 0. Receipts need the original clip (Mac worker; downloads are often blocked in the cloud)
  let source: string | null = null;
  let srcLen = 0;
  if (r.receipts !== false && script.segments.some((s) => (s.receipt ?? 0) > 0)) {
    source = (await sourceFootage(clip, log))[0] ?? null;
    srcLen = source ? await probeDuration(source) : 0;
    if (!source || srcLen < 8) {
      log("receipts: original clip unavailable — skipped");
      source = null;
    }
  }

  // 1. Voiceover per beat (host A / host B voices) + receipt windows → real timeline
  log(`tts: ${script.segments.length} beats, style "${style.name}"`);
  const beats: { start: number; end: number; file: string; seg: (typeof script.segments)[number] }[] = [];
  const receipts: { start: number; end: number; offset: number; file?: string }[] = [];
  const voiceA = clip.script?.voice || r.voice;
  const voiceB = r.voiceB || DEFAULT_RENDER.voiceB;
  const rnd = seededRandom(`receipts:${clip.id}`);
  let cursor = LEAD_IN;
  let lastSpeaker: string | undefined;
  for (const [i, seg] of script.segments.entries()) {
    const want = Math.min(6, seg.receipt ?? 0);
    if (source && want >= 2 && receipts.length < 3) {
      // spread receipts over the source: early, middle, late moments
      const zone = (0.12 + 0.3 * receipts.length + rnd() * 0.15) * Math.max(0, srcLen - want - 1);
      receipts.push({ start: cursor, end: cursor + want, offset: Math.max(0, zone) });
      cursor += want + 0.15;
      lastSpeaker = undefined;
    }
    if (!seg.voiceover.trim()) continue;
    const speaker = seg.speaker ?? "A";
    const v = await speak(seg.voiceover, work, `vo-${i}`, { voice: speaker === "B" ? voiceB : voiceA, rate: r.voiceRate });
    // quick back-and-forth between hosts feels like a real conversation
    if (lastSpeaker && lastSpeaker !== speaker) cursor -= GAP * 0.6;
    beats.push({ start: cursor, end: cursor + v.duration, file: v.file, seg });
    cursor += v.duration + GAP;
    lastSpeaker = speaker;
  }
  if (beats.length === 0) throw new Error("Script has no voiceover text");
  const total = Math.round((cursor - GAP + TAIL) * 100) / 100;
  for (const [k, rc] of receipts.entries()) {
    rc.file = path.join(work, `receipt-${k}.mp4`);
    await cutReceipt(source!, rc.offset, rc.end - rc.start, canvas, rc.file);
  }
  log(`timeline: ${total.toFixed(1)}s${receipts.length ? `, ${receipts.length} receipt(s)` : ""}`);

  // 2. Caption frames (concat list: each image held for its duration)
  const list: string[] = [];
  let f = 0;
  let t = 0;
  const hold = async (until: number, opts: Parameters<typeof captionFrame>[2]) => {
    const d = until - t;
    if (d <= 0.01) return;
    const file = await captionFrame(framePath(work, f++), canvas, opts);
    list.push(`file '${file}'`, `duration ${d.toFixed(3)}`);
    t = until;
  };
  const wordsPerChunk = vertical ? r.captionWords : r.captionWords * 2;
  const channel = script.sources?.[0]?.channel;
  const badge = `Original clip${channel ? ` · ${channel}` : ""}`.slice(0, 40);
  type Ev = { start: number; end: number; beat?: (typeof beats)[number] };
  const events: Ev[] = [...beats.map((b) => ({ start: b.start, end: b.end, beat: b })), ...receipts.map((rc) => ({ start: rc.start, end: rc.end }))].sort(
    (a, b) => a.start - b.start,
  );
  const base = { brand: r.brandText || undefined, style };
  for (const ev of events) {
    if (ev.start < t) continue; // overlapping host hand-off: keep the earlier caption
    await hold(ev.start, base);
    if (!ev.beat) {
      await hold(ev.end, { ...base, badge });
      continue;
    }
    const b = ev.beat;
    const title = b.seg.onScreenText?.trim() || undefined;
    const meme = fxOn ? b.seg.memeText?.trim() || (b.seg.fx === "wait" ? "WAIT…" : undefined) : undefined;
    const speaker = { name: (b.seg.speaker === "B" ? r.hostB : r.hostA) || (b.seg.speaker === "B" ? "Zoe" : "Max"), host: b.seg.speaker ?? "A" } as const;
    for (const c of chunkCaption(b.seg.voiceover, b.start, b.end - b.start, wordsPerChunk)) {
      await hold(c.end, { ...base, caption: c.text, title, emphasis: b.seg.emphasis, meme, speaker });
    }
  }
  await hold(total, base);
  list.push(list[list.length - 2]); // concat demuxer needs the last file repeated
  const listFile = path.join(work, "captions.txt");
  await writeFile(listFile, list.join("\n"));

  // 3. Background: montage of your footage (short cuts), else an animated gradient (always rights-safe)
  let footage: string[] = [];
  let testRender = false;
  const flag = sourceFlagFor(clip);
  await mkdir(path.dirname(flag), { recursive: true });
  await rm(flag, { force: true });
  // chain: source video → your footage → free stock video → animated gradient
  if (r.footageMode === "source") {
    footage = await sourceFootage(clip, log);
    testRender = footage.length > 0;
    if (footage.length) await writeFile(flag, `rendered from ${clip.trendUrl} — source footage\n`);
  }
  if (!footage.length && (r.footageMode === "source" || r.footageMode === "auto")) footage = await listFootage(clip.game, log);
  if (!footage.length && r.footageMode !== "gradient") footage = await stockFootage(clip, vertical, log);
  const bgInput: string[] = [];
  let bgFilter: string;
  let cuts = 0;
  let footageAudio = false;
  let credits: string[] = [];
  if (footage.length) {
    const m = await buildMontage(footage, total, canvas, r, work, log, `${clip.id}:${r.maxCutSec}`);
    cuts = m.cuts;
    credits = [...new Set(m.used.map((f) => CREDITS.get(f)).filter((c): c is string => !!c))];
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
    log(r.footageMode === "gradient" ? "footage: off (gradient mode)" : `footage: none found (own / stock) for ${clip.game} → animated gradient background`);
  }

  // 4. One FFmpeg pass: bg (+ receipts, edit fx) + caption track + progress bar + voices, sfx, music
  const music = r.music !== false ? await pickMusic(script.musicMood ?? "hype", clip.id, log) : null;
  if (music?.credit) credits = [...credits, `Music: ${music.credit}`];
  const sfxBeats = fxOn ? beats.filter((b) => b.seg.sfx && b.seg.sfx !== "none") : [];
  const sfxFiles = await Promise.all(sfxBeats.map((b) => sfxFile(b.seg.sfx as Sfx)));

  // input indexes: 0 bg, 1 captions, 2 bar, then voices, sfx, receipts, music
  const inputs: string[] = [];
  const firstVoice = 3;
  inputs.push(...beats.flatMap((b) => ["-i", b.file]));
  const firstSfx = firstVoice + beats.length;
  inputs.push(...sfxFiles.flatMap((f) => ["-i", f]));
  const firstReceipt = firstSfx + sfxFiles.length;
  inputs.push(...receipts.flatMap((rc) => ["-i", rc.file!]));
  const musicIdx = firstReceipt + receipts.length;
  if (music) inputs.push("-stream_loop", "-1", "-i", music.file);

  const vf: string[] = [bgFilter];
  // receipts: the original clip full-screen over the background, in their time windows
  let cur = "bg";
  receipts.forEach((rc, k) => {
    vf.push(`[${firstReceipt + k}:v]setpts=PTS-STARTPTS+${rc.start.toFixed(3)}/TB[rv${k}]`);
    vf.push(`[${cur}][rv${k}]overlay=0:0:eof_action=pass:enable='between(t,${rc.start.toFixed(3)},${rc.end.toFixed(3)})'[bgr${k}]`);
    cur = `bgr${k}`;
  });
  // editor fx: punch zoom-ins, shakes, "wait" (zoom + black & white) — on the picture, under the captions
  const fxBeats = fxOn ? beats.filter((b) => b.seg.fx && b.seg.fx !== "none") : [];
  if (fxBeats.length) {
    const win = (a: number, d: number) => `between(it,${a.toFixed(3)},${(a + d).toFixed(3)})`;
    const decay = (a: number, d: number) => `(1-(it-${a.toFixed(3)})/${d})`;
    const z = fxBeats
      .map((b) => {
        const a = b.start;
        if (b.seg.fx === "punch") return `${win(a, 0.45)}*0.16*${decay(a, 0.45)}`;
        if (b.seg.fx === "shake") return `${win(a, 0.5)}*0.08`;
        return `${win(a, 0.8)}*0.22`; // wait
      })
      .join("+");
    const shake = fxBeats
      .filter((b) => b.seg.fx === "shake")
      .map((b) => `${win(b.start, 0.5)}*22*sin(it*90)*${decay(b.start, 0.5)}`)
      .join("+") || "0";
    vf.push(
      `[${cur}]zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)+(${shake})':y='ih/2-(ih/zoom/2)+(${shake})*0.6':d=1:s=${canvas.w}x${canvas.h}:fps=30[zp]`,
    );
    cur = "zp";
    const waits = fxBeats.filter((b) => b.seg.fx === "wait");
    if (waits.length) {
      vf.push(`[${cur}]hue=s=0:enable='${waits.map((b) => `between(t,${b.start.toFixed(3)},${(b.start + 0.8).toFixed(3)})`).join("+")}'[bw]`);
      cur = "bw";
    }
  }
  const barH = vertical ? 12 : 8;
  vf.push(`[1:v]format=rgba[cap]`, `[${cur}][cap]overlay=0:0:eof_action=pass[v1]`, `[v1][2:v]overlay=x='-w+w*t/${total}':y=H-h:eval=frame[v2]`);

  // audio: speech bus (voices + receipt audio) ducks the music; sfx + footage bed on top
  const af: string[] = [];
  beats.forEach((b, i) => af.push(`[${firstVoice + i}:a]adelay=${Math.round(b.start * 1000)}:all=1[a${i}]`));
  receipts.forEach((rc, k) => af.push(`[${firstReceipt + k}:a]adelay=${Math.round(rc.start * 1000)}:all=1,volume=0.9[ra${k}]`));
  sfxBeats.forEach((b, k) => af.push(`[${firstSfx + k}:a]adelay=${Math.round(Math.max(0, b.start - 0.08) * 1000)}:all=1,volume=0.55[sx${k}]`));
  const speech = [...beats.map((_, i) => `[a${i}]`), ...receipts.map((_, k) => `[ra${k}]`)];
  af.push(`${speech.join("")}amix=inputs=${speech.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total}${music ? ",asplit=2[speech][key]" : "[speech]"}`);
  const extra: string[] = sfxBeats.map((_, k) => `[sx${k}]`);
  if (music) {
    const mv = ((r.musicVolume ?? 22) / 100).toFixed(2);
    af.push(
      `[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},volume=${mv},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[mus]`,
      `[mus][key]sidechaincompress=threshold=0.015:ratio=9:attack=15:release=380[duck]`,
    );
    extra.push("[duck]");
  }
  // apad must be bounded (atrim) — an endless bed makes amix wait forever and the render never finishes
  if (footageAudio) {
    af.push(`[0:a]volume=${(r.footageVolume / 100).toFixed(2)},apad,atrim=0:${total}[bed]`);
    extra.push("[bed]");
  }
  const all = ["[speech]", ...extra];
  af.push(`${all.join("")}amix=inputs=${all.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total},loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  const filter = [...vf, ...af].join(";");

  const fullPath = fullPathFor(clip);
  log(`encoding full quality…${fxBeats.length ? ` (${fxBeats.length} fx` : ""}${sfxBeats.length ? `, ${sfxBeats.length} sfx` : ""}${fxBeats.length ? ")" : ""}${music ? " + music" : ""}`);
  await ffmpeg([
    ...bgInput,
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-f", "lavfi", "-i", `color=c=${style.accent.replace("#", "0x")}:s=${canvas.w}x${barH}:r=30:d=${total}`,
    ...inputs,
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
    credits,
    cuts,
    chapters: vertical ? [] : chaptersFrom(beats),
    thumbnailPath,
  };
}

/* =====================================================================================================
 * PURE EDITS — the original video's best moments with its own voice/audio. No voiceover.
 * Transcript = YouTube's subtitles (via yt-dlp); Claude (on the server) picks the moments from it.
 * ===================================================================================================== */

export type EditPlanner = (transcript: { start: number; end: number; text: string }[], durationSec: number) => Promise<{
  title: string;
  hookText: string;
  musicMood: string;
  moments: EditMoment[];
}>;
let editPlanner: EditPlanner | null = null;
export const setEditPlanner = (fn: EditPlanner | null) => (editPlanner = fn);

/** YouTube subtitles (manual or auto) as WebVTT next to the cached source. */
async function fetchSubs(videoId: string, log: (m: string) => void): Promise<string | null> {
  await mkdir(SOURCE_DIR, { recursive: true });
  const find = async () => (await readdir(SOURCE_DIR)).find((f) => f.startsWith(`${videoId}.`) && f.endsWith(".vtt"));
  let f = await find();
  if (!f) {
    try {
      await run(
        "yt-dlp",
        ["-q", "--no-warnings", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en", "--sub-format", "vtt", "-o", path.join(SOURCE_DIR, videoId), `https://www.youtube.com/watch?v=${videoId}`],
        { quiet: true },
      );
    } catch (e) {
      log(`edit: subtitles unavailable (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }
    f = await find();
  }
  return f ? path.join(SOURCE_DIR, f) : null;
}

const vttTime = (s: string) => {
  const p = s.trim().split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

/** WebVTT → clean lines. YouTube auto-subs repeat each line twice (rolling); keep only new text. */
export function parseVtt(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    const start = vttTime(a);
    const end = vttTime(b.split(" ").filter(Boolean)[0]);
    const body = lines.slice(ti + 1);
    // auto-subs: the line with inline word timings (<00:00:01.234><c>) is the new text
    const timed = body.filter((l) => /<\d\d:\d\d/.test(l));
    const raw = (timed.length ? timed : body).join(" ");
    const clean = raw.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
    if (!clean || end - start < 0.05) continue;
    const prev = out[out.length - 1];
    if (prev && (prev.text === clean || prev.text.endsWith(clean))) {
      prev.end = Math.max(prev.end, end);
      continue;
    }
    out.push({ start, end, text: clean });
  }
  return out;
}

async function renderEdit(clip: Clip, log: (m: string) => void, r: RenderSettings): Promise<RenderResult> {
  const script = clip.script!;
  const canvas: Canvas = { w: 1080, h: 1920, vertical: true };
  const work = path.join(OUTPUT_DIR, clip.id, "work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const style: CaptionStyle = STYLES[Math.floor(seededRandom(`style:${clip.id}`)() * STYLES.length)];
  const fxOn = r.effects !== false;

  // 1. original video (+ its audio) and transcript
  const source = (await sourceFootage(clip, log))[0];
  if (!source) throw new Error("Pure edit needs the original video — download failed (yt-dlp blocked? try the Mac worker)");
  const srcLen = await probeDuration(source);
  const vid = youtubeId(clip.trendUrl ?? "");
  const vtt = vid ? await fetchSubs(vid, log) : null;
  const transcript = vtt ? parseVtt(await readFile(vtt, "utf8")).filter((c) => c.start < srcLen) : [];
  log(`edit: source ${srcLen.toFixed(0)}s, transcript ${transcript.length} line(s)`);

  // 2. moments: reuse a saved plan on re-render, else ask Claude (server), else spread evenly
  let moments = script.moments ?? [];
  let hookText = script.hookText ?? "";
  let mood = script.musicMood ?? "hype";
  if (!moments.length && editPlanner) {
    const plan = await editPlanner(transcript, srcLen);
    moments = plan.moments;
    hookText = plan.hookText;
    mood = plan.musicMood as typeof mood;
    log(`edit: Claude picked ${moments.length} moment(s) — "${plan.title}"`);
  }
  if (!moments.length) {
    const len = Math.min(7, srcLen / 5);
    moments = [0.1, 0.35, 0.6, 0.82].map((p) => ({ start: p * (srcLen - len), end: p * (srcLen - len) + len }));
  }
  moments = moments.map((m) => ({ ...m, start: Math.max(0, Math.min(m.start, srcLen - 1)), end: Math.min(srcLen, m.end) })).filter((m) => m.end - m.start >= 1);

  // 3. cut each moment (fitted over a blurred copy, original audio) and join
  const pieces: string[] = [];
  const at: number[] = [];
  let total = 0;
  for (const [k, m] of moments.entries()) {
    const out = path.join(work, `m-${k}.mp4`);
    await cutReceipt(source, m.start, m.end - m.start, canvas, out);
    pieces.push(out);
    at.push(total);
    total += await probeDuration(out);
  }
  total = Math.round(total * 100) / 100;
  const joinList = path.join(work, "moments.txt");
  await writeFile(joinList, pieces.map((p) => `file '${p}'`).join("\n"));
  const main = path.join(work, "main.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", joinList, "-c", "copy", main]);
  log(`edit: ${moments.length} moment(s), ${total.toFixed(1)}s`);

  // 4. caption track: the speaker's own words (from subtitles) + hook text + meme lines
  const list: string[] = [];
  let f = 0;
  let t = 0;
  const channel = script.sources?.[0]?.channel;
  const base = { brand: r.brandText || undefined, style, title: hookText || undefined, badge: channel ? `via ${channel}`.slice(0, 36) : undefined };
  const hold = async (until: number, opts: Parameters<typeof captionFrame>[2]) => {
    const d = until - t;
    if (d <= 0.01) return;
    const file = await captionFrame(framePath(work, f++), canvas, opts);
    list.push(`file '${file}'`, `duration ${d.toFixed(3)}`);
    t = until;
  };
  for (const [k, m] of moments.entries()) {
    const off = at[k] - m.start; // source time → output time
    const memeUntil = at[k] + 2.5;
    const meme = fxOn ? m.memeText || m.caption || (m.fx === "wait" ? "WAIT…" : undefined) : m.caption || undefined;
    await hold(at[k], base);
    for (const c of transcript.filter((c) => c.end > m.start && c.start < m.end)) {
      const s = Math.max(at[k], c.start + off);
      const e = Math.min(at[k] + (m.end - m.start), c.end + off);
      if (e - s < 0.2) continue;
      for (const ch of chunkCaption(c.text, s, e - s, r.captionWords)) {
        await hold(ch.start, { ...base, meme: ch.start < memeUntil ? meme : undefined });
        await hold(ch.end, { ...base, caption: ch.text, meme: ch.start < memeUntil ? meme : undefined });
      }
    }
    await hold(Math.min(memeUntil, at[k] + (m.end - m.start)), { ...base, meme });
  }
  await hold(total, base);
  list.push(list[list.length - 2]);
  const listFile = path.join(work, "captions.txt");
  await writeFile(listFile, list.join("\n"));

  // 5. one pass: fx + captions + bar; original audio ducks the music; sfx on cuts
  const music = r.music !== false ? await pickMusic(mood, clip.id, log) : null;
  const sfxAt = fxOn
    ? moments.map((m, k) => ({ t: at[k], name: (m.sfx && m.sfx !== "none" ? m.sfx : k > 0 ? "whoosh" : null) as Sfx | null })).filter((s): s is { t: number; name: Sfx } => !!s.name)
    : [];
  const sfxFiles = await Promise.all(sfxAt.map((s) => sfxFile(s.name)));
  const inputs = ["-i", main, "-f", "concat", "-safe", "0", "-i", listFile, "-f", "lavfi", "-i", `color=c=${style.accent.replace("#", "0x")}:s=${canvas.w}x12:r=30:d=${total}`];
  inputs.push(...sfxFiles.flatMap((x) => ["-i", x]));
  const musicIdx = 3 + sfxFiles.length;
  if (music) inputs.push("-stream_loop", "-1", "-i", music.file);

  const vf: string[] = [];
  let cur = "0:v";
  const fxM = fxOn ? moments.map((m, k) => ({ t: at[k], fx: m.fx })).filter((x) => x.fx && x.fx !== "none") : [];
  if (fxM.length) {
    const win = (a: number, d: number) => `between(it,${a.toFixed(3)},${(a + d).toFixed(3)})`;
    const z = fxM.map((x) => (x.fx === "punch" ? `${win(x.t, 0.45)}*0.16*(1-(it-${x.t.toFixed(3)})/0.45)` : x.fx === "shake" ? `${win(x.t, 0.5)}*0.08` : `${win(x.t, 0.8)}*0.22`)).join("+");
    const shake = fxM.filter((x) => x.fx === "shake").map((x) => `${win(x.t, 0.5)}*22*sin(it*90)`).join("+") || "0";
    vf.push(`[0:v]zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)+(${shake})':y='ih/2-(ih/zoom/2)':d=1:s=${canvas.w}x${canvas.h}:fps=30[zp]`);
    cur = "zp";
  }
  vf.push(`[1:v]format=rgba[cap]`, `[${cur}][cap]overlay=0:0:eof_action=pass[v1]`, `[v1][2:v]overlay=x='-w+w*t/${total}':y=H-h:eval=frame[v2]`);
  const af: string[] = [`[0:a]aresample=48000,apad,atrim=0:${total}${music ? ",asplit=2[speech][key]" : "[speech]"}`];
  sfxAt.forEach((s, k) => af.push(`[${3 + k}:a]adelay=${Math.round(Math.max(0, s.t - 0.1) * 1000)}:all=1,volume=0.5[sx${k}]`));
  const mix = ["[speech]", ...sfxAt.map((_, k) => `[sx${k}]`)];
  if (music) {
    af.push(
      `[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},volume=${((r.musicVolume ?? 22) / 100 * 0.7).toFixed(2)},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[mus]`,
      `[mus][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=400[duck]`,
    );
    mix.push("[duck]");
  }
  af.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total},loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);

  const fullPath = fullPathFor(clip);
  log(`encoding pure edit…${fxM.length ? ` (${fxM.length} fx)` : ""}${music ? " + music" : ""}`);
  await ffmpeg([
    ...inputs,
    "-filter_complex", [...vf, ...af].join(";"),
    "-map", "[v2]", "-map", "[aout]", "-t", String(total),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart",
    fullPath,
  ]);

  const previewPath = path.join(OUTPUT_DIR, clip.id, "preview.mp4");
  const kbps = Math.max(300, Math.min(1500, Math.floor((PREVIEW_MAX_MB * 8 * 1000) / total) - 96));
  await ffmpeg(["-i", fullPath, "-vf", "scale=720:-2", "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${kbps * 1.5}k`, "-bufsize", `${kbps * 2}k`, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", previewPath]);

  const src = script.sources?.[0];
  const credits = [src ? `Original video: "${src.title}" by ${src.channel} — ${src.url}` : null, music?.credit ? `Music: ${music.credit}` : null].filter((c): c is string => !!c);
  if (!process.env.WORKER_KEEP_WORK) await rm(work, { recursive: true, force: true });
  return { fullPath, previewPath, durationSec: await probeDuration(fullPath), usedFootage: [source], testRender: true, credits, cuts: moments.length, chapters: [], thumbnailPath: null };
}
