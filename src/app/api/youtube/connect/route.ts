import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/api";
import { OAUTH_WS_COOKIE, STATE_COOKIE, authorizeUrl } from "@/lib/youtube/oauth";
import { currentWorkspaceId } from "@/lib/workspaces";

/** Settings → "Connect YouTube" → Google consent screen. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    const state = randomBytes(24).toString("base64url");
    const opts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const, // sent on Google's top-level redirect back to us
      path: "/api/youtube",
      maxAge: 600,
    };
    const jar = await cookies();
    jar.set(STATE_COOKIE, state, opts);
    jar.set(OAUTH_WS_COOKIE, await currentWorkspaceId(), opts);
    return Response.redirect(authorizeUrl(origin, state), 302);
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : "Couldn't start YouTube sign-in";
    return Response.redirect(`${origin}/settings?youtube_error=${encodeURIComponent(msg)}`, 302);
  }
}
