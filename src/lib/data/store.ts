import type { UsedItem } from "../dedupe";
import type { DiscoveryPlan } from "../discovery/plan";
import type { Clip, ClipPatch, ClipScript, Settings, Trend } from "../types";

/** Everything the app reads/writes. Implemented by Supabase (real) and an in-memory mock (no keys). */
export interface Store {
  readonly kind: "supabase" | "mock";
  listClips(): Promise<Clip[]>;
  getClip(id: string): Promise<Clip | null>;
  updateClip(id: string, patch: ClipPatch): Promise<Clip | null>;
  listTrends(): Promise<Trend[]>;
  getSettings(): Promise<Settings>;
  updateSettings(next: Partial<Settings>): Promise<Settings>;

  /* ---- discovery ---- */
  /** Which of these YouTube video IDs are already in the trends table */
  findExistingVideoIds(videoIds: string[]): Promise<Set<string>>;
  /** Trends turned into clips since `sinceIso` (for same-story dedupe) */
  recentlyUsed(sinceIso: string): Promise<UsedItem[]>;
  /** All new/used trends since `sinceIso` (for compilations) */
  recentTrends(sinceIso: string): Promise<Trend[]>;
  lastLongClipAt(): Promise<string | null>;
  countShortsSince(sinceIso: string): Promise<number>;
  /** Shorts created since `sinceIso`, per game slug (per-topic daily mode) */
  countShortsByGameSince(sinceIso: string): Promise<Record<string, number>>;
  /** Inserts trends + clips from a plan. Returns how many were actually written. */
  saveDiscovery(plan: DiscoveryPlan): Promise<{ trends: number; clips: number }>;
  /** Manual clip from chosen trends (Trends page "Make clip", "Swap trend") → status discovered, trends marked used */
  createClip(c: NewClip): Promise<Clip>;

  /* ---- scripting ---- */
  getTrendsByIds(ids: string[]): Promise<Trend[]>;
  /** Atomically moves up to `limit` clips from discovered → scripting and returns them */
  claimForScripting(limit: number): Promise<Clip[]>;
  /** Moves a specific clip to scripting (manual regenerate). Null if it's not in a re-scriptable state. */
  claimOneForScripting(id: string): Promise<Clip | null>;
  saveScript(id: string, data: ScriptWrite): Promise<Clip | null>;
  failScript(id: string, error: string): Promise<void>;

  /* ---- render worker ---- */
  /** Claims the oldest queued job of a type (or one stuck running > 30 min). */
  claimJob(type: JobType, workerId: string): Promise<{ job: Job; clip: Clip } | null>;
  getJob(id: string): Promise<Job | null>;
  /** Signed URL the worker PUTs the preview MP4 to; returns the public URL it'll be served at. */
  createPreviewUpload(clipId: string, ext: "mp4" | "jpg"): Promise<{ path: string; token: string; signedUrl: string; publicUrl: string }>;
  completeRender(jobId: string, r: { clipId: string; previewUrl: string; durationSec: number }): Promise<Clip | null>;
  /** Retries up to 3 attempts, then marks the clip failed. */
  failJob(jobId: string, error: string): Promise<{ final: boolean }>;
  /** Queues a job unless one is already queued/running for this clip+type */
  enqueueJob(clipId: string, type: JobType): Promise<void>;
  cancelQueuedJobs(clipId: string, type: JobType): Promise<number>;
  /** Ends a job without touching the clip (e.g. upload cancelled because the clip was un-approved) */
  finishJob(jobId: string, status: "done" | "failed", error?: string): Promise<void>;

  /* ---- YouTube ---- */
  getYouTubeCredentials(): Promise<{ refreshTokenEnc: string | null; channelId: string | null; channelTitle: string | null }>;
  saveYouTubeConnection(c: { refreshTokenEnc: string; channelId: string; channelTitle: string; scopes: string }): Promise<void>;
  clearYouTubeConnection(): Promise<void>;
  getPlaylistId(game: string, format: "short" | "long"): Promise<string | null>;
  setPlaylistId(game: string, format: "short" | "long", playlistId: string | null): Promise<void>;
  markPublished(jobId: string, clipId: string, r: { youtubeVideoId: string; youtubeUrl: string }): Promise<Clip | null>;
  setClipPlaylist(clipId: string, playlistId: string): Promise<void>;

  /* ---- scheduler (Step 7) ---- */
  getSchedulerState(): Promise<SchedulerState>;
  /** Compare-and-set: records a run for this slot. False if another tick already ran it. */
  claimSchedulerRun(kind: SchedulerKind, slotIso: string): Promise<boolean>;

  /* ---- growth (batch 2) ---- */
  /** Published clips with a YouTube id, newest first (for stats refresh) */
  publishedForStats(sinceIso: string, limit: number): Promise<Clip[]>;
  saveStats(rows: { clipId: string; views: number; likes: number; comments: number; avgViewPct?: number }[]): Promise<void>;
  markCommentPosted(clipId: string): Promise<void>;
  saveChapters(clipId: string, chapters: { t: number; title: string }[]): Promise<void>;
  /** Remember whether the last render used source-video footage (test mode). */
  markTestRender(clipId: string, on: boolean): Promise<void>;
  /** Set this clip's narrator voice (null = Settings default) and queue a fresh render. */
  setVoiceAndRerender(clipId: string, voice: string | null): Promise<Clip | null>;
  /** Clips stuck in `scripting` (crash/restart) since before `olderThanIso` → back to discovered */
  resetStuckScripting(olderThanIso: string): Promise<number>;
  /** Failed-script clips → discovered so they're retried (max `limit`) */
  retryFailedScripts(limit: number): Promise<number>;
  /** Published clips whose preview is older than `olderThanIso` and still stored */
  previewsToCleanup(olderThanIso: string): Promise<string[]>;
  /** YouTube data retention: delete trend metadata and clear video stats older than `olderThanIso` */
  purgeStaleYouTubeData(olderThanIso: string): Promise<{ trends: number; stats: number }>;
  /** Deletes the preview from storage and clears render_url */
  clearPreview(clipId: string): Promise<void>;
}

export type SchedulerKind = "discovery" | "release" | "breaking" | "stats";
export interface SchedulerState {
  lastDiscoveryAt: string | null;
  lastReleaseAt: string | null;
  lastBreakingAt: string | null;
  lastStatsAt: string | null;
}

export type JobType = "script" | "render" | "upload";
export interface Job {
  id: string;
  clipId: string;
  type: JobType;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  error?: string;
}

export interface NewClip {
  game: string;
  format: "short" | "long";
  durationSec: number;
  title: string;
  trendIds: string[];
  trendUrl: string;
  viralScore: number;
  isFallback?: boolean;
}

export interface ScriptWrite {
  hook: string;
  title: string;
  description: string;
  tags: string[];
  riskScore: number;
  script: ClipScript;
}
