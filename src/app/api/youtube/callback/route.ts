import { cookies } from "next/headers";
import { HttpError } from "@/lib/api";
import { safeEqual } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { getStore } from "@/lib/data";
import { queueApprovedUploads } from "@/lib/publish";
import { fetchMyChannel, forgetAccessToken } from "@/lib/youtube/channel";
import { STATE_COOKIE, exchangeCode } from "@/lib/youtube/oauth";

/** Google redirects here after consent. Stores the (encrypted) refresh token + channel. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(`${url.origin}/settings?${q}`, 302);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/youtube" });

  const googleError = url.searchParams.get("error");
  if (googleError) return back(`youtube_error=${encodeURIComponent(googleError === "access_denied" ? "You cancelled the Google sign-in" : googleError)}`);

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!expected || !safeEqual(state, expected) || !code) {
    return back(`youtube_error=${encodeURIComponent("Sign-in expired or was tampered with — try again")}`);
  }

  try {
    const t = await exchangeCode(url.origin, code);
    const channel = await fetchMyChannel(t.accessToken);
    await getStore().saveYouTubeConnection({
      refreshTokenEnc: encrypt(t.refreshToken),
      channelId: channel.id,
      channelTitle: channel.title,
    });
    forgetAccessToken();
    console.info(`[youtube] connected channel "${channel.title}" (${channel.id})`);
    await queueApprovedUploads(); // anything approved while disconnected uploads now
    return back(`youtube=connected`);
  } catch (err) {
    console.error("[youtube] callback failed:", err);
    const msg = err instanceof HttpError ? err.message : "Connecting YouTube failed — check the server logs";
    return back(`youtube_error=${encodeURIComponent(msg)}`);
  }
}
