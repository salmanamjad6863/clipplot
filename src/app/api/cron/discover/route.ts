import { after } from "next/server";
import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { safeEqual } from "@/lib/auth";
import { runDiscovery } from "@/lib/discovery/run";
import { listWorkspaces } from "@/lib/workspaces";

export const maxDuration = 300;

/** Manual/legacy trigger: discovery for every workspace now (the daily schedule uses /api/cron/tick). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle("cron discover", async () => {
    const results = [];
    for (const w of await listWorkspaces()) {
      try {
        results.push({ workspace: w.name, ...(await runDiscovery(w.id)) });
      } catch (err) {
        results.push({ workspace: w.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    after(async () => {
      for (const w of await listWorkspaces()) await scriptPending(w.id).catch((e) => console.error("[script] batch failed:", e));
    });
    return results;
  });
}
