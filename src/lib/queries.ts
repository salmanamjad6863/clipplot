"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { GAMES } from "./games";
import { presetTopic, type Topic } from "./topics";
import type { Clip, ClipPatch, Settings, Trend, Workspace } from "./types";

export const queryKeys = {
  clips: ["clips"] as const,
  clip: (id: string) => ["clips", id] as const,
  trends: ["trends"] as const,
  settings: ["settings"] as const,
  workspaces: ["workspaces"] as const,
};

const noopSubscribe = () => () => {};

/** false during SSR + hydration, true afterwards */
function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * The server always renders the loading state. If the cache gets filled (e.g. by the sidebar)
 * before a Suspense boundary hydrates, reading it would mismatch — so hide data until hydrated.
 */
function hydrationSafe<T extends { data: unknown; isLoading: boolean }>(q: T, hydrated: boolean): T {
  return hydrated ? q : { ...q, data: undefined, isLoading: true };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

/* ---------- Clips ---------- */

export function useClips() {
  const hydrated = useHydrated();
  const q = useQuery({
    queryKey: queryKeys.clips,
    queryFn: () => api<Clip[]>("/api/clips"),
    // Keep status live while things are rendering
    refetchInterval: (q) =>
      q.state.data?.some((c) => ["discovered", "scripting", "rendering"].includes(c.status) || c.uploadState) ? 10_000 : false,
  });
  return hydrationSafe(q, hydrated);
}

export function useClip(id: string) {
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const q = useQuery({
    queryKey: queryKeys.clip(id),
    queryFn: () => api<Clip>(`/api/clips/${id}`),
    initialData: () => qc.getQueryData<Clip[]>(queryKeys.clips)?.find((c) => c.id === id),
    // live while it renders or uploads
    refetchInterval: (q) => {
      const c = q.state.data;
      return c && (["scripting", "rendering"].includes(c.status) || c.uploadState) ? 5_000 : false;
    },
  });
  return hydrationSafe(q, hydrated);
}

/** Optimistically patches the clip in both the list and detail caches; rolls back on error. */
export function useUpdateClip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ClipPatch }) =>
      api<Clip>(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.clips });
      const prevList = qc.getQueryData<Clip[]>(queryKeys.clips);
      const prevOne = qc.getQueryData<Clip>(queryKeys.clip(id));
      qc.setQueryData<Clip[]>(queryKeys.clips, (list) => list?.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      if (prevOne) qc.setQueryData<Clip>(queryKeys.clip(id), { ...prevOne, ...patch });
      return { prevList, prevOne };
    },
    onError: (err, { id }, ctx) => {
      if (ctx?.prevList) qc.setQueryData(queryKeys.clips, ctx.prevList);
      if (ctx?.prevOne) qc.setQueryData(queryKeys.clip(id), ctx.prevOne);
      toast.error(err.message);
    },
    onSuccess: (clip) => qc.setQueryData(queryKeys.clip(clip.id), clip),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.clips }),
  });
}

export function useRegenerateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api<Clip>(`/api/clips/${id}/script`, { method: "POST", body: JSON.stringify({ note }) }),
    onMutate: ({ id }) => {
      qc.setQueryData<Clip[]>(queryKeys.clips, (l) => l?.map((c) => (c.id === id ? { ...c, status: "scripting" } : c)));
      qc.setQueryData<Clip>(queryKeys.clip(id), (c) => (c ? { ...c, status: "scripting" } : c));
    },
    onSuccess: (clip) => {
      qc.setQueryData(queryKeys.clip(clip.id), clip);
      toast.success("Script ready", { description: clip.title });
    },
    onError: (err) => toast.error(err.message),
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.clips });
      qc.invalidateQueries({ queryKey: queryKeys.clip(id) });
    },
  });
}

/* ---------- Trends ---------- */

export function useTrends() {
  const hydrated = useHydrated();
  return hydrationSafe(useQuery({ queryKey: queryKeys.trends, queryFn: () => api<Trend[]>("/api/trends") }), hydrated);
}

export interface DiscoveryResult {
  trendsSaved: number;
  clipsCreated: number;
  fellBack: boolean;
  quotaUsed: number;
  games: { game: string; fetched: number; candidates: number; duplicates: number; belowThreshold: number; picked: number; error?: string }[];
}

export function useRunDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { extra?: boolean }) =>
      api<DiscoveryResult>("/api/discover", { method: "POST", body: JSON.stringify({ extra: Boolean(opts?.extra) }) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.trends });
      qc.invalidateQueries({ queryKey: queryKeys.clips });
      const err = r.games.find((g) => g.error)?.error;
      if (err && r.trendsSaved === 0) {
        toast.error(err);
        return;
      }
      const dupes = r.games.reduce((s, g) => s + g.duplicates, 0);
      toast.success(
        r.clipsCreated > 0 ? `${r.clipsCreated} new clip${r.clipsCreated > 1 ? "s" : ""} queued` : "No new clips today",
        {
          description: `${r.trendsSaved} trends saved · ${dupes} repeats skipped · ${r.games.map((g) => g.game).join(" → ")}${
            r.fellBack ? " (fell back)" : ""
          } · ~${r.quotaUsed} quota`,
        },
      );
    },
    onError: (err) => toast.error(err.message),
  });
}

/** Manual lookup: keyword (last 7 days) or a pasted YouTube link → results join the radar */
export function useLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { query?: string; url?: string; game: string }) =>
      api<{ trends: Trend[] }>("/api/trends/search", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.trends });
      toast.success(r.trends.length ? `${r.trends.length} video(s) added to the radar` : "Nothing found for that search");
    },
    onError: (err) => toast.error(err.message),
  });
}

/** "Make clip" from any trend → Claude scripts it in the background */
export function useClipFromTrend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { trendId: string; format: "short" | "long" }) =>
      api<Clip>(`/api/trends/${v.trendId}/clip`, { method: "POST", body: JSON.stringify({ format: v.format }) }),
    onSuccess: (clip) => {
      qc.invalidateQueries({ queryKey: queryKeys.trends });
      qc.invalidateQueries({ queryKey: queryKeys.clips });
      toast.success("Clip created — Claude is writing the script", { description: clip.title });
    },
    onError: (err) => toast.error(err.message),
  });
}

/** Change one clip's voice → re-render it */
export function useClipVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, voice }: { id: string; voice: string | null }) =>
      api<Clip>(`/api/clips/${id}/voice`, { method: "POST", body: JSON.stringify({ voice }) }),
    onSuccess: (clip) => {
      qc.setQueryData(queryKeys.clip(clip.id), clip);
      toast.success("Re-rendering with the new voice", { description: "Takes about a minute (worker must be running)" });
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.clips }),
  });
}

/** "Swap trend": skip this clip, build a new one from the next-best trend */
export function useSwapTrend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Clip>(`/api/clips/${id}/swap`, { method: "POST" }),
    onSuccess: (clip) => {
      qc.invalidateQueries({ queryKey: queryKeys.clips });
      qc.invalidateQueries({ queryKey: queryKeys.trends });
      toast.success("Swapped — new clip on the way", { description: clip.title });
    },
    onError: (err) => toast.error(err.message),
  });
}

/* ---------- Settings ---------- */

export function useSettings() {
  const hydrated = useHydrated();
  return hydrationSafe(useQuery({ queryKey: queryKeys.settings, queryFn: () => api<Settings>("/api/settings") }), hydrated);
}

/* ---------- Workspaces (one per YouTube channel) ---------- */

export function useWorkspaces() {
  const hydrated = useHydrated();
  return hydrationSafe(
    useQuery({
      queryKey: queryKeys.workspaces,
      queryFn: () => api<{ workspaces: Workspace[]; currentId: string }>("/api/workspaces"),
    }),
    hydrated,
  );
}

/** Everything on screen belongs to the old workspace → drop all cached data and refetch. */
function useResetAll() {
  const qc = useQueryClient();
  return () => qc.resetQueries();
}

export function useSwitchWorkspace() {
  const reset = useResetAll();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>("/api/workspaces/current", { method: "POST", body: JSON.stringify({ id }) }),
    onSuccess: () => reset(),
    onError: (err) => toast.error(err.message),
  });
}

export function useCreateWorkspace() {
  const reset = useResetAll();
  return useMutation({
    mutationFn: (v: { name: string; copySettings: boolean }) =>
      api<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (ws) => {
      reset();
      toast.success(`Workspace "${ws.name}" created`, { description: "Connect its YouTube channel in Settings." });
    },
    onError: (err) => toast.error(err.message),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      api<Workspace>(`/api/workspaces/${v.id}`, { method: "PATCH", body: JSON.stringify({ name: v.name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces });
      toast.success("Workspace renamed");
    },
    onError: (err) => toast.error(err.message),
  });
}

export function useDeleteWorkspace() {
  const reset = useResetAll();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      reset();
      toast.success("Workspace deleted");
    },
    onError: (err) => toast.error(err.message),
  });
}

export function useDisconnectYouTube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/api/youtube/disconnect", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings });
      toast.success("YouTube disconnected");
    },
    onError: (err) => toast.error(err.message),
  });
}

/** Current workspace's topics (falls back to the built-in presets while loading) */
export function useTopics(): Topic[] {
  const { data } = useSettings();
  return data?.topics ?? PRESET_TOPICS;
}
const PRESET_TOPICS: Topic[] = GAMES.map((g) => presetTopic(g.slug, g.priority)!);

export function useTopicMap(): Record<string, Topic> {
  const topics = useTopics();
  return Object.fromEntries(topics.map((t) => [t.slug, t]));
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: Partial<Settings>) =>
      api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(next) }),
    onSuccess: (s) => {
      qc.setQueryData(queryKeys.settings, s);
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(err.message),
  });
}
