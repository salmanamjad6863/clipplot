import { handle } from "@/lib/api";
import { currentWorkspaceId } from "@/lib/workspaces";
import { decrypt } from "@/lib/crypto";
import { getStore } from "@/lib/data";
import { forgetAccessToken } from "@/lib/youtube/channel";
import { revokeToken } from "@/lib/youtube/oauth";

/** Revokes Google access and forgets the channel. Already-published videos stay on YouTube. */
export async function POST() {
  return handle("youtube disconnect", async () => {
    const ws = await currentWorkspaceId();
    const store = getStore(ws);
    const { refreshTokenEnc } = await store.getYouTubeCredentials();
    if (refreshTokenEnc) {
      try {
        await revokeToken(decrypt(refreshTokenEnc));
      } catch {
        /* key changed or token unreadable — still clear it locally */
      }
    }
    await store.clearYouTubeConnection();
    forgetAccessToken(ws);
    return { ok: true };
  });
}
