import "server-only";
import { HttpError } from "../api";
import { getStore } from "../data";
import { extractVideoId } from "../dedupe";
import { topicToGame } from "../topics";
import type { Clip, Trend } from "../types";
import { searchRecentVideos, videosByIds } from "../youtube/search";
import { planDiscovery, shortTarget, viralScore } from "./plan";

/**
 * Manual tools: look up any keyword or YouTube link, make a clip from a chosen trend,
 * or swap a clip you don't like for the next-best trend. Same duplicate protection as the daily run.
 */

function apiKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new HttpError(503, "Add YOUTUBE_API_KEY to .env.local");
  return k;
}

/** Search a keyword (last 7 days, most viewed) or fetch one pasted video link → saved as trends. ≈102 units. */
export async function manualLookup(ws: string, input: { query?: string; url?: string; game: string }): Promise<Trend[]> {
  const store = getStore(ws);
  const settings = await store.getSettings();
  const topic = settings.topics.find((t) => t.slug === input.game);
  if (!topic) throw new HttpError(400, "Unknown topic");
  const game = topicToGame(topic);
  const now = Date.now();

  let videos;
  if (input.url) {
    const id = extractVideoId(input.url);
    if (!id) throw new HttpError(400, "That doesn't look like a YouTube video link");
    videos = await videosByIds([id], apiKey());
    if (!videos.length) throw new HttpError(404, "Video not found (private, deleted or wrong link)");
  } else {
    const q = String(input.query ?? "").trim();
    if (q.length < 2 || q.length > 100) throw new HttpError(400, "Search 2–100 characters");
    videos = await searchRecentVideos([q], { apiKey: apiKey(), publishedAfter: new Date(now - 7 * 86_400_000), maxResults: 15 });
  }

  // reuse the planner for scoring + duplicate checks, but: no clips, no title/views gate (you chose this)
  const recentlyUsed = await store.recentlyUsed(new Date(now - settings.dedupeWindowDays * 86_400_000).toISOString());
  const plan = await planDiscovery({
    now,
    settings: {
      ...settings,
      minViewsPerHour: 0,
      maxFallbackDepth: 1,
      formats: { ...settings.formats, short: { ...settings.formats.short, perDay: 0 }, long: { ...settings.formats.long, enabled: false } },
    },
    games: [{ ...game, titleMatch: /./ }],
    fetchVideos: async () => videos,
    findExisting: (ids) => store.findExistingVideoIds(ids),
    recentlyUsed,
    recentTrends: [],
    lastLongClipAt: new Date(now).toISOString(),
    shortsCreatedToday: 0,
  });
  await store.saveDiscovery(plan);

  // return every looked-up video as it now exists on the radar (new, used, duplicate…)
  const ids = new Set(videos.map((v) => v.videoId));
  return (await store.listTrends()).filter((t) => ids.has(t.videoId));
}

/** Turn a chosen trend into a clip (Short or full video). Claude scripts it right after. */
export async function clipFromTrend(ws: string, trendId: string, format: "short" | "long"): Promise<Clip> {
  const store = getStore(ws);
  const [trend] = await store.getTrendsByIds([trendId]);
  if (!trend) throw new HttpError(404, "Trend not found");
  if (trend.status === "used") throw new HttpError(409, "A clip was already made from this video");
  const settings = await store.getSettings();
  const long = settings.formats.long;
  return store.createClip({
    game: trend.game,
    format,
    durationSec: format === "short" ? shortTarget(settings) : Math.round((long.minSec + long.maxSec) / 2),
    title: trend.title,
    trendIds: [trend.id],
    trendUrl: trend.url,
    viralScore: viralScore(trend.viewsPerHour),
  });
}

/**
 * "Not this one": skip the clip and make a new one from the next-best unused trend of the same game
 * found within the look-back window.
 */
export async function swapTrend(ws: string, clipId: string): Promise<Clip> {
  const store = getStore(ws);
  const clip = await store.getClip(clipId);
  if (!clip) throw new HttpError(404, "Clip not found");
  if (["scheduled", "published", "scripting"].includes(clip.status)) {
    throw new HttpError(409, `Can't swap a clip that is "${clip.status}"`);
  }
  const settings = await store.getSettings();
  const since = Date.now() - settings.lookbackHours * 3_600_000;
  const next = (await store.listTrends())
    .filter((t) => t.status === "new" && t.game === clip.game && !clip.trendIds.includes(t.id) && Date.parse(t.foundAt) >= since)
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour)[0];
  if (!next) {
    throw new HttpError(404, "No other fresh trends for this game — use Search on the Trends page, or Find more now");
  }
  await store.updateClip(clip.id, { status: "rejected" });
  await store.cancelQueuedJobs(clip.id, "upload");
  return clipFromTrend(ws, next.id, clip.format);
}
