import { HttpError, handle } from "@/lib/api";
import { jobsStore } from "@/lib/data";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Signed upload URL for the job's preview file (worker uploads straight to Supabase Storage). */
export async function POST(req: Request) {
  return handle("worker upload url", async () => {
    requireWorker(req);
    const { jobId, ext } = await readJson<{ jobId?: string; ext?: string }>(req);
    if (ext !== "mp4" && ext !== "jpg") throw new HttpError(400, "ext must be mp4 or jpg");
    const jobs = jobsStore();
    const job = jobId ? await jobs.getJob(jobId) : null;
    if (!job || job.status !== "running") throw new HttpError(409, "Job is not running");
    const up = await jobs.createPreviewUpload(job.clipId, ext);
    return { path: up.path, token: up.token, signedUrl: up.signedUrl };
  });
}
