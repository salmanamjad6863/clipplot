import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { safeEqual } from "@/lib/auth";
import { listWorkspaces } from "@/lib/workspaces";

export const maxDuration = 300;

/** Scripts clips waiting in `discovered`, every workspace. Bearer CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle("cron script", async () => {
    const out: Record<string, { claimed: number; scripted: number }> = {};
    for (const w of await listWorkspaces()) out[w.name] = await scriptPending(w.id);
    return out;
  });
}
