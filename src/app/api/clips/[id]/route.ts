import { HttpError, handle } from "@/lib/api";
import { currentWorkspaceId } from "@/lib/workspaces";
import { getStore } from "@/lib/data";
import { queueApprovedUploads } from "@/lib/publish";
import type { ClipPatch, ClipStatus } from "@/lib/types";

const ALLOWED_STATUS: ClipStatus[] = ["awaiting_approval", "scheduled", "rejected"];

export async function GET(_req: Request, ctx: RouteContext<"/api/clips/[id]">) {
  const { id } = await ctx.params;
  return handle("get clip", async () => {
    const clip = await getStore(await currentWorkspaceId()).getClip(id);
    if (!clip) throw new HttpError(404, "Not found");
    return clip;
  });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/clips/[id]">) {
  const { id } = await ctx.params;
  return handle("update clip", async () => {
    const body = (await req.json().catch(() => ({}))) as ClipPatch;
    if (body.status && !ALLOWED_STATUS.includes(body.status)) {
      throw new HttpError(400, `Status "${body.status}" can't be set manually`);
    }
    const patch: ClipPatch = {};
    if (body.status) patch.status = body.status;
    if (typeof body.title === "string") patch.title = body.title.slice(0, 100); // YouTube title limit
    if (typeof body.description === "string") patch.description = body.description.slice(0, 5000);
    if (Array.isArray(body.tags)) patch.tags = body.tags.map(String).slice(0, 30);
    if (typeof body.scheduledFor === "string") patch.scheduledFor = body.scheduledFor;
    if (body.privacy !== undefined) {
      if (!["private", "unlisted", "public"].includes(body.privacy)) throw new HttpError(400, "Invalid visibility");
      patch.privacy = body.privacy;
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to update");

    const ws = await currentWorkspaceId();
    const store = getStore(ws);
    // privacy equal to the workspace default isn't stored (null = follow the default)
    if (patch.privacy && patch.privacy === (await store.getSettings()).youtubePrivacy) delete patch.privacy;
    if (patch.status) {
      const current = await store.getClip(id);
      if (!current) throw new HttpError(404, "Not found");
      // only review decisions can be changed by hand — not clips mid-pipeline or already on YouTube
      if (!ALLOWED_STATUS.includes(current.status)) {
        throw new HttpError(409, `Can't change a clip that is "${current.status}"`);
      }
      if (patch.status === "scheduled" && !current.renderUrl) throw new HttpError(409, "Clip has no rendered video yet");
      if (patch.status === "scheduled" && current.script?.testRender) {
        throw new HttpError(409, "This is a test render made from the source video — it can't be uploaded. Set Background footage to My footage and re-render first.");
      }
    }

    const clip = await store.updateClip(id, patch);
    if (!clip) throw new HttpError(404, "Not found");

    if (patch.status === "scheduled") {
      await queueApprovedUploads(ws);
    } else if (patch.status) {
      await store.cancelQueuedJobs(id, "upload"); // un-approved / skipped → don't upload
    }
    return clip;
  });
}
