import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/api";
import { STATE_COOKIE, authorizeUrl } from "@/lib/youtube/oauth";

/** Settings → "Connect YouTube" → Google consent screen. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    const state = randomBytes(24).toString("base64url");
    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // sent on Google's top-level redirect back to us
      path: "/api/youtube",
      maxAge: 600,
    });
    return Response.redirect(authorizeUrl(origin, state), 302);
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : "Couldn't start YouTube sign-in";
    return Response.redirect(`${origin}/settings?youtube_error=${encodeURIComponent(msg)}`, 302);
  }
}
