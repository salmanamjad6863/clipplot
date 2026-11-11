import "server-only";
import { getStore } from "./data";

/**
 * Queues YouTube upload jobs for approved ("scheduled") clips.
 * - Channel not connected → nothing queued yet (they upload as soon as you connect).
 * - Autopilot ON → uploads wait for the daily upload slot (cron, Step 7).
 * - Autopilot OFF → approving uploads right away (the worker picks it up within ~30s).
 */
export async function queueApprovedUploads(ws: string, opts: { ignoreAutopilot?: boolean } = {}) {
  const store = getStore(ws);
  const settings = await store.getSettings();
  if (!settings.youtubeConnected) return { queued: 0, reason: "youtube_not_connected" as const };
  if (settings.autopilot && !opts.ignoreAutopilot) return { queued: 0, reason: "waiting_for_slot" as const };

  const ready = (await store.listClips()).filter((c) => c.status === "scheduled" && c.renderUrl);
  for (const c of ready) await store.enqueueJob(c.id, "upload");
  if (ready.length) console.info(`[publish] queued ${ready.length} upload(s)`);
  return { queued: ready.length, reason: null };
}
