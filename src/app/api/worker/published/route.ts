import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { addToGamePlaylist } from "@/lib/youtube/channel";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker uploaded the video → mark published, then add it to the game's playlist. */
export async function POST(req: Request) {
  return handle("worker published", async () => {
    requireWorker(req);
    const { jobId, videoId } = await readJson<{ jobId?: string; videoId?: string }>(req);
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new HttpError(400, "valid videoId required");
    const store = getStore();
    const job = jobId ? await store.getJob(jobId) : null;
    if (!job || job.type !== "upload" || job.status !== "running") throw new HttpError(409, "Upload job is not running");

    const youtubeUrl = `https://www.youtube.com/${(await store.getClip(job.clipId))?.format === "short" ? "shorts/" : "watch?v="}${videoId}`;
    const clip = await store.markPublished(job.id, job.clipId, { youtubeVideoId: videoId, youtubeUrl });
    if (!clip) throw new HttpError(404, "Clip not found");

    // playlist is nice-to-have: never fail the publish because of it
    let playlistId: string | null = null;
    try {
      playlistId = await addToGamePlaylist(clip, videoId);
    } catch (err) {
      console.error(`[youtube] adding ${videoId} to playlist failed:`, err);
    }
    console.info(`[youtube] published ${youtubeUrl}${playlistId ? ` → playlist ${playlistId}` : ""}`);
    return { youtubeUrl, playlistId };
  });
}
