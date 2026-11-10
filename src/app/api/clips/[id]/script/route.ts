import { HttpError, handle } from "@/lib/api";
import { scriptClip } from "@/lib/ai/run";
import { getStore } from "@/lib/data";

export const maxDuration = 120;

/** (Re)generate the Claude script for one clip. Synchronous — the button waits ~20–60s. */
export async function POST(_req: Request, ctx: RouteContext<"/api/clips/[id]/script">) {
  const { id } = await ctx.params;
  return handle("regenerate script", async () => {
    const clip = await getStore().claimOneForScripting(id);
    if (!clip) throw new HttpError(409, "This clip can't be re-scripted right now (already scripting, scheduled or published)");
    return scriptClip(clip);
  });
}
