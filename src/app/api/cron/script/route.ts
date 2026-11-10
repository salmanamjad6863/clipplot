import { handle } from "@/lib/api";
import { scriptPending } from "@/lib/ai/run";
import { safeEqual } from "@/lib/auth";

export const maxDuration = 300;

/** Scripts clips waiting in `discovered`. Bearer CRON_SECRET (used by cron in Step 7). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle("cron script", () => scriptPending());
}
