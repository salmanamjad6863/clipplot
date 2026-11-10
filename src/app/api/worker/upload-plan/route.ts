import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { buildUploadMetadata, getAccessToken } from "@/lib/youtube/channel";
import { readJson, requireWorker } from "@/lib/worker-auth";

/**
 * Everything the worker needs to upload one video: a short-lived (~1h) access token and the
 * video metadata. The refresh token never leaves the server.
 */
export async function POST(req: Request) {
  return handle("worker upload plan", async () => {
    requireWorker(req);
    const { jobId } = await readJson<{ jobId?: string }>(req);
    const store = getStore();
    const job = jobId ? await store.getJob(jobId) : null;
    if (!job || job.type !== "upload" || job.status !== "running") throw new HttpError(409, "Upload job is not running");
    const clip = await store.getClip(job.clipId);
    if (!clip || clip.status !== "scheduled") throw new HttpError(409, "Clip is no longer approved");

    const [settings, token] = await Promise.all([store.getSettings(), getAccessToken()]);
    return { accessToken: token.accessToken, expiresAt: token.expiresAt, metadata: buildUploadMetadata(clip, settings) };
  });
}
