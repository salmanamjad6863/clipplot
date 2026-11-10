import { after } from "next/server";
import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { runDiscovery } from "@/lib/discovery/run";

/** Manual "Run discovery" button (protected by the login proxy). */
export async function POST() {
  return handle("discover", async () => {
    const result = await runDiscovery();
    // Claude writes scripts after the response is sent — the UI polls for status
    after(() => scriptPending().catch((e) => console.error("[script] batch failed:", e)));
    return result;
  });
}
