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

/** Search recent videos for a game, then fetch stats for them. ≈101 quota units. */
export async function searchRecentVideos(
  queries: string[],
  opts: { apiKey: string; publishedAfter: Date; maxResults?: number },
): Promise<VideoMeta[]> {
  const search = await get<{ items?: { id?: { videoId?: string } }[] }>(
    "search",
    {
      part: "id",
      type: "video",
      q: queries.join("|"),
      order: "viewCount",
      publishedAfter: opts.publishedAfter.toISOString(),
      maxResults: String(opts.maxResults ?? 25),
      safeSearch: "moderate",
    },
    opts.apiKey,
  );
  const ids = [...new Set((search.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x))];
  if (ids.length === 0) return [];

  const videos = await get<{
    items?: {
      id: string;
      snippet: { title: string; channelTitle: string; publishedAt: string; liveBroadcastContent?: string };
      statistics?: { viewCount?: string };
      contentDetails?: { duration?: string };
      liveStreamingDetails?: object;
    }[];
  }>("videos", { part: "snippet,statistics,contentDetails,liveStreamingDetails", id: ids.join(","), maxResults: "50" }, opts.apiKey);

  return (videos.items ?? []).map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    views: Number(v.statistics?.viewCount ?? 0),
    durationSec: parseDuration(v.contentDetails?.duration ?? ""),
    isLive: Boolean(v.liveStreamingDetails) || (v.snippet.liveBroadcastContent ?? "none") !== "none",
  }));
}
