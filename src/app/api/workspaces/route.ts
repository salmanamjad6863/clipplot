import { connection } from "next/server";
import { HttpError, handle } from "@/lib/api";
import { createWorkspace, currentWorkspaceId, listWorkspaces, setCurrentWorkspace } from "@/lib/workspaces";

export async function GET() {
  await connection();
  return handle("list workspaces", async () => ({ workspaces: await listWorkspaces(), currentId: await currentWorkspaceId() }));
}

/** Create a workspace (optionally copying the current one's settings) and switch to it. */
export async function POST(req: Request) {
  return handle("create workspace", async () => {
    const { name, copySettings } = (await req.json().catch(() => ({}))) as { name?: string; copySettings?: boolean };
    const clean = String(name ?? "").trim();
    if (clean.length < 1 || clean.length > 40) throw new HttpError(400, "Name must be 1–40 characters");
    const ws = await createWorkspace(clean, copySettings ? await currentWorkspaceId() : undefined);
    await setCurrentWorkspace(ws.id);
    console.info(`[workspaces] created "${ws.name}" (${ws.id})`);
    return ws;
  });
}
