import { after } from "next/server";
import { currentWorkspaceId } from "@/lib/workspaces";
import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { runDiscovery } from "@/lib/discovery/run";

/** Manual "Run discovery" button (protected by the login proxy). */
export async function POST(req: Request) {
  return handle("discover", async () => {
    // { extra: true } = "Find more now": make a Short even if today's count is already reached
    const { extra } = (await req.json().catch(() => ({}))) as { extra?: boolean };
    const ws = await currentWorkspaceId();
    const result = await runDiscovery(ws, { extraShorts: extra ? 1 : 0 });
    // Claude writes scripts after the response is sent — the UI polls for status
    after(() => scriptPending(ws).catch((e) => console.error("[script] batch failed:", e)));
    return result;
  });
}
