import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { HttpError, handle } from "@/lib/api";
import { cloudWorkerConfigured, kickWorker } from "@/lib/kick-worker";
import { queueCounts, workerStatus } from "@/lib/worker-status";

/** On your own machine (next dev / next start) the app can launch the Mac worker itself; on Vercel it can't. */
const canRunLocal = () => !process.env.VERCEL;

/** Worker card: is a worker working / idle / stopped, how many jobs wait, and what Start can do here. */
export async function GET() {
  await connection();
  return handle("worker status", async () => {
    const [status, queue] = await Promise.all([workerStatus(), queueCounts()]);
    return { ...status, queue, canStartLocal: canRunLocal(), canStartCloud: cloudWorkerConfigured() };
  });
}

/** { action: "start" | "stop" } */
export async function POST(req: Request) {
  return handle("worker control", async () => {
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    if (action === "start") {
      const s = await workerStatus();
      if (s.status !== "stopped") return { ok: true, message: `A ${s.beat.kind === "cloud" ? "cloud" : "Mac"} worker is already running` };
      if (canRunLocal()) {
        const root = process.cwd();
        const out = openSync(path.join(root, "worker", "worker.log"), "a");
        const child = spawn("pnpm", ["worker"], { cwd: root, detached: true, stdio: ["ignore", out, out], env: process.env });
        child.unref();
        return { ok: true, message: "Worker started on this Mac" };
      }
      if (await kickWorker("manual start", true)) return { ok: true, message: "Cloud worker starting — it shows as working within about a minute" };
      throw new HttpError(503, "Cloud worker isn't set up yet — add GITHUB_DISPATCH_TOKEN and GITHUB_REPO in Vercel (see SETUP.md 3b)");
    }
    if (action === "stop") {
      if (!canRunLocal()) throw new HttpError(400, "The cloud worker stops by itself when the queue is empty");
      // SIGTERM = finish the current job, then exit
      const r = spawnSync("pkill", ["-TERM", "-f", "import tsx worker/index[.]mts"]);
      return { ok: true, message: r.status === 0 ? "Stopping after the current job…" : "No worker was running on this Mac" };
    }
    throw new HttpError(400, "Unknown action");
  });
}
