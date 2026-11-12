import "server-only";
import { HttpError } from "../api";
import { decrypt } from "../crypto";
import { getStore } from "../data";
import type { Topic } from "../topics";
import type { Clip, Settings } from "../types";
import { refreshAccessToken } from "./oauth";

const API = "https://www.googleapis.com/youtube/v3";

// one access token per workspace (= channel)
const cached = new Map<string, { token: string; expiresAt: number }>();

/** Fresh access token for a workspace's channel (cached until ~5 min before expiry). */
export async function getAccessToken(ws: string): Promise<{ accessToken: string; expiresAt: number }> {
  const c = cached.get(ws);
  if (c && c.expiresAt - Date.now() > 5 * 60_000) return { accessToken: c.token, expiresAt: c.expiresAt };
  const { refreshTokenEnc } = await getStore(ws).getYouTubeCredentials();
  if (!refreshTokenEnc) throw new HttpError(409, "YouTube isn't connected for this workspace — connect it in Settings");
  const t = await refreshAccessToken(decrypt(refreshTokenEnc));
  cached.set(ws, { token: t.accessToken, expiresAt: t.expiresAt });
  return t;
}

export function forgetAccessToken(ws: string) {
  cached.delete(ws);
}

async function yt<T>(path: string, token: string, init?: RequestInit & { query?: Record<string, string> }): Promise<T> {
  const qs = init?.query ? `?${new URLSearchParams(init.query)}` : "";
  const res = await fetch(`${API}/${path}${qs}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? "";
    const err = new HttpError(res.status === 401 ? 401 : 502, `YouTube API: ${body.error?.message ?? res.status}`);
    (err as HttpError & { reason?: string }).reason = reason;
    throw err;
  }
  return body;
}

export async function fetchMyChannel(token: string) {
  const r = await yt<{ items?: { id: string; snippet: { title: string } }[] }>("channels", token, {
    query: { part: "snippet", mine: "true" },
  });
  const ch = r.items?.[0];
  if (!ch) throw new HttpError(400, "This Google account has no YouTube channel — create one at youtube.com first");
  return { id: ch.id, title: ch.snippet.title };
}

/** Title/description/tags/privacy for videos.insert — single source of truth, used by the worker. */
export function buildUploadMetadata(clip: Clip, settings: Settings) {
  const game = settings.topics.find((t) => t.slug === clip.game);
  const isShort = clip.format === "short";
  // #Shorts only on Shorts; game hashtags on both
  const tags = (game?.hashtags ?? []).filter((h) => isShort || h.toLowerCase() !== "#shorts");
  let description = clip.description.trim();
  for (const h of tags) if (!description.includes(h)) description += (description ? "\n" : "") + h;
  if (!isShort) description = description.replace(/\s*#Shorts\b/gi, "");
  // full videos: chapters (timestamps help search + keep viewers navigating instead of leaving)
  const ch = clip.script?.chapters ?? [];
  if (!isShort && ch.length >= 3 && ch[0].t === 0) {
    const ts = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    description += `\n\nChapters\n${ch.map((c) => `${ts(c.t)} ${c.title}`).join("\n")}`;
  }
  // Creative Commons visuals need attribution (kept last so it never crowds the hook)
  const credits = clip.script?.credits ?? [];
  if (credits.length) description += `\n\nVisuals:\n${credits.map((c) => `• ${c}`).join("\n")}`;

  return {
    snippet: {
      title: clip.title.slice(0, 100),
      description: description.slice(0, 5000),
      tags: clip.tags.slice(0, 30),
      categoryId: "20", // Gaming
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: {
      privacyStatus: clip.privacy ?? settings.youtubePrivacy, // chosen when approving, else the workspace default
      selfDeclaredMadeForKids: false,
      embeddable: true,
    },
  };
}

function playlistTitle(topic: Topic | undefined, gameSlug: string, format: "short" | "long") {
  const name = topic?.name ?? gameSlug;
  return format === "short" ? topic?.playlistTitle || `${name} Shorts` : `${name} — Full Videos`;
}

async function createPlaylist(ws: string, token: string, gameSlug: string, format: "short" | "long") {
  const topic = (await getStore(ws).getSettings()).topics.find((t) => t.slug === gameSlug);
  const r = await yt<{ id: string }>("playlists", token, {
    method: "POST",
    query: { part: "snippet,status" },
    body: JSON.stringify({
      snippet: {
        title: playlistTitle(topic, gameSlug, format),
        description: `Daily ${format === "short" ? "Shorts" : "breakdowns"} about ${topic?.name ?? gameSlug}.`,
      },
      status: { privacyStatus: "public" },
    }),
  });
  await getStore(ws).setPlaylistId(gameSlug, format, r.id);
  console.info(`[youtube] created playlist "${playlistTitle(topic, gameSlug, format)}" ${r.id}`);
  return r.id;
}

/** Adds a published video to its game's playlist, creating (or re-creating) the playlist as needed. */
export async function addToGamePlaylist(clip: Clip, videoId: string): Promise<string> {
  const ws = clip.workspaceId;
  const { accessToken } = await getAccessToken(ws);
  let playlistId = (await getStore(ws).getPlaylistId(clip.game, clip.format)) ?? (await createPlaylist(ws, accessToken, clip.game, clip.format));
  const insert = (pid: string) =>
    yt("playlistItems", accessToken, {
      method: "POST",
      query: { part: "snippet" },
      body: JSON.stringify({ snippet: { playlistId: pid, resourceId: { kind: "youtube#video", videoId } } }),
    });
  try {
    await insert(playlistId);
  } catch (err) {
    // playlist was deleted on YouTube → make a new one and retry once
    if ((err as { reason?: string }).reason === "playlistNotFound") {
      playlistId = await createPlaylist(ws, accessToken, clip.game, clip.format);
      await insert(playlistId);
    } else throw err;
  }
  await getStore(ws).setClipPlaylist(clip.id, playlistId);
  return playlistId;
}
