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

/**
 * More gaming niches, offered as one-click "quick add" chips in Settings → Topics (not seeded by default).
 * "gaming-news" is the broad one: viral moments + news across all games.
 */
export const EXTRA_GAMES: Game[] = [
  {
    slug: "gaming-news",
    name: "Gaming news & viral moments",
    priority: 20,
    queries: ["gaming news", "new game trailer", "viral gaming moment", "game reveal"],
    titleMatch: /game|gaming|trailer|reveal|update|patch|ps5|xbox|nintendo|switch|steam|pc gaming/i,
    playlistTitle: "Gaming News Shorts",
    hashtags: ["#Gaming", "#GamingNews", "#Shorts"],
    color: "#a78bfa",
  },
  { slug: "valorant", name: "Valorant", priority: 21, queries: ["Valorant"], titleMatch: /valorant/i, playlistTitle: "Valorant Shorts", hashtags: ["#Valorant", "#Shorts"], color: "#ff4655" },
  { slug: "ea-fc", name: "EA Sports FC", priority: 22, queries: ["EA FC", "EA Sports FC"], titleMatch: /\b(ea\s*(sports\s*)?fc|fc\s*2\d|fut)\b/i, playlistTitle: "EA FC Shorts", hashtags: ["#EAFC", "#Shorts"], color: "#22c55e" },
  { slug: "pokemon", name: "Pokémon", priority: 23, queries: ["Pokemon"], titleMatch: /pok[eé]mon/i, playlistTitle: "Pokémon Shorts", hashtags: ["#Pokemon", "#Shorts"], color: "#facc15" },
  { slug: "nintendo", name: "Nintendo / Switch 2", priority: 24, queries: ["Nintendo Switch 2", "Nintendo Direct"], titleMatch: /nintendo|switch\s*2|mario|zelda/i, playlistTitle: "Nintendo Shorts", hashtags: ["#Nintendo", "#Switch2", "#Shorts"], color: "#ef4444" },
  { slug: "cs2", name: "Counter-Strike 2", priority: 25, queries: ["CS2", "Counter-Strike 2"], titleMatch: /\bcs2\b|counter[-\s]?strike/i, playlistTitle: "CS2 Shorts", hashtags: ["#CS2", "#Shorts"], color: "#f59e0b" },
  { slug: "apex", name: "Apex Legends", priority: 26, queries: ["Apex Legends"], titleMatch: /apex legends|\bapex\b/i, playlistTitle: "Apex Shorts", hashtags: ["#ApexLegends", "#Shorts"], color: "#dc2626" },
  { slug: "marvel-rivals", name: "Marvel Rivals", priority: 27, queries: ["Marvel Rivals"], titleMatch: /marvel rivals/i, playlistTitle: "Marvel Rivals Shorts", hashtags: ["#MarvelRivals", "#Shorts"], color: "#e11d48" },
  { slug: "genshin", name: "Genshin Impact", priority: 28, queries: ["Genshin Impact"], titleMatch: /genshin/i, playlistTitle: "Genshin Shorts", hashtags: ["#GenshinImpact", "#Shorts"], color: "#60a5fa" },
  { slug: "funny-gaming", name: "Funny gaming moments", priority: 29, queries: ["funny gaming moments", "gaming fails", "gaming memes"], titleMatch: /funny|fail|meme|moment|lol|rage|clutch/i, playlistTitle: "Funny Gaming Moments", hashtags: ["#Gaming", "#Funny", "#Shorts"], color: "#fb923c" },
];

export const GAMES_BY_SLUG = Object.fromEntries([...GAMES, ...EXTRA_GAMES].map((g) => [g.slug, g])) as Record<string, Game>;

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
