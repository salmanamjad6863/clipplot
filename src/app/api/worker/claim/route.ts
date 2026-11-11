import { HttpError, handle } from "@/lib/api";
import { getStore, jobsStore } from "@/lib/data";
import type { JobType } from "@/lib/data/store";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker asks for the next render or upload job (any workspace). Returns { job: null } when idle. */
export async function POST(req: Request) {
  return handle("worker claim", async () => {
    requireWorker(req);
    const { workerId, type = "render" } = await readJson<{ workerId?: string; type?: JobType }>(req);
    if (!workerId || workerId.length > 64) throw new HttpError(400, "workerId required");
    if (type !== "render" && type !== "upload") throw new HttpError(400, "type must be render or upload");

    const jobs = jobsStore();
    const claimed = await jobs.claimJob(type, workerId);
    if (!claimed) return { job: null };

    if (type === "render" && !claimed.clip.script) {
      await jobs.failJob(claimed.job.id, "Clip has no script yet");
      return { job: null };
    }
    if (type === "upload" && claimed.clip.status !== "scheduled") {
      // un-approved after the job was queued
      await jobs.finishJob(claimed.job.id, "failed", `Cancelled — clip is "${claimed.clip.status}"`);
      return { job: null };
    }
    console.info(`[worker] ${workerId} claimed ${type} ${claimed.job.id} (attempt ${claimed.job.attempts})`);
    // render with this clip's workspace "Video & copyright" settings
    const { render } = await getStore(claimed.clip.workspaceId).getSettings();
    return { ...claimed, render };
  });
}
