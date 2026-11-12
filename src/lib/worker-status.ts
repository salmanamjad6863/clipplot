import "server-only";
import { supabaseAdmin } from "./data/supabase-store";
import { readSystemJson, writeSystemJson } from "./footage";

/** Last heartbeat from a worker (Mac or cloud). Workers send one every 20s and on every job change. */
export interface WorkerBeat {
  workerId: string;
  kind: "mac" | "cloud";
  state: "idle" | "rendering" | "uploading" | "stopped";
  title?: string;
  progress?: string;
  at: string;
}

export type WorkerStatus =
  | { status: "working"; beat: WorkerBeat }
  | { status: "idle"; beat: WorkerBeat }
  | { status: "stopped"; beat: WorkerBeat | null };

const STALE_MS = 75_000;

export const saveBeat = (b: WorkerBeat) => writeSystemJson("worker", b);

export async function workerStatus(): Promise<WorkerStatus> {
  const beat = await readSystemJson<WorkerBeat>("worker");
  if (!beat || beat.state === "stopped" || Date.now() - Date.parse(beat.at) > STALE_MS) return { status: "stopped", beat };
  return beat.state === "idle" ? { status: "idle", beat } : { status: "working", beat };
}

/** Jobs waiting for a worker (all workspaces). */
export async function queueCounts(): Promise<{ render: number; upload: number; total: number }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return { render: 0, upload: 0, total: 0 };
  const sb = supabaseAdmin(url, key);
  const count = async (type: "render" | "upload") => {
    const { count: n, error } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("type", type).eq("status", "queued");
    if (error) throw new Error(`Supabase jobs: ${error.message}`);
    return n ?? 0;
  };
  const [render, upload] = await Promise.all([count("render"), count("upload")]);
  return { render, upload, total: render + upload };
}
