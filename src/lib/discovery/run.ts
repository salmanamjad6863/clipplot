import "server-only";
import { HttpError } from "../api";
import { getStore } from "../data";
import type { Game } from "../games";
import { dailyShortsTotal, topicToGame } from "../topics";
import { searchRecentVideos } from "../youtube/search";
import { planDiscovery, type DiscoveryPlan, type GameLog } from "./plan";

export interface DiscoveryResult {
  trendsSaved: number;
  clipsCreated: number;
  fellBack: boolean;
  games: GameLog[];
  /** ≈ YouTube quota units used (search 100 + videos 1 per game fetched) */
  quotaUsed: number;
}

const running = new Set<string>(); // per workspace

/** Breaking-news extras allowed per day on top of the daily Short count */
export const BREAKING_EXTRA_PER_DAY = 2;
const BREAKING_MIN_SCORE = 90; // ≈ 30k+ views/hour, or a strong breakout

export async function runDiscovery(
  ws: string,
  opts: { extraShorts?: number; breaking?: boolean } = {},
): Promise<DiscoveryResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new HttpError(503, "Add YOUTUBE_API_KEY to .env.local to run discovery");
  if (running.has(ws)) throw new HttpError(409, "Discovery is already running for this workspace");
  running.add(ws);

  try {
    const store = getStore(ws);
    const settings = await store.getSettings();
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    let games: Game[] = settings.topics
      .filter((t) => t.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map(topicToGame);
    // breaking news: only the primary game, only exceptional trends, capped extras per day
    if (opts.breaking) games = games.slice(0, 1);

    const [recentlyUsed, recentTrends, lastLongClipAt, shortsCreatedToday] = await Promise.all([
      store.recentlyUsed(iso(settings.dedupeWindowDays * 86_400_000)),
      store.recentTrends(iso(7 * 86_400_000)),
      store.lastLongClipAt(),
      store.countShortsSince(dayStart.toISOString()),
    ]);
    const dailyTotal = dailyShortsTotal(settings);

    let fetches = 0;
    const fetchVideos = (game: Game) => {
      fetches++;
      return searchRecentVideos(game.queries, { apiKey, publishedAfter: new Date(now - settings.lookbackHours * 3_600_000) });
    };
    const findExisting = (ids: string[]) => store.findExistingVideoIds(ids);

    // One planner pass per "lane": fallback mode = one lane over the whole chain;
    // per-topic mode = one lane per topic with its own daily count (manual extras / breaking stay single-lane).
    type Lane = { games: Game[]; perDay: number; createdToday: number; allowLong: boolean };
    let lanes: Lane[];
    if (settings.topicMode === "per_topic" && !opts.breaking && !opts.extraShorts) {
      const counts = await store.countShortsByGameSince(dayStart.toISOString());
      lanes = settings.topics
        .filter((t) => t.enabled && t.dailyShorts > 0)
        .sort((a, b) => a.priority - b.priority)
        .map((t, i) => ({ games: [topicToGame(t)], perDay: t.dailyShorts, createdToday: counts[t.slug] ?? 0, allowLong: i === 0 }))
        .filter((l) => l.createdToday < l.perDay || l.allowLong);
    } else {
      lanes = [{ games, perDay: settings.formats.short.perDay, createdToday: shortsCreatedToday, allowLong: !opts.breaking }];
    }

    const used = [...recentlyUsed]; // shared across lanes so two topics can't pick the same story
    const merged = { trends: [] as DiscoveryPlan["trends"], clips: [] as DiscoveryPlan["clips"], log: [] as DiscoveryPlan["log"], fellBack: false };
    for (const lane of lanes) {
      const plan = await planDiscovery({
        now,
        settings: {
          ...settings,
          maxFallbackDepth: lane.games.length > 1 ? settings.maxFallbackDepth : 1,
          formats: { ...settings.formats, short: { ...settings.formats.short, perDay: lane.perDay } },
        },
        games: lane.games,
        recentlyUsed: used,
        recentTrends,
        lastLongClipAt: lane.allowLong ? lastLongClipAt : new Date(now).toISOString(),
        shortsCreatedToday: lane.createdToday,
        extraShorts: opts.breaking ? (shortsCreatedToday < dailyTotal + BREAKING_EXTRA_PER_DAY ? 1 : 0) : opts.extraShorts,
        minViralScore: opts.breaking ? BREAKING_MIN_SCORE : undefined,
        findExisting,
        fetchVideos,
      });
      for (const t of plan.trends) if (t.status === "used" || t.status === "new") used.push({ videoId: t.videoId, title: t.title, usedAt: new Date(now).toISOString() });
      merged.trends.push(...plan.trends.filter((t) => !merged.trends.some((x) => x.videoId === t.videoId)));
      merged.clips.push(...plan.clips);
      merged.log.push(...plan.log);
      merged.fellBack ||= plan.fellBack;
    }

    const saved = await store.saveDiscovery(merged);
    const result: DiscoveryResult = {
      trendsSaved: saved.trends,
      clipsCreated: saved.clips,
      fellBack: merged.fellBack,
      games: merged.log,
      quotaUsed: fetches * 102,
    };
    console.info("[discovery]", JSON.stringify(result));
    return result;
  } finally {
    running.delete(ws);
  }
}
