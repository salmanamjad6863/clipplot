import "server-only";
import { HttpError } from "../api";
import { getStore } from "../data";
import { GAMES_BY_SLUG, type Game } from "../games";
import { searchRecentVideos } from "../youtube/search";
import { planDiscovery, type GameLog } from "./plan";

export interface DiscoveryResult {
  trendsSaved: number;
  clipsCreated: number;
  fellBack: boolean;
  games: GameLog[];
  /** ≈ YouTube quota units used (search 100 + videos 1 per game fetched) */
  quotaUsed: number;
}

let running = false;

export async function runDiscovery(): Promise<DiscoveryResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new HttpError(503, "Add YOUTUBE_API_KEY to .env.local to run discovery");
  if (running) throw new HttpError(409, "Discovery is already running");
  running = true;

  try {
    const store = getStore();
    const settings = await store.getSettings();
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    const games: Game[] = settings.games
      .filter((g) => g.enabled && GAMES_BY_SLUG[g.slug])
      .map((g) => GAMES_BY_SLUG[g.slug]);

    const [recentlyUsed, recentTrends, lastLongClipAt, shortsCreatedToday] = await Promise.all([
      store.recentlyUsed(iso(settings.dedupeWindowDays * 86_400_000)),
      store.recentTrends(iso(7 * 86_400_000)),
      store.lastLongClipAt(),
      store.countShortsSince(dayStart.toISOString()),
    ]);

    let fetches = 0;
    const plan = await planDiscovery({
      now,
      settings,
      games,
      recentlyUsed,
      recentTrends,
      lastLongClipAt,
      shortsCreatedToday,
      findExisting: (ids) => store.findExistingVideoIds(ids),
      fetchVideos: (game) => {
        fetches++;
        return searchRecentVideos(game.queries, {
          apiKey,
          publishedAfter: new Date(now - settings.lookbackHours * 3_600_000),
        });
      },
    });

    const saved = await store.saveDiscovery(plan);
    const result: DiscoveryResult = {
      trendsSaved: saved.trends,
      clipsCreated: saved.clips,
      fellBack: plan.fellBack,
      games: plan.log,
      quotaUsed: fetches * 101,
    };
    console.info("[discovery]", JSON.stringify(result));
    return result;
  } finally {
    running = false;
  }
}
