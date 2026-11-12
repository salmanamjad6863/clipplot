import "server-only";
import { HttpError } from "./api";
import { supabaseAdmin } from "./data/supabase-store";

/**
 * Footage library in Supabase Storage (private bucket "footage", files at <topic-slug>/<name>).
 * The cloud worker downloads these to build each video's background; the browser uploads straight to
 * storage with a one-time signed URL (so big files never pass through Vercel).
 */
export const FOOTAGE_BUCKET = "footage";
export const FOOTAGE_MAX_MB = 50; // Supabase free-tier per-file limit

export interface FootageFile {
  game: string;
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new HttpError(503, "Supabase is not configured");
  return supabaseAdmin(url, key);
}

let ensured = false;
async function bucket() {
  const sb = client();
  if (!ensured) {
    const opts = {
      public: false,
      fileSizeLimit: `${FOOTAGE_MAX_MB}MB`,
      allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "application/json", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg"],
    };
    const { data: existing, error } = await sb.storage.getBucket(FOOTAGE_BUCKET);
    if (error) {
      const { error: e2 } = await sb.storage.createBucket(FOOTAGE_BUCKET, opts);
      if (e2 && !/already exists/i.test(e2.message)) throw new Error(`Supabase storage: ${e2.message}`);
    } else if (!existing.allowed_mime_types?.includes("audio/mpeg")) {
      await sb.storage.updateBucket(FOOTAGE_BUCKET, opts);
    }
    ensured = true;
  }
  return sb.storage.from(FOOTAGE_BUCKET);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
export function assertSlug(game: string) {
  if (!SLUG_RE.test(game)) throw new HttpError(400, "Invalid topic");
}

/** Safe storage name: keeps letters/digits/.-_ and the video extension. */
export function cleanName(name: string): string {
  const ext = (name.match(/\.(mp4|mov|webm|mkv)$/i)?.[1] ?? "").toLowerCase();
  if (!ext) throw new HttpError(400, "Only .mp4, .mov, .webm or .mkv files");
  const base = name.slice(0, -(ext.length + 1)).normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "clip";
  return `${base}.${ext}`;
}

export async function listFootage(game?: string): Promise<FootageFile[]> {
  const b = await bucket();
  const games = game ? [game] : ((await b.list("", { limit: 200 })).data ?? []).filter((e) => !e.id && !e.name.startsWith("_")).map((e) => e.name);
  const out: FootageFile[] = [];
  for (const g of games) {
    const { data, error } = await b.list(g, { limit: 500, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Supabase storage: ${error.message}`);
    for (const f of data ?? []) {
      if (!f.id || f.name.startsWith(".")) continue;
      out.push({ game: g, name: f.name, path: `${g}/${f.name}`, size: Number(f.metadata?.size ?? 0), createdAt: f.created_at ?? "" });
    }
  }
  return out;
}

export async function createFootageUpload(game: string, name: string, size: number) {
  assertSlug(game);
  if (!(size > 0) || size > FOOTAGE_MAX_MB * 1024 * 1024) throw new HttpError(400, `Each file must be under ${FOOTAGE_MAX_MB} MB`);
  const path = `${game}/${cleanName(name)}`;
  const { data, error } = await (await bucket()).createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`Supabase storage: ${error.message}`);
  return { path, token: data.token };
}

export async function deleteFootage(path: string) {
  const [game, name, ...rest] = path.split("/");
  assertSlug(game ?? "");
  if (!name || rest.length) throw new HttpError(400, "Invalid file");
  const { error } = await (await bucket()).remove([`${game}/${name}`]);
  if (error) throw new Error(`Supabase storage: ${error.message}`);
}

/** For the worker: the topic's files with 1-hour download links. */
export async function footageDownloads(game: string) {
  assertSlug(game);
  const files = await listFootage(game);
  if (!files.length) return [];
  const { data, error } = await (await bucket()).createSignedUrls(files.map((f) => f.path), 3600);
  if (error) throw new Error(`Supabase storage: ${error.message}`);
  return files.map((f, i) => ({ name: f.name, size: f.size, url: data[i]?.signedUrl ?? "" })).filter((f) => f.url);
}

/* ---------- tiny private JSON docs (worker heartbeat) — same private bucket, under _system/ ---------- */

export async function writeSystemJson(name: string, value: unknown) {
  const { error } = await (await bucket()).upload(`_system/${name}.json`, JSON.stringify(value), {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`Supabase storage: ${error.message}`);
}

export async function readSystemJson<T>(name: string): Promise<T | null> {
  const { data, error } = await (await bucket()).download(`_system/${name}.json`);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

/* ---------- Music library: _music/<mood>/<file> in the same private bucket ---------- */

export const MOODS = ["hype", "mystery", "chill", "epic", "funny"] as const;
export type Mood = (typeof MOODS)[number];
const isMood = (m: string): m is Mood => (MOODS as readonly string[]).includes(m);

export async function listMusic(mood?: string) {
  const b = await bucket();
  const out: { mood: Mood; name: string; path: string; size: number }[] = [];
  for (const m of mood ? [mood] : MOODS) {
    if (!isMood(m)) continue;
    const { data } = await b.list(`_music/${m}`, { limit: 200, sortBy: { column: "name", order: "asc" } });
    for (const f of data ?? []) {
      if (!f.id || f.name.startsWith(".")) continue;
      out.push({ mood: m, name: f.name, path: `_music/${m}/${f.name}`, size: Number(f.metadata?.size ?? 0) });
    }
  }
  return out;
}

export async function createMusicUpload(mood: string, name: string, size: number) {
  if (!isMood(mood)) throw new HttpError(400, "Invalid mood");
  if (!(size > 0) || size > 20 * 1024 * 1024) throw new HttpError(400, "Each track must be under 20 MB");
  const ext = (name.match(/\.(mp3|m4a|wav|ogg)$/i)?.[1] ?? "").toLowerCase();
  if (!ext) throw new HttpError(400, "Only .mp3, .m4a, .wav or .ogg files");
  const base = name.slice(0, -(ext.length + 1)).normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "track";
  const path = `_music/${mood}/${base}.${ext}`;
  const { data, error } = await (await bucket()).createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`Supabase storage: ${error.message}`);
  return { path, token: data.token };
}

export async function deleteMusic(path: string) {
  const m = path.match(/^_music\/([a-z]+)\/([^/]+)$/);
  if (!m || !isMood(m[1])) throw new HttpError(400, "Invalid file");
  const { error } = await (await bucket()).remove([path]);
  if (error) throw new Error(`Supabase storage: ${error.message}`);
}

/** Worker: tracks for a mood with 1-hour links. */
export async function musicDownloads(mood: string) {
  const files = await listMusic(mood);
  if (!files.length) return [];
  const { data, error } = await (await bucket()).createSignedUrls(files.map((f) => f.path), 3600);
  if (error) throw new Error(`Supabase storage: ${error.message}`);
  return files.map((f, i) => ({ id: f.path, url: data[i]?.signedUrl ?? "", credit: null as string | null })).filter((f) => f.url);
}
