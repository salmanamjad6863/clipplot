import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker reports a failed render — retried up to 3 times, then the clip is marked failed. */
export async function POST(req: Request) {
  return handle("worker fail", async () => {
    requireWorker(req);
    const { jobId, error } = await readJson<{ jobId?: string; error?: string }>(req);
    if (!jobId) throw new HttpError(400, "jobId required");
    const r = await getStore().failJob(jobId, String(error ?? "Unknown error"));
    console.warn(`[worker] render ${jobId} failed${r.final ? " (final)" : ", will retry"}: ${error}`);
    return r;
  });
}
