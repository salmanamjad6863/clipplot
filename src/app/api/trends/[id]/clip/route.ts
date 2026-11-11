import { after } from "next/server";
import { HttpError, handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { clipFromTrend } from "@/lib/discovery/manual";
import { currentWorkspaceId } from "@/lib/workspaces";

/** "Make clip" on the Trends page → new clip, Claude scripts it in the background. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle("clip from trend", async () => {
    const { format = "short" } = (await req.json().catch(() => ({}))) as { format?: "short" | "long" };
    if (format !== "short" && format !== "long") throw new HttpError(400, "format must be short or long");
    const ws = await currentWorkspaceId();
    const clip = await clipFromTrend(ws, id, format);
    after(() => scriptPending(ws).catch((e) => console.error("[script] batch failed:", e)));
    return clip;
  });
}
