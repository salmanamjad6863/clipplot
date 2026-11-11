import { HttpError, handle } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { getStore } from "@/lib/data";
import { forgetAccessToken } from "@/lib/youtube/channel";
import { revokeToken } from "@/lib/youtube/oauth";
import { deleteWorkspace, listWorkspaces, renameWorkspace } from "@/lib/workspaces";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle("rename workspace", async () => {
    const { name } = (await req.json().catch(() => ({}))) as { name?: string };
    const clean = String(name ?? "").trim();
    if (clean.length < 1 || clean.length > 40) throw new HttpError(400, "Name must be 1–40 characters");
    await renameWorkspace(id, clean);
    return (await listWorkspaces()).find((w) => w.id === id);
  });
}

/** Delete a workspace and all its data. Videos already on YouTube are untouched. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle("delete workspace", async () => {
    try {
      const { refreshTokenEnc } = await getStore(id).getYouTubeCredentials();
      if (refreshTokenEnc) await revokeToken(decrypt(refreshTokenEnc));
    } catch {
      /* best effort — still delete */
    }
    forgetAccessToken(id);
    await deleteWorkspace(id);
    console.info(`[workspaces] deleted ${id}`);
    return { ok: true };
  });
}
