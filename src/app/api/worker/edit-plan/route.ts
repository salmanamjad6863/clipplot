import { HttpError, handle } from "@/lib/api";
import { generateEditPlan } from "@/lib/ai/edit-plan";
import { getStore, jobsStore } from "@/lib/data";
import { workspaceOfClip } from "@/lib/workspaces";
import { readJson, requireWorker } from "@/lib/worker-auth";

export const maxDuration = 120;

/**
 * Pure edits: the worker has the video + its transcript; Claude picks the moments here (the API key lives
 * on the server). The plan is saved on the clip (title, description, tags, moments) and returned.
 */
export async function POST(req: Request) {
  return handle("edit plan", async () => {
    requireWorker(req);
    const { jobId, transcript, durationSec } = await readJson<{
      jobId?: string;
      transcript?: { start: number; text: string }[];
      durationSec?: number;
    }>(req);
    const job = jobId ? await jobsStore().getJob(jobId) : null;
    if (!job || job.status !== "running") throw new HttpError(409, "Job is not running");
    if (typeof durationSec !== "number" || !(durationSec > 0)) throw new HttpError(400, "durationSec required");
    const ws = await workspaceOfClip(job.clipId);
    if (!ws) throw new HttpError(404, "Clip not found");
    const store = getStore(ws);
    const [clip, settings] = await Promise.all([store.getClip(job.clipId), store.getSettings()]);
    if (!clip?.script) throw new HttpError(404, "Clip not found");
    const src = clip.script.sources?.[0] ?? { title: clip.title, channel: "the creator" };
    const cues = (Array.isArray(transcript) ? transcript : [])
      .filter((c) => Number.isFinite(c.start) && typeof c.text === "string")
      .map((c) => ({ start: c.start, text: c.text.slice(0, 200) }));
    const plan = await generateEditPlan(clip, src, cues, durationSec, settings.topics.find((t) => t.slug === clip.game));
    await store.saveEditPlan(clip.id, {
      title: plan.title,
      description: plan.description,
      tags: plan.tags,
      hook: plan.hookText,
      script: { ...clip.script, style: "edit", hookText: plan.hookText, moments: plan.moments, musicMood: plan.musicMood, pinnedComment: plan.pinnedComment },
    });
    return plan;
  });
}
