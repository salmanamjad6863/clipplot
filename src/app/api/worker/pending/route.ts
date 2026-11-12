import { handle } from "@/lib/api";
import { queueCounts } from "@/lib/worker-status";
import { requireWorker } from "@/lib/worker-auth";

/** Cheap check for the cloud worker: is there anything to render or upload? (skips the heavy setup when not) */
export async function POST(req: Request) {
  return handle("worker pending", async () => {
    requireWorker(req);
    return queueCounts();
  });
}
