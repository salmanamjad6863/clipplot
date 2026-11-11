import { HttpError, handle } from "@/lib/api";
import { getStore, jobsStore } from "@/lib/data";
import { buildUploadMetadata, getAccessToken } from "@/lib/youtube/channel";
import { workspaceOfClip } from "@/lib/workspaces";
import { readJson, requireWorker } from "@/lib/worker-auth";

/**
 * Everything the worker needs to upload one video: a short-lived (~1h) access token for the clip's
 * workspace channel and the video metadata. Refresh tokens never leave the server.
 */
export async function POST(req: Request) {
  return handle("worker upload plan", async () => {
    requireWorker(req);
    const { jobId } = await readJson<{ jobId?: string }>(req);
    const job = jobId ? await jobsStore().getJob(jobId) : null;
    if (!job || job.type !== "upload" || job.status !== "running") throw new HttpError(409, "Upload job is not running");
    const ws = await workspaceOfClip(job.clipId);
    if (!ws) throw new HttpError(404, "Clip not found");
    const store = getStore(ws);
    const clip = await store.getClip(job.clipId);
    if (!clip || clip.status !== "scheduled") throw new HttpError(409, "Clip is no longer approved");

    const [settings, token] = await Promise.all([store.getSettings(), getAccessToken(ws)]);
    return {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      channel: settings.youtubeChannelTitle ?? null,
      metadata: buildUploadMetadata(clip, settings),
    };
  });
}
