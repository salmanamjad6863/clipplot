import { after } from "next/server";
import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { safeEqual } from "@/lib/auth";
import { runDiscovery } from "@/lib/discovery/run";

// discovery + Claude scripting can take a couple of minutes
export const maxDuration = 300;

/**
 * Daily trigger. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`
 * (schedule is added in Step 7).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle("cron discover", async () => {
    const result = await runDiscovery();
    after(() => scriptPending().catch((e) => console.error("[script] batch failed:", e)));
    return result;
  });
}
