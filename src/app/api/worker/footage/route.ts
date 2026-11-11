import { handle } from "@/lib/api";
import { footageDownloads } from "@/lib/footage";
import { readJson, requireWorker } from "@/lib/worker-auth";

/** Worker asks for a topic's footage → files with short-lived download links. */
export async function POST(req: Request) {
  return handle("worker footage", async () => {
    requireWorker(req);
    const { game } = await readJson<{ game?: string }>(req);
    return { files: await footageDownloads(String(game ?? "")) };
  });
}
