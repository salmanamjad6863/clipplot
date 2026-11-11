import { after } from "next/server";
import { handle } from "@/lib/api";
import { schedulerTick } from "@/lib/scheduler";
import { requireWorker } from "@/lib/worker-auth";

export const maxDuration = 300;

/** The worker calls this every 5 min — it's the precise clock for the daily schedule. */
export async function POST(req: Request) {
  return handle("worker tick", async () => {
    requireWorker(req);
    const { results, background } = await schedulerTick("worker");
    if (background) after(background);
    return results;
  });
}
