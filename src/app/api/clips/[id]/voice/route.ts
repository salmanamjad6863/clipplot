import { HttpError, handle } from "@/lib/api";
import { currentWorkspaceId } from "@/lib/workspaces";
import { getStore } from "@/lib/data";
import { isVoiceId } from "@/lib/types";

const CAN_RERENDER = ["awaiting_approval", "rejected", "failed"];

/** Change one clip's narrator voice and re-render it (no Claude call — same script). */
export async function POST(req: Request, ctx: RouteContext<"/api/clips/[id]/voice">) {
  const { id } = await ctx.params;
  return handle("change voice", async () => {
    const { voice } = (await req.json().catch(() => ({}))) as { voice?: string | null };
    if (voice != null && (typeof voice !== "string" || !isVoiceId(voice))) throw new HttpError(400, "Invalid voice");
    const store = getStore(await currentWorkspaceId());
    const clip = await store.getClip(id);
    if (!clip) throw new HttpError(404, "Not found");
    if (!clip.script) throw new HttpError(409, "Write the script first");
    if (!CAN_RERENDER.includes(clip.status)) throw new HttpError(409, `Can't re-render a clip that is "${clip.status}"`);
    return store.setVoiceAndRerender(id, voice || null);
  });
}
