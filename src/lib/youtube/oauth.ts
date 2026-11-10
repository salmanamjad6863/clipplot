import "server-only";
import { HttpError } from "../api";

/**
 * Google OAuth 2.0 (web server flow) for one YouTube channel.
 * Scope `youtube` = upload videos + manage playlists on the connected channel.
 */
export const STATE_COOKIE = "cp_oauth_state";
export const SCOPES = ["https://www.googleapis.com/auth/youtube"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export function oauthConfig(origin: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpError(503, "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local to connect YouTube");
  }
  // Must match an "Authorized redirect URI" in Google Cloud exactly
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/youtube/callback`;
  return { clientId, clientSecret, redirectUri };
}

export function authorizeUrl(origin: string, state: string) {
  const { clientId, redirectUri } = oauthConfig(origin);
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // → refresh token
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${qs}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (data.error === "invalid_grant") {
      throw new HttpError(401, "YouTube access was revoked or expired — reconnect the channel in Settings");
    }
    throw new HttpError(502, `Google token error: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data;
}

export async function exchangeCode(origin: string, code: string) {
  const { clientId, clientSecret, redirectUri } = oauthConfig(origin);
  const t = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!t.refresh_token) throw new HttpError(502, "Google didn't return a refresh token — remove the app at myaccount.google.com/permissions and connect again");
  if (!SCOPES.every((s) => t.scope.split(" ").includes(s))) {
    throw new HttpError(400, "YouTube permission wasn't granted — tick the YouTube checkbox on Google's consent screen");
  }
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in };
}

/** Short-lived access token from the stored refresh token (~1h validity). */
export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = oauthConfig("http://unused");
  const t = await tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  return { accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
}

export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {}); // best effort
}
