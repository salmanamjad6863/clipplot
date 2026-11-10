import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker asks for the next render job. Returns { job: null } when there's nothing to do. */
export async function POST(req: Request) {
  return handle("worker claim", async () => {
    requireWorker(req);
    const { workerId } = await readJson<{ workerId?: string }>(req);
    if (!workerId || workerId.length > 64) throw new HttpError(400, "workerId required");
    const claimed = await getStore().claimJob("render", workerId);
    if (!claimed) return { job: null };
    if (!claimed.clip.script) {
      await getStore().failJob(claimed.job.id, "Clip has no script yet");
      return { job: null };
    }
    console.info(`[worker] ${workerId} claimed render ${claimed.job.id} (attempt ${claimed.job.attempts})`);
    return claimed;
  });
}
