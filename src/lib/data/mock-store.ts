import "server-only";
import { GAMES } from "../games";
import type { Clip, ClipPatch, Settings, Trend } from "../types";
import type { Store } from "./store";

/**
 * In-memory fallback used only when Supabase keys are missing (e.g. a fresh clone).
 * Resets on server restart.
 */

const now = Date.UTC(2026, 10, 10, 9);
const h = (n: number) => new Date(now - n * 3_600_000).toISOString();
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;

const trends: Trend[] = [
  { id: "t1", game: "gta-6", videoId: "Lq1aZ0dGTa6", url: yt("Lq1aZ0dGTa6"), title: "GTA 6 Leonida skyline detail nobody noticed", channel: "ViceWatch", views: 812_000, viewsPerHour: 41_000, durationSec: 612, publishedAt: h(20), foundAt: h(2), status: "used" },
  { id: "t2", game: "gta-6", videoId: "Bp7cWv3Phys", url: yt("Bp7cWv3Phys"), title: "GTA 6 beach & wave physics breakdown", channel: "FrameByFrame", views: 455_000, viewsPerHour: 19_000, durationSec: 58, publishedAt: h(24), foundAt: h(3), status: "used" },
  { id: "t3", game: "gta-6", videoId: "Tr3hFrTh3ry", url: yt("Tr3hFrTh3ry"), title: "GTA 6 Trailer 3 frame by frame theory", channel: "RockstarIntel", views: 1_240_000, viewsPerHour: 52_000, durationSec: 945, publishedAt: h(24), foundAt: h(4), status: "used" },
  { id: "t4", game: "gta-6", videoId: "Dup1Trailr3", url: yt("Dup1Trailr3"), title: "GTA 6 TRAILER 3 — frame-by-frame THEORY 🤯 #shorts", channel: "ReuploadKing", views: 98_000, viewsPerHour: 8_200, durationSec: 45, publishedAt: h(12), foundAt: h(4), status: "duplicate", duplicateReason: "Same story as “GTA 6 Trailer 3 frame by frame theory” (100% match)" },
  { id: "t5", game: "gta-6", videoId: "Lq1aZ0dGTa6", url: `https://youtu.be/Lq1aZ0dGTa6`, title: "Leonida skyline (mirror)", channel: "ClipFarm", views: 12_000, viewsPerHour: 900, durationSec: 612, publishedAt: h(10), foundAt: h(2), status: "duplicate", duplicateReason: "Video already used" },
  { id: "t6", game: "gta-6", videoId: "Smal1Trend0", url: yt("Smal1Trend0"), title: "GTA 6 phone UI concept", channel: "ConceptLab", views: 30_000, viewsPerHour: 1_100, durationSec: 40, publishedAt: h(27), foundAt: h(2), status: "below_threshold" },
  { id: "t7", game: "gta-5", videoId: "H3istTier5x", url: yt("H3istTier5x"), title: "Every GTA Online heist ranked before GTA 6", channel: "HeistHub", views: 300_000, viewsPerHour: 9_800, durationSec: 1_320, publishedAt: h(30), foundAt: h(5), status: "used" },
  { id: "t8", game: "gta-6", videoId: "LuciaCar0x1", url: yt("LuciaCar0x1"), title: "Lucia's car is a real-world model", channel: "CarSpotter", views: 610_000, viewsPerHour: 25_000, durationSec: 52, publishedAt: h(40), foundAt: h(20), status: "used" },
  { id: "t9", game: "minecraft", videoId: "Redst0neTrk", url: yt("Redst0neTrk"), title: "This redstone trick broke the internet", channel: "BlockLab", views: 2_100_000, viewsPerHour: 60_000, durationSec: 59, publishedAt: h(40), foundAt: h(28), status: "used" },
];

const clip = (c: Omit<Clip, "description" | "tags" | "riskScore"> & Partial<Clip>): Clip => ({
  description: `${c.hook}\n\nDaily ${c.format === "short" ? "Short" : "breakdown"} by ClipPilot.`,
  tags: ["gaming"],
  riskScore: 12,
  ...c,
});

const clips: Clip[] = [
  clip({ id: "c1", game: "gta-6", isFallback: false, format: "short", durationSec: 42, title: "Leonida map detail nobody noticed", hook: "Pause at 0:14 — look at the skyline.", status: "awaiting_approval", trendIds: ["t1"], trendUrl: trends[0].url, viralScore: 92, createdAt: h(2), tags: ["GTA6", "GTAVI", "Leonida"] }),
  clip({ id: "c7", game: "gta-6", isFallback: false, format: "long", durationSec: 9 * 60 + 20, title: "GTA 6 — Every Trailer 3 Secret Explained", hook: "12 details Rockstar hid in plain sight.", status: "awaiting_approval", trendIds: ["t3", "t1", "t2"], trendUrl: trends[2].url, viralScore: 89, riskScore: 22, createdAt: h(3), tags: ["GTA6", "Trailer3", "Breakdown"] }),
  clip({ id: "c2", game: "gta-6", isFallback: false, format: "short", durationSec: 38, title: "Vice City beach physics breakdown", hook: "This wave tech is insane.", status: "rendering", trendIds: ["t2"], trendUrl: trends[1].url, viralScore: 84, createdAt: h(3) }),
  clip({ id: "c3", game: "gta-6", isFallback: false, format: "short", durationSec: 55, title: "Trailer 3 frame-by-frame theory", hook: "Rockstar hid this in plain sight.", status: "scripting", trendIds: ["t3"], trendUrl: trends[2].url, viralScore: 78, createdAt: h(4) }),
  clip({ id: "c4", game: "gta-5", isFallback: true, format: "long", durationSec: 11 * 60, title: "Every GTA Online heist ranked before GTA 6", hook: "Number one surprised everyone.", status: "discovered", trendIds: ["t7"], trendUrl: trends[6].url, viralScore: 71, createdAt: h(5) }),
  clip({ id: "c5", game: "gta-6", isFallback: false, format: "short", durationSec: 31, title: "Lucia's car — real-world model?", hook: "We found the exact car.", status: "scheduled", trendIds: ["t8"], trendUrl: trends[7].url, viralScore: 88, createdAt: h(20), scheduledFor: h(-6) }),
  clip({ id: "c6", game: "minecraft", isFallback: true, format: "short", durationSec: 47, title: "This redstone trick broke the internet", hook: "Mojang never planned for this.", status: "published", trendIds: ["t9"], trendUrl: trends[8].url, youtubeUrl: "https://youtube.com", viralScore: 95, createdAt: h(28), publishedAt: h(24) }),
];

let settings: Settings = {
  autopilot: false,
  uploadTime: "16:00",
  minViewsPerHour: 5_000,
  maxFallbackDepth: 4,
  lookbackHours: 48,
  dedupeWindowDays: 14,
  titleSimilarity: 0.6,
  formats: {
    short: { enabled: true, minSec: 15, maxSec: 60, perDay: 1 },
    long: { enabled: true, minSec: 8 * 60, maxSec: 12 * 60, cadence: "weekly", clipsPerVideo: 8 },
  },
  games: [...GAMES].sort((a, b) => a.priority - b.priority).map((g) => ({ slug: g.slug, enabled: true })),
  youtubeConnected: false,
  youtubePrivacy: "private",
};

export const mockStore: Store = {
  kind: "mock",
  listClips: async () => [...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  getClip: async (id: string) => clips.find((c) => c.id === id) ?? null,
  async updateClip(id: string, patch: ClipPatch) {
    const c = clips.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch);
    if (patch.status === "published") c.publishedAt = new Date().toISOString();
    return c;
  },
  listTrends: async () => [...trends].sort((a, b) => b.foundAt.localeCompare(a.foundAt) || b.viewsPerHour - a.viewsPerHour),
  getSettings: async () => settings,
  async updateSettings(next: Partial<Settings>) {
    settings = { ...settings, ...next, formats: { ...settings.formats, ...next.formats } };
    return settings;
  },

  async findExistingVideoIds(ids) {
    const known = new Set(trends.map((t) => t.videoId));
    return new Set(ids.filter((i) => known.has(i)));
  },
  async recentlyUsed(since) {
    return trends.filter((t) => t.status === "used" && t.foundAt >= since).map((t) => ({ videoId: t.videoId, title: t.title, usedAt: t.foundAt }));
  },
  async recentTrends(since) {
    return trends.filter((t) => (t.status === "new" || t.status === "used") && t.foundAt >= since);
  },
  async lastLongClipAt() {
    return clips.filter((c) => c.format === "long").map((c) => c.createdAt).sort().at(-1) ?? null;
  },
  async countShortsSince(since) {
    return clips.filter((c) => c.format === "short" && c.createdAt >= since).length;
  },
  async getTrendsByIds(ids) {
    return ids.map((i) => trends.find((t) => t.id === i)).filter((t): t is Trend => !!t);
  },
  async claimForScripting(limit) {
    const picked = clips.filter((c) => c.status === "discovered").slice(0, limit);
    for (const c of picked) c.status = "scripting";
    return picked.map((c) => ({ ...c }));
  },
  async claimOneForScripting(id) {
    const c = clips.find((x) => x.id === id);
    if (!c || ["scripting", "scheduled", "published"].includes(c.status)) return null;
    c.status = "scripting";
    return { ...c };
  },
  async saveScript(id, w) {
    const c = clips.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, { ...w, status: "rendering", error: undefined });
    return { ...c };
  },
  async failScript(id, error) {
    const c = clips.find((x) => x.id === id);
    if (c) Object.assign(c, { status: "failed", error });
  },
  // The render worker needs real storage — not available in mock mode
  async claimJob() {
    return null;
  },
  async getJob() {
    return null;
  },
  async createPreviewUpload() {
    throw new Error("Render uploads need Supabase (mock mode)");
  },
  async completeRender() {
    return null;
  },
  async failJob() {
    return { final: true };
  },
  async enqueueJob() {},
  async finishJob() {},
  async cancelQueuedJobs() {
    return 0;
  },
  async getYouTubeCredentials() {
    return { refreshTokenEnc: null, channelId: null, channelTitle: null };
  },
  async saveYouTubeConnection() {
    throw new Error("Connecting YouTube needs Supabase (mock mode)");
  },
  async clearYouTubeConnection() {},
  async getPlaylistId() {
    return null;
  },
  async setPlaylistId() {},
  async markPublished() {
    return null;
  },
  async setClipPlaylist() {},
  async getSchedulerState() {
    return { lastDiscoveryAt: null, lastReleaseAt: null };
  },
  async claimSchedulerRun() {
    return false; // scheduler is off in mock mode
  },
  async resetStuckScripting() {
    return 0;
  },
  async retryFailedScripts() {
    return 0;
  },
  async previewsToCleanup() {
    return [];
  },
  async clearPreview() {},
  async saveDiscovery(plan) {
    const nowIso = new Date().toISOString();
    const idByVideo = new Map<string, string>();
    for (const t of plan.trends) {
      if (trends.some((x) => x.videoId === t.videoId)) continue;
      const id = `t${trends.length + 1}-${t.videoId}`;
      idByVideo.set(t.videoId, id);
      trends.push({ id, ...t, foundAt: nowIso });
    }
    for (const c of plan.clips) {
      clips.push({
        id: `c${clips.length + 1}-${Date.now()}`,
        game: c.game,
        isFallback: c.isFallback,
        format: c.format,
        durationSec: c.durationSec,
        title: c.title,
        hook: "",
        description: "",
        tags: [],
        status: "discovered",
        trendIds: [...c.newTrendVideoIds.map((v) => idByVideo.get(v) ?? v), ...c.existingTrendIds],
        trendUrl: c.trendUrl,
        viralScore: c.viralScore,
        riskScore: 0,
        createdAt: nowIso,
      });
    }
    return { trends: idByVideo.size, clips: plan.clips.length };
  },
};
