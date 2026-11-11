import "server-only";
import { getStore } from "../data";
import type { Clip } from "../types";
import { getAccessToken } from "./channel";

/**
 * Performance loop: refresh stats of recently published videos, read retention from YouTube
 * Analytics (when that permission was granted), and post the suggested comment once a video is public.
 * Quota: videos.list 1 unit per 50 videos; Analytics API has its own quota; a comment costs 50 units.
 */
const DAYS = 30;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function getJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    throw Object.assign(new Error(`${res.status} ${body.error?.message ?? res.statusText}`), { reason, status: res.status });
  }
  return body;
}

export async function refreshStats(ws: string): Promise<{ updated: number; analytics: boolean; comments: number }> {
  const store = getStore(ws);
  const settings = await store.getSettings();
  if (!settings.youtubeConnected) return { updated: 0, analytics: false, comments: 0 };
  const clips = await store.publishedForStats(new Date(Date.now() - DAYS * 86_400_000).toISOString(), 50);
  if (clips.length === 0) return { updated: 0, analytics: false, comments: 0 };
  const { accessToken } = await getAccessToken(ws);
  const byVideo = new Map(clips.map((c) => [c.youtubeVideoId!, c]));

  // 1. public counters (works for your own private videos too, because we ask as the channel)
  const v = await getJson<{ items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
    `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "statistics", id: [...byVideo.keys()].join(",") })}`,
    accessToken,
  );
  const rows = new Map<string, { clipId: string; views: number; likes: number; comments: number; avgViewPct?: number }>();
  for (const it of v.items ?? []) {
    const c = byVideo.get(it.id);
    if (!c) continue;
    rows.set(it.id, {
      clipId: c.id,
      views: Number(it.statistics?.viewCount ?? 0),
      likes: Number(it.statistics?.likeCount ?? 0),
      comments: Number(it.statistics?.commentCount ?? 0),
    });
  }

  // 2. retention from YouTube Analytics (data lags ~1–2 days)
  let analytics = false;
  if (settings.youtubeScopes?.analytics) {
    try {
      const qs = new URLSearchParams({
        ids: "channel==MINE",
        startDate: iso(new Date(Date.now() - DAYS * 86_400_000)),
        endDate: iso(new Date()),
        metrics: "views,averageViewPercentage",
        dimensions: "video",
        filters: `video==${[...byVideo.keys()].join(",")}`,
      });
      const a = await getJson<{ rows?: [string, number, number][] }>(`https://youtubeanalytics.googleapis.com/v2/reports?${qs}`, accessToken);
      for (const [videoId, , pct] of a.rows ?? []) {
        const r = rows.get(videoId);
        if (r) r.avgViewPct = Math.round(pct * 10) / 10;
      }
      analytics = true;
    } catch (err) {
      console.warn(`[stats] analytics unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }
  await store.saveStats([...rows.values()]);

  // 3. post the suggested comment once the video can take comments (private videos can't)
  let comments = 0;
  if (settings.youtubeScopes?.comments) {
    for (const c of clips) {
      if (c.commentPosted || !c.script?.pinnedComment || !c.youtubeVideoId) continue;
      if (await postComment(c, accessToken)) {
        await store.markCommentPosted(c.id);
        comments++;
      }
    }
  }
  return { updated: rows.size, analytics, comments };
}

async function postComment(c: Clip, token: string): Promise<boolean> {
  try {
    await getJson("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", token, {
      method: "POST",
      body: JSON.stringify({
        snippet: { videoId: c.youtubeVideoId, topLevelComment: { snippet: { textOriginal: c.script!.pinnedComment } } },
      }),
    });
    console.info(`[stats] posted comment on ${c.youtubeVideoId} — pin it in YouTube Studio`);
    return true;
  } catch (err) {
    // 403 on private/unlisted-without-comments videos is expected → try again on the next refresh
    const reason = (err as { reason?: string }).reason;
    if (reason !== "forbidden" && reason !== "commentsDisabled") console.warn(`[stats] comment on ${c.youtubeVideoId} failed: ${(err as Error).message}`);
    return false;
  }
}
