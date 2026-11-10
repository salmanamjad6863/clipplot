import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import type { JobType } from "@/lib/data/store";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker asks for the next render or upload job. Returns { job: null } when there's nothing to do. */
export async function POST(req: Request) {
  return handle("worker claim", async () => {
    requireWorker(req);
    const { workerId, type = "render" } = await readJson<{ workerId?: string; type?: JobType }>(req);
    if (!workerId || workerId.length > 64) throw new HttpError(400, "workerId required");
    if (type !== "render" && type !== "upload") throw new HttpError(400, "type must be render or upload");

    const store = getStore();
    const claimed = await store.claimJob(type, workerId);
    if (!claimed) return { job: null };

    if (type === "render" && !claimed.clip.script) {
      await store.failJob(claimed.job.id, "Clip has no script yet");
      return { job: null };
    }
    if (type === "upload" && claimed.clip.status !== "scheduled") {
      // un-approved after the job was queued
      await store.finishJob(claimed.job.id, "failed", `Cancelled — clip is "${claimed.clip.status}"`);
      return { job: null };
    }
    console.info(`[worker] ${workerId} claimed ${type} ${claimed.job.id} (attempt ${claimed.job.attempts})`);
    return claimed;
  });
}
