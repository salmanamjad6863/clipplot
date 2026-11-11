import { HttpError, handle } from "@/lib/api";
import { getStore, jobsStore } from "@/lib/data";
import { workspaceOfClip } from "@/lib/workspaces";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker finished rendering + uploaded the preview → clip goes to review. */
export async function POST(req: Request) {
  return handle("worker complete", async () => {
    requireWorker(req);
    const { jobId, durationSec, chapters } = await readJson<{
      jobId?: string;
      durationSec?: number;
      chapters?: { t: number; title: string }[];
    }>(req);
    const jobs = jobsStore();
    const job = jobId ? await jobs.getJob(jobId) : null;
    if (!job || job.status !== "running") throw new HttpError(409, "Job is not running");
    if (typeof durationSec !== "number" || !(durationSec > 0)) throw new HttpError(400, "durationSec required");
    const ws = await workspaceOfClip(job.clipId);
    if (!ws) throw new HttpError(404, "Clip not found");
    // URL is derived server-side from the clip id — never trusted from the worker
    const { publicUrl } = await jobs.createPreviewUpload(job.clipId, "mp4");
    if (Array.isArray(chapters) && chapters.length >= 3) {
      const clean = chapters
        .filter((c) => Number.isFinite(c.t) && c.t >= 0 && typeof c.title === "string")
        .slice(0, 30)
        .map((c) => ({ t: Math.floor(c.t), title: c.title.slice(0, 80) }));
      await getStore(ws).saveChapters(job.clipId, clean);
    }
    const clip = await getStore(ws).completeRender(job.id, { clipId: job.clipId, previewUrl: publicUrl, durationSec });
    console.info(`[worker] render ${job.id} done → clip ${job.clipId} awaiting approval`);
    return { ok: true, clipId: clip?.id };
  });
}
