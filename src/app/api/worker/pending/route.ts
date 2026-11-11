import { handle } from "@/lib/api";
import { supabaseAdmin } from "@/lib/data/supabase-store";
import { requireWorker } from "@/lib/worker-auth";

/** Cheap check for the cloud worker: is there anything to render or upload? (skips the heavy setup when not) */
export async function POST(req: Request) {
  return handle("worker pending", async () => {
    requireWorker(req);
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
  });
}
