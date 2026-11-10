// Self-check for the discovery planner with fake YouTube data: `pnpm test:discovery`
import assert from "node:assert/strict";
import { planDiscovery, viralScore, type PlanInput } from "../src/lib/discovery/plan";
import { GAMES } from "../src/lib/games";
import type { Settings } from "../src/lib/types";
import type { VideoMeta } from "../src/lib/youtube/search";
import { parseDuration } from "../src/lib/youtube/search";

const now = Date.UTC(2026, 10, 10, 12);
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

const settings: Settings = {
  autopilot: false,
  uploadTime: "16:00",
  minViewsPerHour: 5000,
  maxFallbackDepth: 4,
  lookbackHours: 48,
  dedupeWindowDays: 14,
  titleSimilarity: 0.6,
  formats: {
    short: { enabled: true, minSec: 15, maxSec: 60, perDay: 1 },
    long: { enabled: true, minSec: 480, maxSec: 720, cadence: "weekly", clipsPerVideo: 8 },
  },
  games: GAMES.map((g) => ({ slug: g.slug, enabled: true })),
  youtubeConnected: false,
};

const v = (id: string, title: string, views: number, h: number): VideoMeta => ({
  videoId: id.padEnd(11, "x"),
  title,
  channel: "Ch",
  publishedAt: hoursAgo(h),
  views,
  durationSec: 50,
  isLive: false,
});

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now,
  settings,
  games: GAMES,
  fetchVideos: async () => [],
  findExisting: async () => new Set(),
  recentlyUsed: [],
  recentTrends: [],
  lastLongClipAt: hoursAgo(24), // long not due
  shortsCreatedToday: 0,
  ...over,
});

// 1. GTA 6 has a strong trend → picked, no fallback, other games never fetched
{
  const fetched: string[] = [];
  const plan = await planDiscovery(
    base({
      fetchVideos: async (g) => {
        fetched.push(g.slug);
        return g.slug === "gta-6" ? [v("a1", "GTA 6 map leak explained", 200_000, 10), v("a2", "GTA 6 small video", 1000, 10)] : [];
      },
    }),
  );
  assert.deepEqual(fetched, ["gta-6"]);
  assert.equal(plan.clips.length, 1);
  assert.equal(plan.clips[0].game, "gta-6");
  assert.equal(plan.clips[0].isFallback, false);
  assert.equal(plan.trends.find((t) => t.videoId.startsWith("a2"))?.status, "below_threshold");
  assert.equal(plan.fellBack, false);
}

// 2. GTA 6 weak → falls back to GTA 5, clip marked fallback
{
  const plan = await planDiscovery(
    base({
      fetchVideos: async (g) =>
        g.slug === "gta-6" ? [v("b1", "GTA 6 tiny", 2000, 10)] : g.slug === "gta-5" ? [v("b2", "GTA Online new heist glitch", 90_000, 10)] : [],
    }),
  );
  assert.equal(plan.clips[0].game, "gta-5");
  assert.equal(plan.clips[0].isFallback, true);
  assert.equal(plan.fellBack, true);
}

// 3. Never repeats: known video id skipped; same-story re-upload marked duplicate
{
  const plan = await planDiscovery(
    base({
      findExisting: async (ids) => new Set(ids.filter((i) => i.startsWith("c1"))),
      recentlyUsed: [{ videoId: "zzzzzzzzzzz", title: "GTA 6 trailer 3 hidden details", usedAt: hoursAgo(48) }],
      fetchVideos: async (g) =>
        g.slug === "gta-6"
          ? [
              v("c1", "Already seen video", 500_000, 5),
              v("c2", "GTA 6 TRAILER 3 — hidden DETAILS 🤯 #shorts", 300_000, 5),
              v("c3", "GTA 6 police AI breakdown", 100_000, 5),
            ]
          : [],
    }),
  );
  assert.ok(!plan.trends.some((t) => t.videoId.startsWith("c1")), "known video must not be re-inserted");
  assert.equal(plan.trends.find((t) => t.videoId.startsWith("c2"))?.status, "duplicate");
  assert.ok(plan.clips[0].newTrendVideoIds[0].startsWith("c3"));
}

// 4. Two re-uploads of the same story in one run → only one counts
{
  const plan = await planDiscovery(
    base({
      settings: { ...settings, formats: { ...settings.formats, short: { ...settings.formats.short, perDay: 3 } } },
      fetchVideos: async (g) =>
        g.slug === "gta-6" ? [v("d1", "GTA 6 Vice City beach leak", 300_000, 5), v("d2", "GTA 6 vice city BEACH leak!!", 200_000, 5)] : [],
    }),
  );
  assert.equal(plan.clips.length, 1);
  assert.equal(plan.trends.find((t) => t.videoId.startsWith("d2"))?.status, "duplicate");
}

// 5. Already made today's Short → no new Short
{
  const plan = await planDiscovery(
    base({ shortsCreatedToday: 1, fetchVideos: async () => [v("e1", "GTA 6 big news", 300_000, 5)] }),
  );
  assert.equal(plan.clips.filter((c) => c.format === "short").length, 0);
}

// 6. Weekly long compilation when due, built from fresh + older trends of the picked game
{
  const older = Array.from({ length: 4 }, (_, i) => ({
    id: `old-${i}`, game: "gta-6", videoId: `old${i}`.padEnd(11, "x"), url: "", title: `old ${i}`, channel: "", views: 1,
    viewsPerHour: 10_000 + i, durationSec: 1, publishedAt: hoursAgo(72), foundAt: hoursAgo(72), status: "used" as const,
  }));
  const plan = await planDiscovery(
    base({
      lastLongClipAt: null,
      recentTrends: older,
      fetchVideos: async (g) => (g.slug === "gta-6" ? [v("f1", "GTA 6 boat physics", 80_000, 5), v("f2", "GTA 6 wanted system", 60_000, 5)] : []),
    }),
  );
  const long = plan.clips.find((c) => c.format === "long");
  assert.ok(long, "long clip planned");
  assert.equal(long.newTrendVideoIds.length + long.existingTrendIds.length, 6);
  assert.equal(long.durationSec, 600);
}

// 7. Quota error stops the chain (doesn't burn quota on every game)
{
  let calls = 0;
  const plan = await planDiscovery(
    base({
      fetchVideos: async () => {
        calls++;
        throw new Error("YouTube daily quota used up");
      },
    }),
  );
  assert.equal(calls, 1);
  assert.match(plan.log[0].error ?? "", /quota/);
}

// 8. Off-topic (GTA 5 stream in GTA 6 results) and livestreams are skipped
{
  const plan = await planDiscovery(
    base({
      fetchVideos: async (g) =>
        g.slug === "gta-6"
          ? [
              v("g1", "PLAYING EVERY GTA: Grand Theft Auto 5", 900_000, 5),
              { ...v("g2", "GTA 6 pre-load stream", 800_000, 5), isLive: true },
              v("g3", "GTA 6 map size compared", 50_000, 5),
            ]
          : [],
    }),
  );
  assert.equal(plan.trends.find((t) => t.videoId.startsWith("g1"))?.duplicateReason, "Not about GTA 6");
  assert.match(plan.trends.find((t) => t.videoId.startsWith("g2"))?.duplicateReason ?? "", /Livestream/);
  assert.ok(plan.clips[0].newTrendVideoIds[0].startsWith("g3"));
}

assert.equal(parseDuration("PT1M2S"), 62);
assert.equal(parseDuration("PT1H"), 3600);
assert.equal(viralScore(5000), 74);

console.log("discovery: all checks passed");
