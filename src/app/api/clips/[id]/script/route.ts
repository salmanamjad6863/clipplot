import { HttpError, handle } from "@/lib/api";
import { currentWorkspaceId } from "@/lib/workspaces";
import { scriptClip } from "@/lib/ai/run";
import { getStore } from "@/lib/data";

export const maxDuration = 120;

/** (Re)generate the Claude script for one clip. Synchronous — the button waits ~20–60s. */
export async function POST(req: Request, ctx: RouteContext<"/api/clips/[id]/script">) {
  const { id } = await ctx.params;
  return handle("regenerate script", async () => {
    // optional direction from you, e.g. "funnier", "focus on the map", "more suspense"
    const { note } = (await req.json().catch(() => ({}))) as { note?: string };
    const clean = typeof note === "string" ? note.trim().slice(0, 300) : "";
    const clip = await getStore(await currentWorkspaceId()).claimOneForScripting(id);
    if (!clip) throw new HttpError(409, "This clip can't be re-scripted right now (already scripting, scheduled or published)");
    return scriptClip(clip, clean || undefined);
  });
}
