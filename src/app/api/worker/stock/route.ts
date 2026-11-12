import { HttpError, handle } from "@/lib/api";
import { readJson, requireWorker } from "@/lib/worker-auth";

/**
 * Free visuals for video backgrounds. The worker sends mood searches; any keys stay here.
 * - Keyless, always on: Wikimedia Commons videos + Openverse images (Creative Commons, commercial use OK;
 *   `credit` is the attribution line the upload adds to the description).
 * - Optional keys: Pixabay (PIXABAY_API_KEY) / Pexels (PEXELS_API_KEY) videos — no attribution needed.
 */
export const maxDuration = 60;

interface StockVideo {
  id: string;
  url: string;
  kind?: "video" | "image";
  duration: number;
  /** estimated bytes (videos) — the worker grabs only a short piece of big files */
  bytes?: number;
  credit: string;
  page: string;
}

const UA = { "User-Agent": "ClipPilot/1.0 (https://clipplot.vercel.app)" }; // Wikimedia asks for a descriptive UA
/** GET with retries — the free/open APIs time out or reset now and then. */
async function getJson<T>(url: URL, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      /* timeout / reset → retry */
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const OK_LICENSE = /^(cc0|cc by(-sa)? \d|public domain|pd)/i;

async function commonsVideos(q: string, n: number, portrait: boolean): Promise<StockVideo[]> {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: String(n * 4),
    gsrsearch: `filetype:video ${q}`, prop: "videoinfo|imageinfo", viprop: "url|size|derivatives",
    iiprop: "extmetadata", iiextmetadatafilter: "LicenseShortName|Artist",
  })) u.searchParams.set(k, v);
  type Page = {
    pageid: number; title: string;
    videoinfo?: { duration?: number; width: number; height: number; size: number; descriptionurl: string; derivatives?: { src: string; type: string; width: number; height: number; bandwidth: number }[] }[];
    imageinfo?: { extmetadata?: { LicenseShortName?: { value: string }; Artist?: { value: string } } }[];
  };
  const data = (await getJson<{ query?: { pages?: Record<string, Page> } }>(u)) ?? {};
  const out: StockVideo[] = [];
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => {
    const pa = (a.videoinfo?.[0]?.height ?? 0) > (a.videoinfo?.[0]?.width ?? 0);
    const pb = (b.videoinfo?.[0]?.height ?? 0) > (b.videoinfo?.[0]?.width ?? 0);
    return Number(pb === portrait) - Number(pa === portrait);
  });
  for (const p of pages) {
    const vi = p.videoinfo?.[0];
    const meta = p.imageinfo?.[0]?.extmetadata;
    const license = meta?.LicenseShortName?.value ?? "";
    if (out.length >= n || !vi?.duration || vi.duration < 5 || vi.duration > 3600 || !OK_LICENSE.test(license)) continue;
    if (Math.min(vi.width, vi.height) < 720) continue; // HD only — skips old archival/SD films
    // smallest derivative that's ≥ 720 on the short side (else the largest)
    const ders = (vi.derivatives ?? []).filter((d) => d.width && d.height).sort((a, b) => a.width * a.height - b.width * b.height);
    const d = ders.find((x) => Math.min(x.width, x.height) >= 720) ?? ders[ders.length - 1];
    if (!d) continue;
    const name = p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    const artist = strip(meta?.Artist?.value ?? "") || "unknown";
    out.push({
      id: `wc${p.pageid}`,
      url: d.src,
      kind: "video",
      duration: vi.duration,
      bytes: Math.round(((d.bandwidth || 4_000_000) * vi.duration) / 8),
      credit: `"${name}" by ${artist} (${license}) via Wikimedia Commons`,
      page: vi.descriptionurl,
    });
  }
  return out;
}

async function openverseImages(q: string, n: number, portrait: boolean): Promise<StockVideo[]> {
  const u = new URL("https://api.openverse.org/v1/images/");
  u.searchParams.set("q", q);
  u.searchParams.set("page_size", String(n * 3));
  u.searchParams.set("license_type", "commercial,modification");
  u.searchParams.set("aspect_ratio", portrait ? "tall" : "wide");
  u.searchParams.set("mature", "false");
  const data =
    (await getJson<{
      results?: { id: string; url: string; width?: number; height?: number; attribution?: string; foreign_landing_url?: string; title?: string; license?: string }[];
    }>(u)) ?? {};
  const minShort = portrait ? 700 : 600;
  return (data.results ?? [])
    .filter((r) => r.url && Math.min(r.width ?? 0, r.height ?? 0) >= minShort)
    .slice(0, n)
    .map((r) => ({
      id: `ov${r.id}`,
      url: r.url,
      kind: "image" as const,
      duration: 0,
      credit: (r.attribution ?? `"${r.title}" (${r.license})`).replace(/\s*To view (a copy of this license|the terms).*$/i, "").trim(),
      page: r.foreign_landing_url ?? r.url,
    }));
}
interface Size {
  url: string;
  width: number;
  height: number;
}

const pickSize = (sizes: Size[], minShort: number) => {
  const ok = sizes.filter((s) => s.url && s.width && s.height).sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  return ok.find((s) => Math.min(s.width, s.height) >= minShort) ?? ok[ok.length - 1];
};

async function pixabay(key: string, q: string, n: number, portrait: boolean, minShort: number): Promise<StockVideo[]> {
  const u = new URL("https://pixabay.com/api/videos/");
  u.searchParams.set("key", key);
  u.searchParams.set("q", q);
  u.searchParams.set("per_page", String(Math.max(n * 3, 5))); // filter by orientation ourselves
  u.searchParams.set("safesearch", "true");
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 400 && /key/i.test(await res.clone().text())) throw new HttpError(503, "PIXABAY_API_KEY is invalid");
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits?: { id: number; duration: number; pageURL: string; user: string; videos: Record<string, Size> }[];
  };
  const out: StockVideo[] = [];
  // prefer the requested orientation, fall back to the rest (it's cropped to fit anyway)
  const hits = [...(data.hits ?? [])].sort((a, b) => {
    const pa = (a.videos.medium?.height ?? 0) > (a.videos.medium?.width ?? 0);
    const pb = (b.videos.medium?.height ?? 0) > (b.videos.medium?.width ?? 0);
    return Number(pb === portrait) - Number(pa === portrait);
  });
  for (const h of hits) {
    if (out.length >= n || h.duration < 3) continue;
    const pick = pickSize(Object.values(h.videos ?? {}), minShort);
    if (pick) out.push({ id: `pb${h.id}`, url: pick.url, duration: h.duration, credit: h.user, page: h.pageURL });
  }
  return out;
}

async function pexels(key: string, q: string, n: number, portrait: boolean, minShort: number): Promise<StockVideo[]> {
  const u = new URL("https://api.pexels.com/videos/search");
  u.searchParams.set("query", q);
  u.searchParams.set("per_page", String(n + 2));
  u.searchParams.set("orientation", portrait ? "portrait" : "landscape");
  const res = await fetch(u, { headers: { Authorization: key }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 401) throw new HttpError(503, "PEXELS_API_KEY is invalid");
  if (!res.ok) return [];
  const data = (await res.json()) as {
    videos?: { id: number; duration: number; url: string; user?: { name?: string }; video_files: { link: string; width: number | null; height: number | null; file_type: string }[] }[];
  };
  const out: StockVideo[] = [];
  for (const v of data.videos ?? []) {
    if (out.length >= n || v.duration < 3) continue;
    const sizes = v.video_files.filter((f) => f.file_type === "video/mp4").map((f) => ({ url: f.link, width: f.width ?? 0, height: f.height ?? 0 }));
    const pick = pickSize(sizes, minShort);
    if (pick) out.push({ id: `px${v.id}`, url: pick.url, duration: v.duration, credit: v.user?.name ?? "Pexels", page: v.url });
  }
  return out;
}

export async function POST(req: Request) {
  return handle("worker stock", async () => {
    requireWorker(req);
    const pbKey = process.env.PIXABAY_API_KEY;
    const pxKey = process.env.PEXELS_API_KEY;
    const { queries, orientation, perQuery } = await readJson<{ queries?: string[]; orientation?: string; perQuery?: number }>(req);
    const qs = (Array.isArray(queries) ? queries : []).map((q) => String(q).trim().slice(0, 60)).filter(Boolean).slice(0, 6);
    if (!qs.length) throw new HttpError(400, "queries required");
    const portrait = orientation === "portrait";
    const minShort = portrait ? 1080 : 720;
    const n = Math.min(Math.max(Number(perQuery) || 3, 1), 6);

    const perQ = await Promise.all(
      qs.map(async (q) => {
        const keyed = [...(pbKey ? await pixabay(pbKey, q, n, portrait, minShort) : []), ...(pxKey ? await pexels(pxKey, q, n, portrait, minShort) : [])];
        // keyless sources fill in (and add variety: a still between video cuts)
        const [wc, ov] = await Promise.all([keyed.length >= n ? [] : commonsVideos(q, n - keyed.length, portrait), openverseImages(q, 2, portrait)]);
        return [...keyed, ...wc].slice(0, n).concat(ov);
      }),
    );
    const seen = new Set<string>();
    const videos: StockVideo[] = [];
    for (const v of perQ.flat()) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      videos.push(v);
    }
    return { videos, configured: true };
  });
}
