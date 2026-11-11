import { after } from "next/server";
import { handle } from "@/lib/api";
import { safeEqual } from "@/lib/auth";
import { schedulerTick } from "@/lib/scheduler";

// discovery + Claude scripts run in after() — give them room
export const maxDuration = 300;

/**
 * Daily backup trigger from Vercel Cron (Hobby plan = once a day, see vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle("cron tick", async () => {
    const { results, background } = await schedulerTick("vercel-cron");
    if (background) after(background);
    return results;
  });
}
