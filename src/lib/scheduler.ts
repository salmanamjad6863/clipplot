import "server-only";
import { scriptPending } from "./ai/run";
import { getStore } from "./data";
import { runDiscovery } from "./discovery/run";
import { queueApprovedUploads } from "./publish";
import { scheduleFor } from "./schedule-time";

const STUCK_SCRIPTING_MIN = 15;
const PREVIEW_KEEP_DAYS = 7;

export interface TickResult {
  source: string;
  at: string;
  discovery: "started" | "not_due";
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
export async function schedulerTick(source: string): Promise<{ result: TickResult; background?: () => Promise<void> }> {
  const store = getStore();
  const now = Date.now();
  const [settings, state] = await Promise.all([store.getSettings(), store.getSchedulerState()]);
  const sched = scheduleFor(settings.uploadTime, now, { discovery: state.lastDiscoveryAt, release: state.lastReleaseAt });

  // 1. Recovery: clips stuck mid-script after a crash/redeploy
  const recovered = await store.resetStuckScripting(new Date(now - STUCK_SCRIPTING_MIN * 60_000).toISOString());

  // 2. Daily discovery (+ scripts), runs whether or not autopilot is on
  let background: (() => Promise<void>) | undefined;
  let discovery: TickResult["discovery"] = "not_due";
  if (sched.discoveryDue !== null && (await store.claimSchedulerRun("discovery", new Date(sched.discoveryDue).toISOString()))) {
    discovery = "started";
    background = async () => {
      try {
        const retried = await store.retryFailedScripts(3);
        if (retried) console.info(`[scheduler] retrying ${retried} failed script(s)`);
        const d = await runDiscovery();
        console.info(`[scheduler] discovery: ${d.clipsCreated} clip(s), ${d.trendsSaved} trend(s)`);
      } catch (err) {
        console.error("[scheduler] discovery failed:", err instanceof Error ? err.message : err);
      }
      // scripts for new clips + retries (also runs if discovery itself failed, e.g. quota)
      await scriptPending().catch((e) => console.error("[scheduler] scripting failed:", e));
    };
  } else if (recovered) {
    background = () => scriptPending().then(() => undefined);
  }

  // 3. Daily upload release (autopilot only; without autopilot, approving uploads immediately)
  let release: TickResult["release"] = { status: "not_due", queued: 0 };
  if (!settings.youtubeConnected) {
    release = { status: "youtube_not_connected", queued: 0 };
  } else if (!settings.autopilot) {
    const q = await queueApprovedUploads(); // safety net: approved while something was down
    release = { status: "autopilot_off", queued: q.queued };
  } else if (sched.releaseDue !== null && (await store.claimSchedulerRun("release", new Date(sched.releaseDue).toISOString()))) {
    const approved = (await store.listClips())
      .filter((c) => c.status === "scheduled" && c.renderUrl)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first
    const picks = [
      ...approved.filter((c) => c.format === "short").slice(0, settings.formats.short.perDay),
      ...approved.filter((c) => c.format === "long").slice(0, 1),
    ];
    for (const c of picks) await store.enqueueJob(c.id, "upload");
    release = { status: "released", queued: picks.length };
    console.info(`[scheduler] released ${picks.length} upload(s) for today's slot`);
  }

  // 4. Cleanup: previews of videos published > 7 days ago (YouTube has the real thing)
  const cleanedUp = await store.previewsToCleanup(new Date(now - PREVIEW_KEEP_DAYS * 86_400_000).toISOString());
  for (const id of cleanedUp) await store.clearPreview(id);

  return {
    result: {
      source,
      at: new Date(now).toISOString(),
      discovery,
      release,
      recovered,
      cleanedUp,
      nextDiscoveryAt: sched.nextDiscoveryAt,
      nextReleaseAt: sched.nextReleaseAt,
    },
    background,
  };
}
