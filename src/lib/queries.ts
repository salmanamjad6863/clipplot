"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Clip, ClipPatch, Settings, Trend } from "./types";

export const queryKeys = {
  clips: ["clips"] as const,
  clip: (id: string) => ["clips", id] as const,
  trends: ["trends"] as const,
  settings: ["settings"] as const,
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
      q.state.data?.some((c) => ["discovered", "scripting", "rendering"].includes(c.status)) ? 15_000 : false,
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
    mutationFn: (id: string) => api<Clip>(`/api/clips/${id}/script`, { method: "POST" }),
    onMutate: (id) => {
      qc.setQueryData<Clip[]>(queryKeys.clips, (l) => l?.map((c) => (c.id === id ? { ...c, status: "scripting" } : c)));
      qc.setQueryData<Clip>(queryKeys.clip(id), (c) => (c ? { ...c, status: "scripting" } : c));
    },
    onSuccess: (clip) => {
      qc.setQueryData(queryKeys.clip(clip.id), clip);
      toast.success("Script ready", { description: clip.title });
    },
    onError: (err) => toast.error(err.message),
    onSettled: (_d, _e, id) => {
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
    mutationFn: () => api<DiscoveryResult>("/api/discover", { method: "POST" }),
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

/* ---------- Settings ---------- */

export function useSettings() {
  const hydrated = useHydrated();
  return hydrationSafe(useQuery({ queryKey: queryKeys.settings, queryFn: () => api<Settings>("/api/settings") }), hydrated);
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
