/**
 * Daily discovery planner — pure logic, no I/O (fetchers are injected so it's testable).
 *
 *  for each enabled game in fallback order (max `maxFallbackDepth`):
 *    fetch recent videos → score views/hour → classify each:
 *      duplicate        (video already known, or same story used recently)
 *      below_threshold  (< minViewsPerHour)
 *      new              (candidate)
 *    pick the best `new` ones for today's Shorts; stop falling back once we have enough
 *  optionally plan a long compilation video when one is due
 */
import { checkDuplicate, titleTokens, type UsedItem } from "../dedupe";
import type { Game } from "../games";
import type { Settings, Trend, TrendStatus } from "../types";
import type { VideoMeta } from "../youtube/search";

export interface PlannedTrend {
  game: string;
  videoId: string;
  url: string;
  title: string;
  channel: string;
  views: number;
  viewsPerHour: number;
  durationSec: number;
  publishedAt: string;
  status: TrendStatus;
  duplicateReason?: string;
  /** views ÷ uploader's subscribers (not stored; drives ranking + viral score) */
  breakout?: number;
}

export interface PlannedClip {
  game: string;
  isFallback: boolean;
  format: "short" | "long";
  durationSec: number;
  title: string;
  /** New trends (by videoId) created in this run */
  newTrendVideoIds: string[];
  /** Existing trend rows (by id) included in a compilation */
  existingTrendIds: string[];
  trendUrl: string;
  viralScore: number;
  /** set after planning: "edit" = pure edit of the original video */
  style?: "commentary" | "edit";
}

export interface GameLog {
  game: string;
  fetched: number;
  candidates: number;
  duplicates: number;
  belowThreshold: number;
  picked: number;
  error?: string;
}

export interface DiscoveryPlan {
  trends: PlannedTrend[];
  clips: PlannedClip[];
  log: GameLog[];
  fellBack: boolean;
}

export interface PlanInput {
  now: number;
  settings: Settings;
  /** Enabled games in fallback order */
  games: Game[];
  fetchVideos: (game: Game) => Promise<VideoMeta[]>;
  /** Which of these video IDs already exist in the trends table */
  findExisting: (videoIds: string[]) => Promise<Set<string>>;
  /** Trends used for clips within the dedupe window */
  recentlyUsed: UsedItem[];
  /** Trends from the last 7 days per game, for compilations */
  recentTrends: Trend[];
  /** When the last long video was created (any game) */
  lastLongClipAt: string | null;
  /** Shorts already created today (so re-running doesn't double up) */
  shortsCreatedToday: number;
  /** Manual "find more now": make at least this many Shorts even if today's quota is used */
  extraShorts?: number;
  /** Breaking-news mode: only trends at or above this viral score become clips */
  minViralScore?: number;
}

/**
 * Breakout = views ÷ the uploader's subscribers. A small channel getting 10× its size in views means the
 * TOPIC is hot (what we want to ride), not just that a big channel posted. Unknown size → neutral (1).
 */
export function breakout(views: number, subscribers: number) {
  if (!subscribers) return 1;
  return Math.max(0.1, Math.min(100, views / Math.max(subscribers, 1000)));
}

/** Ranking: speed (log views/hour) + a bonus for breaking out of the channel's usual reach. */
export function trendRank(viewsPerHour: number, breakoutRatio = 1) {
  return Math.log10(Math.max(1, viewsPerHour)) + 0.6 * Math.log10(breakoutRatio);
}

/** 0–100 for the dashboard. 5k/h ≈ 74, 50k/h ≈ 94; a 10× breakout adds ~12. */
export function viralScore(viewsPerHour: number, breakoutRatio = 1) {
  return Math.max(0, Math.min(100, Math.round(20 * trendRank(viewsPerHour, breakoutRatio))));
}

/** Target Short length: middle of the configured range, capped at 40s (retention sweet spot) */
export function shortTarget(settings: Settings) {
  const { minSec, maxSec } = settings.formats.short;
  return Math.max(minSec, Math.min(40, Math.round((minSec + maxSec) / 2)));
}

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const KEEP_PER_GAME = 12; // trends stored per game per run (for the radar)

export async function planDiscovery(input: PlanInput): Promise<DiscoveryPlan> {
  const { settings, now } = input;
  const shortsWanted = settings.formats.short.enabled
    ? Math.max(settings.formats.short.perDay - input.shortsCreatedToday, input.extraShorts ?? 0, 0)
    : 0;

  const trends: PlannedTrend[] = [];
  const clips: PlannedClip[] = [];
  const log: GameLog[] = [];
  const used: UsedItem[] = [...input.recentlyUsed];
  const batchIds = new Set<string>();
  let pickedGame: Game | null = null;
  let fellBack = false;

  const chain = input.games.slice(0, settings.maxFallbackDepth);
  for (const [depth, game] of chain.entries()) {
    if (clips.length >= shortsWanted && pickedGame) break;
    const entry: GameLog = { game: game.slug, fetched: 0, candidates: 0, duplicates: 0, belowThreshold: 0, picked: 0 };
    log.push(entry);

    let videos: VideoMeta[];
    try {
      videos = await input.fetchVideos(game);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      // quota/key errors affect every game — stop instead of burning more quota
      if (/quota|rejected|key/i.test(entry.error)) break;
      continue;
    }
    entry.fetched = videos.length;

    const existing = await input.findExisting(videos.map((v) => v.videoId));
    const scored = videos
      .filter((v) => !existing.has(v.videoId)) // seen before → silently skip, already on the radar
      .map((v) => {
        const hours = Math.max(1, (now - Date.parse(v.publishedAt)) / 3_600_000);
        const viewsPerHour = Math.round(v.views / hours);
        const bo = breakout(v.views, v.channelSubscribers);
        return { ...v, viewsPerHour, breakout: bo, rank: trendRank(viewsPerHour, bo) };
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(0, KEEP_PER_GAME);
    entry.duplicates += videos.length - videos.filter((v) => !existing.has(v.videoId)).length;

    const picksForGame: PlannedTrend[] = [];
    for (const v of scored) {
      const base = {
        game: game.slug,
        videoId: v.videoId,
        url: yt(v.videoId),
        title: v.title,
        channel: v.channel,
        views: v.views,
        viewsPerHour: v.viewsPerHour,
        durationSec: v.durationSec,
        publishedAt: v.publishedAt,
        breakout: v.breakout,
      };
      const dup = checkDuplicate(v, used, {
        windowDays: settings.dedupeWindowDays,
        similarity: settings.titleSimilarity,
        now,
        batchIds,
      });
      batchIds.add(v.videoId);
      // Titles with no meaningful words can't be compared reliably — treat as low quality
      if (dup.duplicate) {
        entry.duplicates++;
        trends.push({ ...base, status: "duplicate", duplicateReason: dup.reason });
        continue;
      }
      const skip = !game.titleMatch.test(v.title)
        ? `Not about ${game.name}`
        : v.isLive
          ? "Livestream — not a good clip source"
          : v.viewsPerHour < settings.minViewsPerHour || titleTokens(v.title).size === 0
            ? "Not enough views/hour"
            : null;
      if (skip) {
        entry.belowThreshold++;
        trends.push({ ...base, status: "below_threshold", duplicateReason: skip });
        continue;
      }
      entry.candidates++;
      const t: PlannedTrend = { ...base, status: "new" };
      trends.push(t);
      // later candidates in this run must not repeat the same story either
      used.push({ videoId: v.videoId, title: v.title, usedAt: new Date(now).toISOString() });
      picksForGame.push(t);
    }

    for (const t of picksForGame) {
      if (clips.length >= shortsWanted) break;
      if (input.minViralScore && viralScore(t.viewsPerHour, t.breakout) < input.minViralScore) continue; // not exceptional enough
      t.status = "used";
      entry.picked++;
      clips.push({
        game: game.slug,
        isFallback: depth > 0,
        format: "short",
        // aim mid-range: shorter Shorts keep a higher % watched (a key Shorts signal)
        durationSec: shortTarget(settings),
        title: t.title,
        newTrendVideoIds: [t.videoId],
        existingTrendIds: [],
        trendUrl: t.url,
        viralScore: viralScore(t.viewsPerHour, t.breakout),
      });
    }
    if (picksForGame.length > 0 && !pickedGame) {
      pickedGame = game;
      fellBack = depth > 0;
    }
  }

  // ---------- Long compilation ----------
  const long = settings.formats.long;
  const dueMs = (long.cadence === "daily" ? 1 : 7) * 86_400_000 - 3_600_000; // 1h grace for cron drift
  const due = !input.lastLongClipAt || now - Date.parse(input.lastLongClipAt) >= dueMs;
  const longGame = pickedGame ?? chain.find((g) => input.recentTrends.some((t) => t.game === g.slug)) ?? null;
  if (long.enabled && due && longGame) {
    const fresh = trends.filter((t) => t.game === longGame.slug && (t.status === "new" || t.status === "used"));
    const older = input.recentTrends
      .filter((t) => t.game === longGame.slug && (t.status === "new" || t.status === "used"))
      .sort((a, b) => b.viewsPerHour - a.viewsPerHour);
    const fromFresh = fresh.sort((a, b) => b.viewsPerHour - a.viewsPerHour).slice(0, long.clipsPerVideo);
    const fromOlder = older.slice(0, long.clipsPerVideo - fromFresh.length);
    const count = fromFresh.length + fromOlder.length;
    if (count >= 3) {
      const top = fromFresh[0] ?? fromOlder[0];
      const avg = [...fromFresh, ...fromOlder].reduce((s, t) => s + t.viewsPerHour, 0) / count;
      for (const t of fromFresh) t.status = "used";
      clips.push({
        game: longGame.slug,
        isFallback: chain.indexOf(longGame) > 0,
        format: "long",
        durationSec: Math.round((long.minSec + long.maxSec) / 2),
        title: `${longGame.name}: ${count} biggest moments this ${long.cadence === "daily" ? "day" : "week"}`,
        newTrendVideoIds: fromFresh.map((t) => t.videoId),
        existingTrendIds: fromOlder.map((t) => t.id),
        trendUrl: top.url,
        viralScore: viralScore(avg),
      });
    }
  }

  return { trends, clips, log, fellBack };
}
