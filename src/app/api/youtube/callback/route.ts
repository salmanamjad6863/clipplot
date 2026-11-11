import { cookies } from "next/headers";
import { HttpError } from "@/lib/api";
import { safeEqual } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { getStore } from "@/lib/data";
import { queueApprovedUploads } from "@/lib/publish";
import { fetchMyChannel, forgetAccessToken } from "@/lib/youtube/channel";
import { OAUTH_WS_COOKIE, STATE_COOKIE, exchangeCode } from "@/lib/youtube/oauth";
import { channelConnectedElsewhere, listWorkspaces } from "@/lib/workspaces";

/** Google redirects here after consent. Stores the (encrypted) refresh token + channel for the workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(`${url.origin}/settings?${q}`, 302);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const wsCookie = jar.get(OAUTH_WS_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/youtube" });
  jar.delete({ name: OAUTH_WS_COOKIE, path: "/api/youtube" });

  const googleError = url.searchParams.get("error");
  if (googleError) return back(`youtube_error=${encodeURIComponent(googleError === "access_denied" ? "You cancelled the Google sign-in" : googleError)}`);

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!expected || !safeEqual(state, expected) || !code) {
    return back(`youtube_error=${encodeURIComponent("Sign-in expired or was tampered with — try again")}`);
  }

  try {
    const ws = (await listWorkspaces()).find((w) => w.id === wsCookie);
    if (!ws) throw new HttpError(400, "That workspace no longer exists — pick one and connect again");

    const t = await exchangeCode(url.origin, code);
    const channel = await fetchMyChannel(t.accessToken);

    // one channel ↔ one workspace (otherwise two workspaces would double-post to the same channel)
    const other = await channelConnectedElsewhere(channel.id, ws.id);
    if (other) {
      // don't revoke: Google revokes the whole grant, which would also disconnect the other workspace
      throw new HttpError(
        409,
        `"${channel.title}" is already connected to the "${other}" workspace. Pick a different channel (Google's account picker shows each Brand Account channel).`,
      );
    }

    await getStore(ws.id).saveYouTubeConnection({
      refreshTokenEnc: encrypt(t.refreshToken),
      channelId: channel.id,
      channelTitle: channel.title,
      scopes: t.scopes,
    });
    forgetAccessToken(ws.id);
    console.info(`[youtube] workspace "${ws.name}" connected channel "${channel.title}" (${channel.id})`);
    await queueApprovedUploads(ws.id); // anything approved while disconnected uploads now
    return back(`youtube=connected`);
  } catch (err) {
    console.error("[youtube] callback failed:", err);
    const msg = err instanceof HttpError ? err.message : "Connecting YouTube failed — check the server logs";
    return back(`youtube_error=${encodeURIComponent(msg)}`);
  }
}
