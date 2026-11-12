import { HttpError, handle } from "@/lib/api";
import { saveBeat, type WorkerBeat } from "@/lib/worker-status";
import { readJson, requireWorker } from "@/lib/worker-auth";

const STATES = ["idle", "rendering", "uploading", "stopped"];

/** Worker → "I'm alive, doing X". Shown in the sidebar's Worker card. */
export async function POST(req: Request) {
  return handle("worker heartbeat", async () => {
    requireWorker(req);
    const b = await readJson<Partial<WorkerBeat>>(req);
    if (!b.state || !STATES.includes(b.state)) throw new HttpError(400, "Invalid state");
    await saveBeat({
      workerId: String(b.workerId ?? "worker").slice(0, 80),
      kind: b.kind === "cloud" ? "cloud" : "mac",
      state: b.state,
      title: b.title ? String(b.title).slice(0, 120) : undefined,
      progress: b.progress ? String(b.progress).slice(0, 40) : undefined,
      at: new Date().toISOString(),
    });
    return { ok: true };
  });
}
