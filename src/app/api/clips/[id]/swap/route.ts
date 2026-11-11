import { after } from "next/server";
import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { swapTrend } from "@/lib/discovery/manual";
import { currentWorkspaceId } from "@/lib/workspaces";

/** "Swap trend": skip this clip, make a new one from the next-best unused trend of the same game. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle("swap trend", async () => {
    const ws = await currentWorkspaceId();
    const clip = await swapTrend(ws, id);
    after(() => scriptPending(ws).catch((e) => console.error("[script] batch failed:", e)));
    return clip;
  });
}
