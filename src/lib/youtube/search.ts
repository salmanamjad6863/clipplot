/**
 * YouTube Data API v3 — read-only metadata (no video downloads).
 * Quota: search.list = 100 units, videos.list = 1 unit. Default daily quota = 10,000.
 * We use ONE search per game (queries OR-ed with "|") to keep discovery ~100 units/game.
 */

const API = "https://www.googleapis.com/youtube/v3";

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
  views: number;
  durationSec: number;
  /** Live, upcoming or a past livestream recording — poor clip sources */
  isLive: boolean;
  /** Subscribers of the uploading channel (0 = hidden/unknown) — used for the breakout score */
  channelSubscribers: number;
}

export class YouTubeError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

async function get<T>(path: string, params: Record<string, string>, apiKey: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetch(`${API}/${path}?${qs}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] };
  };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    const msg =
      reason === "quotaExceeded"
        ? "YouTube daily quota used up — try again after midnight Pacific time"
        : reason === "keyInvalid" || res.status === 400
          ? `YouTube API rejected the request: ${body.error?.message ?? res.statusText}`
          : (body.error?.message ?? `YouTube API ${res.status}`);
    throw new YouTubeError(res.status, msg, reason);
  }
  return body as T;
}

/** ISO-8601 duration (PT1H2M3S) → seconds */
export function parseDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86_400 + h * 3600 + min * 60 + s;
}

/** Video details + channel sizes for a list of video IDs (1 + 1 quota units per 50 videos). */
export async function videosByIds(ids: string[], apiKey: string): Promise<VideoMeta[]> {
  if (ids.length === 0) return [];
  const videos = await get<{
    items?: {
      id: string;
      snippet: { title: string; channelTitle: string; channelId: string; publishedAt: string; liveBroadcastContent?: string };
      statistics?: { viewCount?: string };
      contentDetails?: { duration?: string };
      liveStreamingDetails?: object;
    }[];
  }>("videos", { part: "snippet,statistics,contentDetails,liveStreamingDetails", id: ids.slice(0, 50).join(","), maxResults: "50" }, apiKey);
  const items = videos.items ?? [];

  // channel sizes → "breakout" = views far above what the channel normally gets
  const channelIds = [...new Set(items.map((v) => v.snippet.channelId))];
  const subs = new Map<string, number>();
  if (channelIds.length) {
    const ch = await get<{ items?: { id: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>(
      "channels",
      { part: "statistics", id: channelIds.join(","), maxResults: "50" },
      apiKey,
    ).catch(() => ({ items: [] }));
    for (const c of ch.items ?? []) subs.set(c.id, c.statistics?.hiddenSubscriberCount ? 0 : Number(c.statistics?.subscriberCount ?? 0));
  }

  return items.map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    views: Number(v.statistics?.viewCount ?? 0),
    durationSec: parseDuration(v.contentDetails?.duration ?? ""),
    isLive: Boolean(v.liveStreamingDetails) || (v.snippet.liveBroadcastContent ?? "none") !== "none",
    channelSubscribers: subs.get(v.snippet.channelId) ?? 0,
  }));
}

/** Search recent videos (by view count) and fetch their stats + channel sizes. ≈102 quota units. */
export async function searchRecentVideos(
  queries: string[],
  opts: { apiKey: string; publishedAfter: Date; maxResults?: number; order?: "viewCount" | "relevance" | "date" },
): Promise<VideoMeta[]> {
  const search = await get<{ items?: { id?: { videoId?: string } }[] }>(
    "search",
    {
      part: "id",
      type: "video",
      q: queries.join("|"),
      order: opts.order ?? "viewCount",
      publishedAfter: opts.publishedAfter.toISOString(),
      maxResults: String(opts.maxResults ?? 25),
      safeSearch: "moderate",
    },
    opts.apiKey,
  );
  const ids = [...new Set((search.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x))];
  return videosByIds(ids, opts.apiKey);
}
