/**
 * Single-user password gate. Session = "<expiresAtMs>.<hmac>" in an httpOnly cookie,
 * signed with SESSION_SECRET via Web Crypto (works in proxy + route handlers).
 */

export const SESSION_COOKIE = "cp_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

/** "disabled" = no password set in dev (open), "misconfigured" = production without secrets */
export function authMode(): "enabled" | "disabled" | "misconfigured" {
  const has = Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET);
  if (has) return "enabled";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "disabled";
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.SESSION_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(sig).toString("base64url");
}

/** Constant-time string compare */
export function safeEqual(a: string, b: string): boolean {
  const A = enc.encode(a);
  const B = enc.encode(b);
  let diff = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) diff |= (A[i] ?? 0) ^ (B[i] ?? 0);
  return diff === 0;
}

export async function createSession(): Promise<string> {
  const exp = String(Date.now() + SESSION_MAX_AGE * 1000);
  return `${exp}.${await hmac(exp)}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(exp));
}
