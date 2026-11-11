import type { Topic, TopicMode } from "./topics";

/** The workspace everything lived in before workspaces existed (migration 0003) */
export const MAIN_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  youtubeConnected: boolean;
  channelTitle?: string;
}

export type ClipStatus =
  | "discovered" // trend found (metadata only)
  | "scripting" // Claude writing hook/script/title
  | "rendering" // worker building the video
  | "awaiting_approval" // ready for you to review
  | "scheduled" // approved, waiting for upload slot
  | "published" // live on YouTube
  | "rejected"
  | "failed";

/** short = vertical 9:16 reel/Short, long = horizontal 16:9 full video */
export type VideoFormat = "short" | "long";

export interface ClipScript {
  /** Narrator voice for this clip only (VOICES id); unset = Settings default */
  voice?: string;
  /** Background cut from the source creator's video (labelled in the UI) */
  testRender?: boolean;
  angle: string;
  thumbnailText: string;
  segments: { startSec: number; voiceover: string; onScreenText: string; visual: string; emphasis?: string[] }[];
  /** Question to pin as the first comment (drives comments) */
  pinnedComment?: string;
  /** Other honest title angles for A/B testing */
  titleAlternatives?: string[];
  /** Full videos: chapter marks from the real render timing (added by the worker) */
  chapters?: { t: number; title: string }[];
  sources: { title: string; channel: string; url: string }[];
  riskNotes: string;
  model: string;
  generatedAt: string;
}

export type Privacy = "private" | "unlisted" | "public";

export interface Clip {
  id: string;
  /** Visibility picked when approving (undefined = workspace default) */
  privacy?: Privacy;
  /** Workspace (= YouTube channel) this clip belongs to */
  workspaceId: string;
  /** Game slug from src/lib/games.ts */
  game: string;
  /** True when the primary game (GTA 6) had no strong trend and we fell back */
  isFallback: boolean;
  format: VideoFormat;
  /** Target / rendered length in seconds */
  durationSec: number;
  title: string;
  hook: string;
  description: string;
  tags: string[];
  status: ClipStatus;
  /** Trend video IDs this clip is based on (1 for a Short, several for a long compilation) */
  trendIds: string[];
  /** Where the trend was spotted (link only — we never store the video) */
  trendUrl: string;
  /** Rights-safe source footage link (your own capture, official press kit, licensed) */
  sourceUrl?: string;
  /** Rendered video stored in R2 */
  renderUrl?: string;
  youtubeUrl?: string;
  /** Live upload status for approved clips: queued = waiting for the worker, uploading = worker is sending it now */
  uploadState?: "queued" | "uploading";
  youtubeVideoId?: string;
  /** Performance (refreshed every few hours after publishing) */
  views?: number;
  likes?: number;
  comments?: number;
  /** YouTube Analytics: average % of the video watched (needs the analytics permission) */
  avgViewPct?: number;
  statsAt?: string;
  /** The pinned-comment suggestion was posted on YouTube */
  commentPosted?: boolean;
  /** Per-game, per-format YouTube playlist the video is added to */
  playlistId?: string;
  viralScore: number; // 0-100
  riskScore: number; // 0-100, policy/copyright risk from Claude
  /** Claude-written script (Step 4) */
  script?: ClipScript;
  /** Last pipeline error, e.g. script generation failed */
  error?: string;
  createdAt: string;
  scheduledFor?: string;
  publishedAt?: string;
}

export type TrendStatus = "new" | "used" | "duplicate" | "below_threshold";

export interface Trend {
  id: string;
  game: string;
  /** YouTube video ID — the dedupe key */
  videoId: string;
  url: string;
  title: string;
  channel: string;
  views: number;
  viewsPerHour: number;
  durationSec: number;
  publishedAt: string;
  foundAt: string;
  status: TrendStatus;
  /** Why it was skipped, when status = duplicate */
  duplicateReason?: string;
}

export interface FormatSettings {
  enabled: boolean;
  minSec: number;
  maxSec: number;
}

/** How the worker builds each video — editable in Settings → Video & copyright */
export interface RenderSettings {
  /** auto = your footage from worker/footage/<game>/ when present, else gradient; gradient = never use footage;
   *  source = cut up the trend's own YouTube video (may get Content ID claims) */
  footageMode: "auto" | "gradient" | "source";
  /** Longest continuous piece of any footage file, in seconds (0 = no limit, one continuous piece) */
  maxCutSec: number;
  /** Keep the footage's own sound under the voiceover (off = picture only — far fewer Content ID matches) */
  keepFootageAudio: boolean;
  /** Footage sound level when kept, 0–100 % */
  footageVolume: number;
  /** VOICES id: "kokoro:<voice>" (neural) or a macOS voice name (`say -v '?'`) */
  voice: string;
  /** Speaking speed, words per minute */
  voiceRate: number;
  /** Words per caption on Shorts (full videos use double) */
  captionWords: number;
  /** Corner watermark, empty = none */
  brandText: string;
}

export const DEFAULT_RENDER: RenderSettings = {
  footageMode: "auto",
  maxCutSec: 3,
  keepFootageAudio: false,
  footageVolume: 15,
  voice: "kokoro:am_michael",
  voiceRate: 185,
  captionWords: 3,
  brandText: "ClipPilot",
};

/** Narrator voices. "kokoro:*" = free neural voices (natural, run on your Mac); others = macOS `say` voices. */
export const isVoiceId = (v: string) => /^(kokoro:[a-z]{2}_[a-z]{2,20}|[A-Za-z][A-Za-z ()'.-]{0,40})$/.test(v);

export const VOICES = [
  { id: "kokoro:af_heart", label: "Heart — US female (most natural)" },
  { id: "kokoro:af_bella", label: "Bella — US female, energetic" },
  { id: "kokoro:am_michael", label: "Michael — US male" },
  { id: "kokoro:am_fenrir", label: "Fenrir — US male, deep" },
  { id: "kokoro:am_puck", label: "Puck — US male, upbeat" },
  { id: "kokoro:bf_emma", label: "Emma — UK female" },
  { id: "kokoro:bm_george", label: "George — UK male" },
  { id: "Samantha", label: "Samantha — Mac voice (robotic)" },
] as const;

export interface Settings {
  autopilot: boolean;
  /** HH:MM, UTC — the first of uploadTimes (discovery runs 4h before it) */
  uploadTime: string;
  /** All daily upload slots, HH:MM UTC, sorted. Shorts are spread across them. */
  uploadTimes: string[];
  /** Extra checks of the primary game every few hours; only exceptional trends become extra Shorts */
  breakingNews: boolean;
  breakingEveryHours: number;
  /** Which optional Google permissions the YouTube connection has (reconnect to add) */
  youtubeScopes?: { analytics: boolean; comments: boolean };
  minViewsPerHour: number;
  maxFallbackDepth: number;
  lookbackHours: number;
  /** Don't reuse a video, or a near-identical topic, within this many days */
  dedupeWindowDays: number;
  /** 0–1. Titles more similar than this count as the same story */
  titleSimilarity: number;
  formats: {
    short: FormatSettings & { perDay: number };
    long: FormatSettings & { cadence: "daily" | "weekly"; clipsPerVideo: number };
  };
  /** Ordered fallback chain; index 0 is tried first (derived from topics, kept for older code) */
  games: { slug: string; enabled: boolean }[];
  /** Games / niches this workspace covers — editable in Settings → Topics */
  topics: Topic[];
  /** fallback = primary topic first, then the next until the daily count is met; per_topic = each topic its own daily count */
  topicMode: TopicMode;
  /** Channel-wide direction for Claude (tone, audience, recurring format) */
  channelPersona: string;
  render: RenderSettings;
  youtubeConnected: boolean;
  youtubeChannelTitle?: string;
  /** Visibility of uploads. Unverified Google apps can only upload as private (YouTube API policy). */
  youtubePrivacy: "private" | "unlisted" | "public";
  /** Daily scheduler status (read-only, from the server) */
  schedule?: {
    lastDiscoveryAt: string | null;
    lastReleaseAt: string | null;
    nextDiscoveryAt: string | null;
    nextReleaseAt: string | null;
    /** false until migration 0002 is applied */
    ready: boolean;
  };
}

export type ClipPatch = Partial<Pick<Clip, "status" | "title" | "description" | "tags" | "scheduledFor" | "privacy">>;

export const STATUS_META: Record<ClipStatus, { label: string; tone: string }> = {
  discovered: { label: "Discovered", tone: "text-cyan bg-cyan/10" },
  scripting: { label: "Scripting", tone: "text-violet bg-violet/10" },
  rendering: { label: "Rendering", tone: "text-amber bg-amber/10" },
  awaiting_approval: { label: "Needs review", tone: "text-coral bg-coral/10" },
  scheduled: { label: "Scheduled", tone: "text-warning bg-warning/10" },
  published: { label: "Published", tone: "text-success bg-success/10" },
  rejected: { label: "Rejected", tone: "text-muted bg-white/5" },
  failed: { label: "Failed", tone: "text-danger bg-danger/10" },
};

export const FORMAT_META: Record<VideoFormat, { label: string; aspect: string; ratio: string }> = {
  short: { label: "Short", aspect: "aspect-[9/16]", ratio: "9:16" },
  long: { label: "Full video", aspect: "aspect-video", ratio: "16:9" },
};
