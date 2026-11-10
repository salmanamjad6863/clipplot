import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker finished rendering + uploaded the preview → clip goes to review. */
export async function POST(req: Request) {
  return handle("worker complete", async () => {
    requireWorker(req);
    const { jobId, durationSec } = await readJson<{ jobId?: string; durationSec?: number }>(req);
    const job = jobId ? await getStore().getJob(jobId) : null;
    if (!job || job.status !== "running") throw new HttpError(409, "Job is not running");
    if (typeof durationSec !== "number" || !(durationSec > 0)) throw new HttpError(400, "durationSec required");
    // URL is derived server-side from the clip id — never trusted from the worker
    const { publicUrl } = await getStore().createPreviewUpload(job.clipId, "mp4");
    const clip = await getStore().completeRender(job.id, { clipId: job.clipId, previewUrl: publicUrl, durationSec });
    console.info(`[worker] render ${job.id} done → clip ${job.clipId} awaiting approval`);
    return { ok: true, clipId: clip?.id };
  });
}
