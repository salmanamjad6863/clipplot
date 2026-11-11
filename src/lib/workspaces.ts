import "server-only";
import { cookies } from "next/headers";
import { HttpError } from "./api";
import { supabaseEnv } from "./data";
import { RENDER_BUCKET, supabaseAdmin } from "./data/supabase-store";
import { GAMES } from "./games";
import { MAIN_WORKSPACE_ID, type Workspace } from "./types";

/**
 * Workspaces = one per YouTube channel, all under the same login.
 * The dashboard's current workspace lives in the `cp_ws` cookie; background jobs (scheduler, worker)
 * iterate over every workspace.
 */
export const WS_COOKIE = "cp_ws";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function db() {
  const env = supabaseEnv();
  return env ? supabaseAdmin(env.url, env.key) : null;
}

function fail(what: string, error: { message: string; code?: string }): never {
  if (error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST204" || error.code === "42703") {
    throw new HttpError(503, "Database needs an update — run supabase/migrations/0003_workspaces.sql in the Supabase SQL Editor");
  }
  throw new Error(`Supabase ${what}: ${error.message}`);
}

let cache: { at: number; list: Workspace[] } | null = null;
const forget = () => (cache = null);

export async function listWorkspaces(): Promise<Workspace[]> {
  const sb = db();
  if (!sb) return [{ id: MAIN_WORKSPACE_ID, name: "Main", createdAt: new Date(0).toISOString(), youtubeConnected: false }];
  if (cache && Date.now() - cache.at < 5_000) return cache.list;

  const [w, s] = await Promise.all([
    sb.from("workspaces").select("id, name, created_at").order("created_at"),
    sb.from("settings").select("workspace_id, youtube_refresh_token, youtube_channel_title"),
  ]);
  if (w.error) fail("workspaces", w.error);
  if (s.error) fail("workspace settings", s.error);
  const bySettings = new Map(
    (s.data as { workspace_id: string; youtube_refresh_token: string | null; youtube_channel_title: string | null }[]).map((r) => [
      r.workspace_id,
      r,
    ]),
  );
  const list = (w.data as { id: string; name: string; created_at: string }[]).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    youtubeConnected: Boolean(bySettings.get(r.id)?.youtube_refresh_token),
    channelTitle: bySettings.get(r.id)?.youtube_channel_title ?? undefined,
  }));
  cache = { at: Date.now(), list };
  return list;
}

/** Workspace the dashboard is looking at (cookie), falling back to the oldest one. */
export async function currentWorkspaceId(): Promise<string> {
  const list = await listWorkspaces();
  if (list.length === 0) throw new HttpError(503, "No workspaces — run supabase/migrations/0003_workspaces.sql");
  const wanted = (await cookies()).get(WS_COOKIE)?.value;
  return list.find((w) => w.id === wanted)?.id ?? list[0].id;
}

export async function setCurrentWorkspace(id: string) {
  const list = await listWorkspaces();
  if (!list.some((w) => w.id === id)) throw new HttpError(404, "Workspace not found");
  (await cookies()).set(WS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

const SETTINGS_COPY = [
  "autopilot",
  "upload_time",
  "min_views_per_hour",
  "max_fallback_depth",
  "lookback_hours",
  "dedupe_window_days",
  "title_similarity",
  "formats",
  "render",
  "youtube_privacy",
] as const;

/** New workspace with its own settings + games. Copies settings/game order from `copyFrom` if given. */
export async function createWorkspace(name: string, copyFrom?: string): Promise<Workspace> {
  const sb = db();
  if (!sb) throw new HttpError(503, "Workspaces need Supabase");
  const { data: ws, error } = await sb.from("workspaces").insert({ name }).select("id, name, created_at").single();
  if (error) fail("create workspace", error);
  const id = (ws as { id: string }).id;

  try {
    // settings (YouTube connection and scheduler history are NOT copied)
    let settingsRow: Record<string, unknown> = { workspace_id: id };
    if (copyFrom && UUID_RE.test(copyFrom)) {
      const { data } = await sb.from("settings").select(SETTINGS_COPY.join(",")).eq("workspace_id", copyFrom).maybeSingle();
      if (data) settingsRow = { ...(data as unknown as Record<string, unknown>), workspace_id: id };
    }
    const s = await sb.from("settings").insert(settingsRow);
    if (s.error) fail("create settings", s.error);

    // topics: copy the current workspace's (incl. custom ones) or start from the presets.
    // Playlists belong to a channel → never copied.
    let rows: Record<string, unknown>[] = GAMES.map((x) => ({
      slug: x.slug,
      name: x.name,
      priority: x.priority,
      enabled: true,
      queries: x.queries,
      hashtags: x.hashtags,
      playlist_title: x.playlistTitle,
    }));
    if (copyFrom && UUID_RE.test(copyFrom)) {
      const { data } = await sb.from("games").select("*").eq("workspace_id", copyFrom);
      if (data?.length) {
        const omit = new Set(["workspace_id", "short_playlist_id", "long_playlist_id"]);
        rows = (data as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.has(k))));
      }
    }
    const g = await sb.from("games").insert(rows.map((r) => ({ ...r, workspace_id: id })));
    if (g.error) fail("create games", g.error);
  } catch (err) {
    await sb.from("workspaces").delete().eq("id", id); // don't leave a half-made workspace
    throw err;
  }
  forget();
  return (await listWorkspaces()).find((w) => w.id === id)!;
}

export async function renameWorkspace(id: string, name: string) {
  const sb = db();
  if (!sb) throw new HttpError(503, "Workspaces need Supabase");
  const { data, error } = await sb.from("workspaces").update({ name }).eq("id", id).select("id");
  if (error) fail("rename workspace", error);
  if (!data?.length) throw new HttpError(404, "Workspace not found");
  forget();
}

/** Deletes a workspace and everything in it (settings, games, trends, clips, jobs, previews). */
export async function deleteWorkspace(id: string) {
  const sb = db();
  if (!sb) throw new HttpError(503, "Workspaces need Supabase");
  const list = await listWorkspaces();
  if (!list.some((w) => w.id === id)) throw new HttpError(404, "Workspace not found");
  if (list.length <= 1) throw new HttpError(409, "You can't delete your only workspace");

  const { data: clips } = await sb.from("clips").select("id").eq("workspace_id", id);
  const paths = (clips ?? []).flatMap((c: { id: string }) => [`${c.id}/preview.mp4`, `${c.id}/preview.jpg`]);
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from(RENDER_BUCKET).remove(paths.slice(i, i + 100));

  const { error } = await sb.from("workspaces").delete().eq("id", id); // cascades to everything else
  if (error) fail("delete workspace", error);
  forget();
}

/** Which workspace a clip belongs to (worker routes only know clip/job ids). */
export async function workspaceOfClip(clipId: string): Promise<string | null> {
  if (!UUID_RE.test(clipId)) return null;
  const sb = db();
  if (!sb) return MAIN_WORKSPACE_ID;
  const { data, error } = await sb.from("clips").select("workspace_id").eq("id", clipId).maybeSingle();
  if (error) fail("clip workspace", error);
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

/** Name of another workspace already connected to this YouTube channel, if any. */
export async function channelConnectedElsewhere(channelId: string, exceptWorkspace: string): Promise<string | null> {
  const sb = db();
  if (!sb) return null;
  const { data, error } = await sb
    .from("settings")
    .select("workspace_id")
    .eq("youtube_channel_id", channelId)
    .neq("workspace_id", exceptWorkspace)
    .not("youtube_refresh_token", "is", null)
    .limit(1);
  if (error) fail("channel check", error);
  const other = (data as { workspace_id: string }[])[0]?.workspace_id;
  if (!other) return null;
  return (await listWorkspaces()).find((w) => w.id === other)?.name ?? "another workspace";
}

export const forgetWorkspaceCache = forget;
