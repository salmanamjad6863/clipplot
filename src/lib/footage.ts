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
    const { error } = await sb.storage.getBucket(FOOTAGE_BUCKET);
    if (error) {
      const { error: e2 } = await sb.storage.createBucket(FOOTAGE_BUCKET, {
        public: false,
        fileSizeLimit: `${FOOTAGE_MAX_MB}MB`,
        allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
      });
      if (e2 && !/already exists/i.test(e2.message)) throw new Error(`Supabase storage: ${e2.message}`);
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
  const games = game ? [game] : ((await b.list("", { limit: 200 })).data ?? []).filter((e) => !e.id).map((e) => e.name);
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
