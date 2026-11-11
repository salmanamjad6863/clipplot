/**
 * Topics = the games / niches a workspace covers, fully editable in Settings → Topics.
 * The 8 built-in games (src/lib/games.ts) are presets; you can edit them, add custom topics
 * (any game or subject), set a daily count per topic, and give Claude style notes per topic.
 * Pure helpers — used on both server and client.
 */
import { GAMES_BY_SLUG, type Game } from "./games";

export interface Topic {
  slug: string;
  name: string;
  enabled: boolean;
  /** Position in the list (fallback order); lower = first */
  priority: number;
  /** YouTube search terms (OR-ed into one search, ~102 quota units per topic per run) */
  queries: string[];
  /** A video title must contain one of these to count (empty = built-in rule for presets / anything for custom) */
  keywords: string[];
  /** Up to 3 hashtags added to descriptions (YouTube shows the first 3 above the title) */
  hashtags: string[];
  /** Playlist for this topic's Shorts ("— Full Videos" is added for long videos) */
  playlistTitle: string;
  color: string;
  /** "Daily count per topic" mode: Shorts per day for this topic */
  dailyShorts: number;
  /** Extra direction for Claude when writing about this topic */
  notes: string;
  custom: boolean;
}

export type TopicMode = "fallback" | "per_topic";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Title filter: any keyword as a whole word/phrase (spaces optional: "gta 6" also matches "gta6") */
export function topicTitleMatch(t: Pick<Topic, "slug" | "keywords">): RegExp {
  const kws = t.keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return GAMES_BY_SLUG[t.slug]?.titleMatch ?? /./;
  const parts = kws.map((k) => escapeRe(k.toLowerCase()).replace(/\\? +/g, "\\s*"));
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${parts.join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu");
}

export function topicToGame(t: Topic): Game {
  return {
    slug: t.slug,
    name: t.name,
    priority: t.priority,
    queries: t.queries.length ? t.queries : [t.name],
    titleMatch: topicTitleMatch(t),
    playlistTitle: t.playlistTitle || `${t.name} Shorts`,
    hashtags: t.hashtags.slice(0, 3),
    color: t.color,
  };
}

/** Preset → Topic (used for defaults and for rows created before topics were editable) */
export function presetTopic(slug: string, priority: number): Topic | null {
  const g = GAMES_BY_SLUG[slug];
  if (!g) return null;
  return {
    slug,
    name: g.name,
    enabled: true,
    priority,
    queries: g.queries,
    keywords: [],
    hashtags: g.hashtags,
    playlistTitle: g.playlistTitle,
    color: g.color,
    dailyShorts: 1,
    notes: "",
    custom: false,
  };
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "topic"
  );
}

/** How many Shorts a day the workspace makes, whichever mode it's in */
export function dailyShortsTotal(s: { topicMode: TopicMode; topics: Topic[]; formats: { short: { perDay: number } } }): number {
  if (s.topicMode === "per_topic") return s.topics.filter((t) => t.enabled).reduce((n, t) => n + Math.max(0, t.dailyShorts), 0);
  return s.formats.short.perDay;
}

export const TOPIC_COLORS = ["#ff5e7e", "#ffb35c", "#8b5cf6", "#38e1d6", "#34d399", "#f87171", "#fbbf24", "#60a5fa"];
