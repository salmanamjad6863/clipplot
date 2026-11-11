import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authMode, verifySession } from "@/lib/auth";

/** Protects the dashboard pages and data APIs behind the single-user password. */
export async function proxy(req: NextRequest) {
  const mode = authMode();
  if (mode === "disabled") return NextResponse.next();

  const ok = mode === "enabled" && (await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
  if (ok) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/review/:path*",
    "/library/:path*",
    "/trends/:path*",
    "/settings/:path*",
    "/api/clips/:path*",
    "/api/trends/:path*",
    "/api/settings/:path*",
    "/api/footage/:path*",
    "/api/discover/:path*",
    "/api/youtube/:path*",
    "/api/workspaces/:path*",
  ],
};
