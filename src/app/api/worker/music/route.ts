import { handle } from "@/lib/api";
import { MOODS, musicDownloads } from "@/lib/footage";
import { readJson, requireWorker } from "@/lib/worker-auth";

export const maxDuration = 60;

/** Search words per mood for free music (Openverse → Jamendo / ccMixter / Freesound). */
const MOOD_QUERY: Record<string, string> = {
  hype: "electronic music loop",
  mystery: "dark ambient music",
  chill: "lofi music",
  epic: "epic orchestral music",
  funny: "funny music loop",
};

/**
 * Background music for one video: your library first (Settings → Music), else free music from Openverse.
 * Only CC0 / CC BY — free for monetized videos, credit added to the description; no "NoDerivs"/"ShareAlike".
 */
export async function POST(req: Request) {
  return handle("worker music", async () => {
    requireWorker(req);
    const { mood } = await readJson<{ mood?: string }>(req);
    const m = (MOODS as readonly string[]).includes(String(mood)) ? String(mood) : "hype";
    const own = await musicDownloads(m);
    if (own.length) return { tracks: own, source: "library" };

    const u = new URL("https://api.openverse.org/v1/audio/");
    u.searchParams.set("q", MOOD_QUERY[m]);
    // Jamendo links in Openverse point at a host that no longer resolves → only sources with working CDNs
    u.searchParams.set("source", "freesound,wikimedia_audio");
    u.searchParams.set("license", "by,cc0");
    u.searchParams.set("page_size", "12");
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(u, { headers: { "User-Agent": "ClipPilot/1.0 (https://clipplot.vercel.app)" }, signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const d = (await res.json()) as { results?: { id: string; url: string; duration?: number; attribution?: string; title?: string }[] };
          const tracks = (d.results ?? [])
            .filter((r) => r.url && !/jamendo\.com/.test(r.url) && (r.duration ?? 0) >= 30_000)
            .map((r) => ({
              id: `oa${r.id}`,
              url: r.url,
              credit: (r.attribution ?? `"${r.title}"`).replace(/\s*To view (a copy of this license|the terms).*$/i, "").trim(),
            }));
          return { tracks, source: "openverse" };
        }
        if (res.status < 500 && res.status !== 429) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
    return { tracks: [], source: "none" };
  });
}
