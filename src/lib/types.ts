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
  angle: string;
  thumbnailText: string;
  segments: { startSec: number; voiceover: string; onScreenText: string; visual: string }[];
  sources: { title: string; channel: string; url: string }[];
  riskNotes: string;
  model: string;
  generatedAt: string;
}

export interface Clip {
  id: string;
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

export interface Settings {
  autopilot: boolean;
  /** HH:MM, UTC */
  uploadTime: string;
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
  /** Ordered fallback chain; index 0 is tried first */
  games: { slug: string; enabled: boolean }[];
  youtubeConnected: boolean;
  youtubeChannelTitle?: string;
  /** Visibility of uploads. Unverified Google apps can only upload as private (YouTube API policy). */
  youtubePrivacy: "private" | "unlisted" | "public";
}

export type ClipPatch = Partial<Pick<Clip, "status" | "title" | "description" | "tags" | "scheduledFor">>;

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
