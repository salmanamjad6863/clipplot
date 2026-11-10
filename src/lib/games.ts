/**
 * Niche config. GTA 6 is the primary game; when it has no strong trend today,
 * discovery falls back down this list in priority order.
 * Each game gets its own YouTube playlist (auto-created on first upload).
 */
export interface Game {
  slug: string;
  name: string;
  /** Lower = tried first */
  priority: number;
  primary?: boolean;
  /** YouTube search queries used for trend discovery */
  queries: string[];
  /** Title must match this to count — YouTube search is fuzzy (e.g. "GTA 6" also returns GTA 5 streams) */
  titleMatch: RegExp;
  /** Title of the playlist created on your channel */
  playlistTitle: string;
  hashtags: string[];
  /** Accent used in the UI chip */
  color: string;
}

export const GAMES: Game[] = [
  {
    slug: "gta-6",
    name: "GTA 6",
    priority: 0,
    primary: true,
    queries: ["GTA 6", "GTA VI", "Grand Theft Auto 6 trailer", "GTA 6 gameplay"],
    titleMatch: /\b(gta|grand theft auto)\s*(6|vi)\b|#gta6|#gtavi|\bgta6\b|\bgtavi\b/i,
    playlistTitle: "GTA 6 Shorts",
    hashtags: ["#GTA6", "#GTAVI", "#Shorts"],
    color: "#ff5e7e",
  },
  {
    slug: "gta-5",
    name: "GTA 5 / Online",
    priority: 1,
    queries: ["GTA 5", "GTA Online"],
    titleMatch: /\b(gta|grand theft auto)\s*(5|v)\b|gta online|#gta5|\bgta5\b/i,
    playlistTitle: "GTA 5 & Online Shorts",
    hashtags: ["#GTA5", "#GTAOnline", "#Shorts"],
    color: "#ffb35c",
  },
  {
    slug: "rdr2",
    name: "Red Dead Redemption 2",
    priority: 2,
    queries: ["Red Dead Redemption 2", "RDR2"],
    titleMatch: /red dead|\brdr\s*2\b|#rdr2/i,
    playlistTitle: "Red Dead Redemption 2 Shorts",
    hashtags: ["#RDR2", "#RedDeadRedemption2", "#Shorts"],
    color: "#f87171",
  },
  {
    slug: "minecraft",
    name: "Minecraft",
    priority: 3,
    queries: ["Minecraft"],
    titleMatch: /minecraft/i,
    playlistTitle: "Minecraft Shorts",
    hashtags: ["#Minecraft", "#Shorts"],
    color: "#34d399",
  },
  {
    slug: "fortnite",
    name: "Fortnite",
    priority: 4,
    queries: ["Fortnite"],
    titleMatch: /fortnite/i,
    playlistTitle: "Fortnite Shorts",
    hashtags: ["#Fortnite", "#Shorts"],
    color: "#8b5cf6",
  },
  {
    slug: "call-of-duty",
    name: "Call of Duty",
    priority: 5,
    queries: ["Call of Duty", "Warzone"],
    titleMatch: /call of duty|\bcod\b|warzone|black ops|modern warfare/i,
    playlistTitle: "Call of Duty Shorts",
    hashtags: ["#CallOfDuty", "#Warzone", "#Shorts"],
    color: "#a3a3a3",
  },
  {
    slug: "elden-ring",
    name: "Elden Ring",
    priority: 6,
    queries: ["Elden Ring", "Elden Ring Nightreign"],
    titleMatch: /elden ring|nightreign/i,
    playlistTitle: "Elden Ring Shorts",
    hashtags: ["#EldenRing", "#Shorts"],
    color: "#fbbf24",
  },
  {
    slug: "roblox",
    name: "Roblox",
    priority: 7,
    queries: ["Roblox"],
    titleMatch: /roblox/i,
    playlistTitle: "Roblox Shorts",
    hashtags: ["#Roblox", "#Shorts"],
    color: "#38e1d6",
  },
];

export const GAMES_BY_SLUG = Object.fromEntries(GAMES.map((g) => [g.slug, g])) as Record<string, Game>;

/** Discovery rules for the daily fallback chain */
export const DISCOVERY = {
  /** Clips to produce per day */
  dailyTarget: 1,
  /** Only consider videos published in the last N hours */
  lookbackHours: 48,
  /** A trend counts as "viral" above this many views per hour */
  minViewsPerHour: 5_000,
  /** Max games tried before giving up for the day */
  maxFallbackDepth: 4,
} as const;
