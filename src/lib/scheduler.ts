import "server-only";
import { scriptPending } from "./ai/run";
import { getStore } from "./data";
import { runDiscovery } from "./discovery/run";
import { queueApprovedUploads } from "./publish";
import { scheduleFor, windowStart } from "./schedule-time";
import { dailyShortsTotal } from "./topics";
import { refreshStats } from "./youtube/stats";
import { listWorkspaces } from "./workspaces";

const STUCK_SCRIPTING_MIN = 15;
const PREVIEW_KEEP_DAYS = 7;
const STATS_EVERY_HOURS = 6;
const YOUTUBE_DATA_DAYS = 30; // YouTube API Developer Policies: refresh or delete API data within 30 days

export interface TickResult {
  workspace: string;
  workspaceName: string;
  source: string;
  at: string;
  discovery: "started" | "breaking" | "not_due";
  release: { status: "released" | "not_due" | "autopilot_off" | "youtube_not_connected"; queued: number };
  recovered: number;
  /** Clip ids whose previews were deleted — the worker removes its local files for these too */
  cleanedUp: string[];
  nextDiscoveryAt: string;
  nextReleaseAt: string;
}

/**
 * One scheduler "tick". Safe to call often and from several places at once (Vercel cron daily,
 * the worker every 5 min): each daily slot is claimed with a compare-and-set, so it runs once.
 * Returns fast; the slow part (YouTube discovery + Claude scripts) is returned as `background`.
 */
export async function schedulerTick(source: string): Promise<{ results: TickResult[]; background?: () => Promise<void> }> {
  const results: TickResult[] = [];
  const jobs: (() => Promise<void>)[] = [];
  for (const w of await listWorkspaces()) {
    try {
      const r = await tickWorkspace(w.id, w.name, source);
      results.push(r.result);
      if (r.background) jobs.push(r.background);
    } catch (err) {
      console.error(`[scheduler] workspace "${w.name}" tick failed:`, err instanceof Error ? err.message : err);
    }
  }
  // workspaces run one after another in the background (gentle on YouTube quota + Claude rate limits)
  const background = jobs.length
    ? async () => {
        for (const j of jobs) await j();
      }
    : undefined;
  return { results, background };
}

async function tickWorkspace(
  ws: string,
  workspaceName: string,
  source: string,
): Promise<{ result: TickResult; background?: () => Promise<void> }> {
  const store = getStore(ws);
  const now = Date.now();
  const [settings, state] = await Promise.all([store.getSettings(), store.getSchedulerState()]);
  const sched = scheduleFor(settings.uploadTimes, now, { discovery: state.lastDiscoveryAt, release: state.lastReleaseAt });
  const jobs: (() => Promise<void>)[] = [];

  // 1. Recovery: clips stuck mid-script after a crash/redeploy
  const recovered = await store.resetStuckScripting(new Date(now - STUCK_SCRIPTING_MIN * 60_000).toISOString());

  // 2. Daily discovery (+ scripts), runs whether or not autopilot is on
  let discovery: TickResult["discovery"] = "not_due";
  if (sched.discoveryDue !== null && (await store.claimSchedulerRun("discovery", new Date(sched.discoveryDue).toISOString()))) {
    discovery = "started";
    jobs.push(async () => {
      try {
        const retried = await store.retryFailedScripts(3);
        if (retried) console.info(`[scheduler] retrying ${retried} failed script(s)`);
        const d = await runDiscovery(ws);
        console.info(`[scheduler] ${workspaceName} discovery: ${d.clipsCreated} clip(s), ${d.trendsSaved} trend(s)`);
      } catch (err) {
        console.error("[scheduler] discovery failed:", err instanceof Error ? err.message : err);
      }
      // scripts for new clips + retries (also runs if discovery itself failed, e.g. quota)
      await scriptPending(ws).catch((e) => console.error("[scheduler] scripting failed:", e));
    });
  } else if (
    // 2b. Breaking news: every N hours, primary game only, exceptional trends only (capped per day)
    settings.breakingNews &&
    (await store
      .claimSchedulerRun("breaking", new Date(windowStart(now, settings.breakingEveryHours)).toISOString())
      .catch(() => false))
  ) {
    discovery = "breaking";
    jobs.push(async () => {
      try {
        const d = await runDiscovery(ws, { breaking: true });
        if (d.clipsCreated) console.info(`[scheduler] ${workspaceName} BREAKING: ${d.clipsCreated} exceptional trend(s) → clip`);
      } catch (err) {
        console.error("[scheduler] breaking check failed:", err instanceof Error ? err.message : err);
      }
      await scriptPending(ws).catch((e) => console.error("[scheduler] scripting failed:", e));
    });
  } else if (recovered) {
    jobs.push(() => scriptPending(ws).then(() => undefined));
  }

  // 3. Daily upload release (autopilot only; without autopilot, approving uploads immediately)
  let release: TickResult["release"] = { status: "not_due", queued: 0 };
  if (!settings.youtubeConnected) {
    release = { status: "youtube_not_connected", queued: 0 };
  } else if (!settings.autopilot) {
    const q = await queueApprovedUploads(ws); // safety net: approved while something was down
    release = { status: "autopilot_off", queued: q.queued };
  } else if (sched.releaseDue !== null && (await store.claimSchedulerRun("release", new Date(sched.releaseDue).toISOString()))) {
    const approved = (await store.listClips())
      .filter((c) => c.status === "scheduled" && c.renderUrl)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first
    // spread Shorts across the day's slots; the full video goes out at the first slot
    const perSlot = Math.max(1, Math.ceil(dailyShortsTotal(settings) / sched.slotsPerDay));
    const picks = [
      ...approved.filter((c) => c.format === "short").slice(0, perSlot),
      ...(sched.releaseSlotIndex === 0 ? approved.filter((c) => c.format === "long").slice(0, 1) : []),
    ];
    for (const c of picks) await store.enqueueJob(c.id, "upload");
    release = { status: "released", queued: picks.length };
    console.info(`[scheduler] ${workspaceName}: released ${picks.length} upload(s) for slot ${(sched.releaseSlotIndex ?? 0) + 1}/${sched.slotsPerDay}`);
  }

  // 3b. Performance refresh every 6h (views/likes/comments + retention, auto-comment)
  const statsDue =
    settings.youtubeConnected &&
    (await store.claimSchedulerRun("stats", new Date(windowStart(now, STATS_EVERY_HOURS)).toISOString()).catch(() => false)); // needs migration 0004
  if (statsDue) {
    jobs.push(async () => {
      try {
        const r = await refreshStats(ws);
        if (r.updated) console.info(`[scheduler] ${workspaceName} stats: ${r.updated} video(s)${r.analytics ? " + retention" : ""}${r.comments ? `, ${r.comments} comment(s) posted` : ""}`);
      } catch (err) {
        console.error("[scheduler] stats refresh failed:", err instanceof Error ? err.message : err);
      }
    });
  }

  // 4a. YouTube API data retention: nothing from the API is kept longer than 30 days without a refresh
  const purged = await store
    .purgeStaleYouTubeData(new Date(now - YOUTUBE_DATA_DAYS * 86_400_000).toISOString())
    .catch((e) => (console.error("[scheduler] retention purge failed:", e), { trends: 0, stats: 0 }));
  if (purged.trends || purged.stats) console.info(`[scheduler] ${workspaceName}: purged ${purged.trends} old trend(s), ${purged.stats} stale stat(s)`);

  // 4. Cleanup: previews of videos published > 7 days ago (YouTube has the real thing)
  const cleanedUp = await store.previewsToCleanup(new Date(now - PREVIEW_KEEP_DAYS * 86_400_000).toISOString());
  for (const id of cleanedUp) await store.clearPreview(id);

  return {
    result: {
      workspace: ws,
      workspaceName,
      source,
      at: new Date(now).toISOString(),
      discovery,
      release,
      recovered,
      cleanedUp,
      nextDiscoveryAt: sched.nextDiscoveryAt,
      nextReleaseAt: sched.nextReleaseAt,
    },
    background: jobs.length
      ? async () => {
          for (const j of jobs) await j();
        }
      : undefined,
  };
}
