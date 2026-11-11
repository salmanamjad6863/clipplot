import { HttpError, handle } from "@/lib/api";
import { setCurrentWorkspace } from "@/lib/workspaces";

/** Switch the dashboard to another workspace (cookie). */
export async function POST(req: Request) {
  return handle("switch workspace", async () => {
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (!id) throw new HttpError(400, "id required");
    await setCurrentWorkspace(id);
    return { ok: true, currentId: id };
  });
}
