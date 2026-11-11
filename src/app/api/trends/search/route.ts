import { HttpError, handle } from "@/lib/api";
import { manualLookup } from "@/lib/discovery/manual";
import { currentWorkspaceId } from "@/lib/workspaces";

/** Manual lookup: { query } searches the last 7 days, { url } fetches one video. Results join the radar. */
export async function POST(req: Request) {
  return handle("manual lookup", async () => {
    const body = (await req.json().catch(() => ({}))) as { query?: string; url?: string; game?: string };
    if (!body.game) throw new HttpError(400, "game required");
    const trends = await manualLookup(await currentWorkspaceId(), { query: body.query, url: body.url, game: body.game });
    return { trends };
  });
}
