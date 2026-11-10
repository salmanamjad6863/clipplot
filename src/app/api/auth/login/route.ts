import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, authMode, createSession, safeEqual } from "@/lib/auth";

export async function POST(req: Request) {
  const mode = authMode();
  if (mode === "misconfigured") {
    return Response.json({ error: "Set APP_PASSWORD and SESSION_SECRET on the server" }, { status: 503 });
  }
  if (mode === "disabled") return Response.json({ ok: true });

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !safeEqual(password, process.env.APP_PASSWORD!)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    console.warn("[auth] failed login attempt");
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ ok: true });
}
