import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../api";
import type { Clip, ClipPatch, ClipScript, Settings, Trend } from "../types";
import type { Job, ScriptWrite, Store } from "./store";

/* ---------- Row shapes (snake_case, as in supabase/migrations/0001_init.sql) ---------- */

interface ClipRow {
  id: string;
  game_slug: string;
  is_fallback: boolean;
  format: Clip["format"];
  duration_sec: number;
  title: string;
  hook: string;
  description: string;
  tags: string[];
  status: Clip["status"];
  trend_ids: string[];
  trend_url: string;
  source_url: string | null;
  render_url: string | null;
  youtube_url: string | null;
  playlist_id: string | null;
  viral_score: number;
  risk_score: number;
  script: string | null;
  error: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
}

interface TrendRow {
  id: string;
  game_slug: string;
  youtube_video_id: string;
  url: string;
  title: string;
  channel: string;
  views: number;
  views_per_hour: number;
  duration_sec: number;
  published_at: string | null;
  found_at: string;
  status: Trend["status"];
  duplicate_reason: string | null;
}

interface SettingsRow {
  autopilot: boolean;
  upload_time: string;
  min_views_per_hour: number;
  max_fallback_depth: number;
  lookback_hours: number;
  dedupe_window_days: number;
  title_similarity: number;
  formats: Settings["formats"];
  youtube_refresh_token: string | null;
  youtube_channel_id: string | null;
  youtube_channel_title?: string | null; // added in 0002
  youtube_privacy?: Settings["youtubePrivacy"]; // added in 0002
}

interface GameRow {
  slug: string;
  enabled: boolean;
  priority: number;
}

/* ---------- Mapping ---------- */

const u = <T>(v: T | null) => v ?? undefined;

const toClip = (r: ClipRow): Clip => ({
  id: r.id,
  game: r.game_slug,
  isFallback: r.is_fallback,
  format: r.format,
  durationSec: r.duration_sec,
  title: r.title,
  hook: r.hook,
  description: r.description,
  tags: r.tags,
  status: r.status,
  trendIds: r.trend_ids,
  trendUrl: r.trend_url,
  sourceUrl: u(r.source_url),
  renderUrl: u(r.render_url),
  youtubeUrl: u(r.youtube_url),
  playlistId: u(r.playlist_id),
  viralScore: r.viral_score,
  riskScore: r.risk_score,
  script: parseScript(r.script),
  error: u(r.error),
  createdAt: r.created_at,
  scheduledFor: u(r.scheduled_for),
  publishedAt: u(r.published_at),
});

function parseScript(raw: string | null): ClipScript | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ClipScript;
  } catch {
    return undefined;
  }
}

const toTrend = (r: TrendRow): Trend => ({
  id: r.id,
  game: r.game_slug,
  videoId: r.youtube_video_id,
  url: r.url,
  title: r.title,
  channel: r.channel,
  views: Number(r.views),
  viewsPerHour: r.views_per_hour,
  durationSec: r.duration_sec,
  publishedAt: r.published_at ?? r.found_at,
  foundAt: r.found_at,
  status: r.status,
  duplicateReason: u(r.duplicate_reason),
});

const clipPatchToRow = (p: ClipPatch) => ({
  ...(p.status !== undefined && { status: p.status }),
  ...(p.title !== undefined && { title: p.title }),
  ...(p.description !== undefined && { description: p.description }),
  ...(p.tags !== undefined && { tags: p.tags }),
  ...(p.scheduledFor !== undefined && { scheduled_for: p.scheduledFor }),
});

interface JobRow {
  id: string;
  clip_id: string;
  type: Job["type"];
  status: Job["status"];
  attempts: number;
  error: string | null;
}
const toJob = (r: JobRow): Job => ({ id: r.id, clipId: r.clip_id, type: r.type, status: r.status, attempts: r.attempts, error: u(r.error) });

export const RENDER_BUCKET = "renders";
const MAX_ATTEMPTS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- Store ---------- */

function fail(what: string, error: { message: string; code?: string }): never {
  if (error.code === "PGRST204" || error.code === "42703") {
    throw new HttpError(503, "Database needs an update — run supabase/migrations/0002_youtube.sql in the Supabase SQL Editor");
  }
  if (error.code === "PGRST205" || error.code === "42P01") {
    throw new HttpError(503, "Database not set up — run supabase/migrations/0001_init.sql in the Supabase SQL Editor");
  }
  throw new Error(`Supabase ${what}: ${error.message}`);
}

export function createSupabaseStore(url: string, secretKey: string): Store {
  const sb: SupabaseClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function getSettings(): Promise<Settings> {
    const [s, g] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single<SettingsRow>(),
      sb.from("games").select("slug, enabled, priority").order("priority").returns<GameRow[]>(),
    ]);
    if (s.error) fail("settings", s.error);
    if (g.error) fail("games", g.error);
    const r = s.data;
    return {
      autopilot: r.autopilot,
      uploadTime: r.upload_time,
      minViewsPerHour: r.min_views_per_hour,
      maxFallbackDepth: r.max_fallback_depth,
      lookbackHours: r.lookback_hours,
      dedupeWindowDays: r.dedupe_window_days,
      titleSimilarity: r.title_similarity,
      formats: r.formats,
      games: g.data.map((x) => ({ slug: x.slug, enabled: x.enabled })),
      youtubeConnected: Boolean(r.youtube_refresh_token),
      youtubeChannelTitle: r.youtube_channel_title ?? undefined,
      youtubePrivacy: r.youtube_privacy ?? "private",
    };
  }

  return {
    kind: "supabase",

    async listClips() {
      const { data, error } = await sb.from("clips").select("*").order("created_at", { ascending: false }).limit(500).returns<ClipRow[]>();
      if (error) fail("clips", error);
      return data.map(toClip);
    },

    async getClip(id) {
      if (!UUID_RE.test(id)) return null;
      const { data, error } = await sb.from("clips").select("*").eq("id", id).maybeSingle<ClipRow>();
      if (error) fail("clip", error);
      return data ? toClip(data) : null;
    },

    async updateClip(id, patch) {
      if (!UUID_RE.test(id)) return null;
      const row: Record<string, unknown> = clipPatchToRow(patch);
      if (patch.status === "published") row.published_at = new Date().toISOString();
      const { data, error } = await sb.from("clips").update(row).eq("id", id).select("*").maybeSingle<ClipRow>();
      if (error) fail("update clip", error);
      return data ? toClip(data) : null;
    },

    async listTrends() {
      const { data, error } = await sb
        .from("trends")
        .select("*")
        .order("found_at", { ascending: false })
        .order("views_per_hour", { ascending: false })
        .limit(200)
        .returns<TrendRow[]>();
      if (error) fail("trends", error);
      return data.map(toTrend);
    },

    getSettings,

    /* ---------- discovery ---------- */

    async findExistingVideoIds(videoIds) {
      if (videoIds.length === 0) return new Set();
      const { data, error } = await sb.from("trends").select("youtube_video_id").in("youtube_video_id", videoIds);
      if (error) fail("find trends", error);
      return new Set((data as { youtube_video_id: string }[]).map((r) => r.youtube_video_id));
    },

    async recentlyUsed(sinceIso) {
      const { data, error } = await sb
        .from("trends")
        .select("youtube_video_id, title, found_at")
        .eq("status", "used")
        .gte("found_at", sinceIso)
        .returns<{ youtube_video_id: string; title: string; found_at: string }[]>();
      if (error) fail("recently used", error);
      return data.map((r) => ({ videoId: r.youtube_video_id, title: r.title, usedAt: r.found_at }));
    },

    async recentTrends(sinceIso) {
      const { data, error } = await sb
        .from("trends")
        .select("*")
        .in("status", ["new", "used"])
        .gte("found_at", sinceIso)
        .returns<TrendRow[]>();
      if (error) fail("recent trends", error);
      return data.map(toTrend);
    },

    async lastLongClipAt() {
      const { data, error } = await sb
        .from("clips")
        .select("created_at")
        .eq("format", "long")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string }>();
      if (error) fail("last long clip", error);
      return data?.created_at ?? null;
    },

    async countShortsSince(sinceIso) {
      const { count, error } = await sb
        .from("clips")
        .select("id", { count: "exact" })
        .eq("format", "short")
        .gte("created_at", sinceIso)
        .limit(1);
      if (error) fail("count shorts", error);
      return count ?? 0;
    },

    async saveDiscovery(plan) {
      let trendRows: { id: string; youtube_video_id: string }[] = [];
      if (plan.trends.length) {
        const { data, error } = await sb
          .from("trends")
          .upsert(
            plan.trends.map((t) => ({
              game_slug: t.game,
              youtube_video_id: t.videoId,
              url: t.url,
              title: t.title,
              channel: t.channel,
              views: t.views,
              views_per_hour: t.viewsPerHour,
              duration_sec: t.durationSec,
              published_at: t.publishedAt,
              status: t.status,
              duplicate_reason: t.duplicateReason ?? null,
            })),
            // UNIQUE(youtube_video_id): a concurrent run can never insert the same video twice
            { onConflict: "youtube_video_id", ignoreDuplicates: true },
          )
          .select("id, youtube_video_id");
        if (error) fail("insert trends", error);
        trendRows = data as typeof trendRows;
      }
      const idByVideo = new Map(trendRows.map((r) => [r.youtube_video_id, r.id]));

      const clipRows = plan.clips
        .map((c) => {
          const ids = [...c.newTrendVideoIds.map((v) => idByVideo.get(v)).filter((x): x is string => !!x), ...c.existingTrendIds];
          // a Short whose trend was taken by a concurrent run is dropped
          if (c.format === "short" && ids.length === 0) return null;
          return {
            game_slug: c.game,
            is_fallback: c.isFallback,
            format: c.format,
            duration_sec: c.durationSec,
            title: c.title.slice(0, 100),
            status: "discovered",
            trend_ids: ids,
            trend_url: c.trendUrl,
            viral_score: c.viralScore,
          };
        })
        .filter((r) => r !== null);

      if (clipRows.length) {
        const { error } = await sb.from("clips").insert(clipRows);
        if (error) fail("insert clips", error);
        const reused = plan.clips.flatMap((c) => c.existingTrendIds);
        if (reused.length) {
          const { error: e2 } = await sb.from("trends").update({ status: "used" }).in("id", reused);
          if (e2) fail("mark trends used", e2);
        }
      }
      return { trends: trendRows.length, clips: clipRows.length };
    },

    /* ---------- scripting ---------- */

    async getTrendsByIds(ids) {
      const valid = ids.filter((i) => UUID_RE.test(i));
      if (valid.length === 0) return [];
      const { data, error } = await sb.from("trends").select("*").in("id", valid).returns<TrendRow[]>();
      if (error) fail("trends by id", error);
      const byId = new Map(data.map((r) => [r.id, toTrend(r)]));
      return valid.map((i) => byId.get(i)).filter((t): t is Trend => !!t); // keep the clip's order
    },

    async claimForScripting(limit) {
      const { data: ids, error } = await sb
        .from("clips")
        .select("id")
        .eq("status", "discovered")
        .order("created_at")
        .limit(limit)
        .returns<{ id: string }[]>();
      if (error) fail("find clips to script", error);
      if (ids.length === 0) return [];
      // the status guard makes this a compare-and-set: two runners can't claim the same clip
      const { data, error: e2 } = await sb
        .from("clips")
        .update({ status: "scripting", error: null })
        .in("id", ids.map((r) => r.id))
        .eq("status", "discovered")
        .select("*")
        .returns<ClipRow[]>();
      if (e2) fail("claim clips", e2);
      return data.map(toClip);
    },

    async claimOneForScripting(id) {
      if (!UUID_RE.test(id)) return null;
      const { data, error } = await sb
        .from("clips")
        .update({ status: "scripting", error: null })
        .eq("id", id)
        .in("status", ["discovered", "failed", "rendering", "awaiting_approval", "rejected"])
        .select("*")
        .maybeSingle<ClipRow>();
      if (error) fail("claim clip", error);
      return data ? toClip(data) : null;
    },

    async saveScript(id, w: ScriptWrite) {
      const { data, error } = await sb
        .from("clips")
        .update({
          hook: w.hook,
          title: w.title,
          description: w.description,
          tags: w.tags,
          risk_score: w.riskScore,
          script: JSON.stringify(w.script),
          status: "rendering",
          error: null,
        })
        .eq("id", id)
        .select("*")
        .maybeSingle<ClipRow>();
      if (error) fail("save script", error);
      if (data) {
        // hand off to the render worker (Step 5); skip if a render job is already queued
        const { data: existing } = await sb.from("jobs").select("id").eq("clip_id", id).eq("type", "render").eq("status", "queued").limit(1);
        if (!existing?.length) {
          const { error: e2 } = await sb.from("jobs").insert({ clip_id: id, type: "render" });
          if (e2) fail("queue render job", e2);
        }
      }
      return data ? toClip(data) : null;
    },

    async failScript(id, message) {
      const { error } = await sb.from("clips").update({ status: "failed", error: message.slice(0, 500) }).eq("id", id);
      if (error) fail("mark clip failed", error);
    },

    /* ---------- render worker ---------- */

    async claimJob(type, workerId) {
      const stale = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: candidates, error } = await sb
        .from("jobs")
        .select("id, attempts, status, locked_at")
        .eq("type", type)
        .or(`status.eq.queued,and(status.eq.running,locked_at.lt.${stale})`)
        .order("created_at")
        .limit(5)
        .returns<{ id: string; attempts: number; status: string; locked_at: string | null }[]>();
      if (error) fail("find job", error);

      for (const c of candidates) {
        // compare-and-set on status + attempts so two workers can't grab the same job
        const { data: job, error: e2 } = await sb
          .from("jobs")
          .update({ status: "running", locked_by: workerId, locked_at: new Date().toISOString(), attempts: c.attempts + 1 })
          .eq("id", c.id)
          .eq("status", c.status)
          .eq("attempts", c.attempts)
          .select("*")
          .maybeSingle<JobRow>();
        if (e2) fail("claim job", e2);
        if (!job) continue;
        const { data: clip, error: e3 } = await sb.from("clips").select("*").eq("id", job.clip_id).maybeSingle<ClipRow>();
        if (e3) fail("job clip", e3);
        if (!clip) {
          await sb.from("jobs").update({ status: "failed", error: "Clip deleted" }).eq("id", job.id);
          continue;
        }
        return { job: toJob(job), clip: toClip(clip) };
      }
      return null;
    },

    async getJob(id) {
      if (!UUID_RE.test(id)) return null;
      const { data, error } = await sb.from("jobs").select("*").eq("id", id).maybeSingle<JobRow>();
      if (error) fail("get job", error);
      return data ? toJob(data) : null;
    },

    async createPreviewUpload(clipId, ext) {
      const path = `${clipId}/preview.${ext}`;
      const { data, error } = await sb.storage.from(RENDER_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) {
        if (/bucket not found/i.test(error.message)) {
          throw new HttpError(503, `Storage bucket "${RENDER_BUCKET}" missing — run pnpm db:seed`);
        }
        throw new Error(`Supabase storage: ${error.message}`);
      }
      const { data: pub } = sb.storage.from(RENDER_BUCKET).getPublicUrl(path);
      return { path, token: data.token, signedUrl: data.signedUrl, publicUrl: pub.publicUrl };
    },

    async completeRender(jobId, r) {
      // cache-bust so a re-render shows the new preview
      const previewUrl = `${r.previewUrl}?v=${Date.now()}`;
      const { data, error } = await sb
        .from("clips")
        .update({ status: "awaiting_approval", render_url: previewUrl, duration_sec: Math.round(r.durationSec), error: null })
        .eq("id", r.clipId)
        .select("*")
        .maybeSingle<ClipRow>();
      if (error) fail("complete render", error);
      const { error: e2 } = await sb.from("jobs").update({ status: "done", error: null }).eq("id", jobId);
      if (e2) fail("finish job", e2);
      return data ? toClip(data) : null;
    },

    async failJob(jobId, message) {
      const { data: job, error } = await sb.from("jobs").select("*").eq("id", jobId).maybeSingle<JobRow>();
      if (error) fail("get job", error);
      if (!job) return { final: true };
      const final = job.attempts >= MAX_ATTEMPTS;
      const { error: e2 } = await sb
        .from("jobs")
        .update({ status: final ? "failed" : "queued", error: message.slice(0, 500), locked_by: null, locked_at: null })
        .eq("id", jobId);
      if (e2) fail("fail job", e2);
      if (final) {
        await sb.from("clips").update({ status: "failed", error: `Render: ${message}`.slice(0, 500) }).eq("id", job.clip_id);
      }
      return { final };
    },

    async enqueueJob(clipId, type) {
      const { error } = await sb.from("jobs").insert({ clip_id: clipId, type });
      // 23505 = unique index jobs_one_active_per_clip: already queued/running → fine
      if (error && error.code !== "23505") fail("queue job", error);
    },

    async cancelQueuedJobs(clipId, type) {
      const { data, error } = await sb
        .from("jobs")
        .delete()
        .eq("clip_id", clipId)
        .eq("type", type)
        .eq("status", "queued")
        .select("id");
      if (error) fail("cancel jobs", error);
      return data?.length ?? 0;
    },

    /* ---------- YouTube ---------- */

    async getYouTubeCredentials() {
      const { data, error } = await sb
        .from("settings")
        .select("*")
        .eq("id", 1)
        .single<SettingsRow>();
      if (error) fail("youtube credentials", error);
      return {
        refreshTokenEnc: data.youtube_refresh_token,
        channelId: data.youtube_channel_id,
        channelTitle: data.youtube_channel_title ?? null,
      };
    },

    async saveYouTubeConnection(c) {
      const { error } = await sb
        .from("settings")
        .update({ youtube_refresh_token: c.refreshTokenEnc, youtube_channel_id: c.channelId, youtube_channel_title: c.channelTitle })
        .eq("id", 1);
      if (error) fail("save youtube", error);
    },

    async clearYouTubeConnection() {
      const { error } = await sb
        .from("settings")
        .update({ youtube_refresh_token: null, youtube_channel_id: null, youtube_channel_title: null })
        .eq("id", 1);
      if (error) fail("clear youtube", error);
      // playlists belong to the old channel
      const { error: e2 } = await sb.from("games").update({ short_playlist_id: null, long_playlist_id: null }).neq("slug", "");
      if (e2) fail("clear playlists", e2);
    },

    async getPlaylistId(game, format) {
      const col = format === "short" ? "short_playlist_id" : "long_playlist_id";
      const { data, error } = await sb.from("games").select(col).eq("slug", game).maybeSingle<Record<string, string | null>>();
      if (error) fail("playlist id", error);
      return data?.[col] ?? null;
    },

    async setPlaylistId(game, format, playlistId) {
      const col = format === "short" ? "short_playlist_id" : "long_playlist_id";
      const { error } = await sb.from("games").update({ [col]: playlistId }).eq("slug", game);
      if (error) fail("set playlist", error);
    },

    async markPublished(jobId, clipId, r) {
      const { data, error } = await sb
        .from("clips")
        .update({
          status: "published",
          youtube_video_id: r.youtubeVideoId,
          youtube_url: r.youtubeUrl,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", clipId)
        .select("*")
        .maybeSingle<ClipRow>();
      if (error) fail("mark published", error);
      const { error: e2 } = await sb.from("jobs").update({ status: "done", error: null }).eq("id", jobId);
      if (e2) fail("finish upload job", e2);
      return data ? toClip(data) : null;
    },

    async setClipPlaylist(clipId, playlistId) {
      const { error } = await sb.from("clips").update({ playlist_id: playlistId }).eq("id", clipId);
      if (error) fail("set clip playlist", error);
    },

    async updateSettings(next) {
      const row: Record<string, unknown> = {};
      if (next.autopilot !== undefined) row.autopilot = next.autopilot;
      if (next.uploadTime !== undefined) row.upload_time = next.uploadTime;
      if (next.minViewsPerHour !== undefined) row.min_views_per_hour = next.minViewsPerHour;
      if (next.maxFallbackDepth !== undefined) row.max_fallback_depth = next.maxFallbackDepth;
      if (next.lookbackHours !== undefined) row.lookback_hours = next.lookbackHours;
      if (next.dedupeWindowDays !== undefined) row.dedupe_window_days = next.dedupeWindowDays;
      if (next.titleSimilarity !== undefined) row.title_similarity = next.titleSimilarity;
      if (next.youtubePrivacy !== undefined) row.youtube_privacy = next.youtubePrivacy;
      if (next.formats) {
        const current = await getSettings();
        row.formats = { ...current.formats, ...next.formats };
      }

      if (Object.keys(row).length) {
        const { error } = await sb.from("settings").update(row).eq("id", 1);
        if (error) fail("update settings", error);
      }

      if (next.games) {
        // priority = position in the list → fallback order
        const results = await Promise.all(
          next.games.map((g, priority) => sb.from("games").update({ priority, enabled: g.enabled }).eq("slug", g.slug)),
        );
        const bad = results.find((r) => r.error);
        if (bad?.error) fail("update games", bad.error);
      }

      return getSettings();
    },
  };
}
