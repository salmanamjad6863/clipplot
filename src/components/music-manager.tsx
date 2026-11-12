"use client";

import { useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Music2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/queries";
import { ConfirmDialog } from "./confirm-dialog";
import { inputCls } from "./ui";

interface Track {
  mood: string;
  name: string;
  path: string;
  size: number;
}

const MOODS = [
  ["hype", "Hype"],
  ["mystery", "Mystery"],
  ["chill", "Chill"],
  ["epic", "Epic"],
  ["funny", "Funny"],
] as const;
const MAX_MB = 20;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * Settings → Music library. Claude tags each video with a mood; the worker picks a track of that mood from
 * here (else free CC0 / CC BY music). Best source: YouTube Studio → Audio Library (100% safe on YouTube).
 */
export function MusicManager() {
  const qc = useQueryClient();
  const tracks = useQuery({ queryKey: ["music"], queryFn: () => api<Track[]>("/api/music") });
  const [mood, setMood] = useState<string>("hype");
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<Track | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return toast.error("Supabase isn't configured");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    for (const f of Array.from(list)) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(`${f.name} is ${mb(f.size)} — max ${MAX_MB} MB`);
        continue;
      }
      setBusy(f.name);
      try {
        const { path, token } = await api<{ path: string; token: string }>("/api/music", {
          method: "POST",
          body: JSON.stringify({ mood, name: f.name, size: f.size }),
        });
        const { error } = await sb.storage.from("footage").uploadToSignedUrl(path, token, f, { contentType: f.type || "audio/mpeg", upsert: true });
        if (error) throw new Error(error.message);
        toast.success(`Added ${f.name}`);
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    qc.invalidateQueries({ queryKey: ["music"] });
  }

  async function remove(t: Track) {
    setDel(null);
    try {
      await api(`/api/music?path=${encodeURIComponent(t.path)}`, { method: "DELETE" });
      toast.success(`Removed ${t.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
    qc.invalidateQueries({ queryKey: ["music"] });
  }

  const byMood = new Map<string, Track[]>();
  for (const t of tracks.data ?? []) byMood.set(t.mood, [...(byMood.get(t.mood) ?? []), t]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Each video gets a mood (hype, mystery…) and a matching track, ducked under the hosts. Safest source: YouTube Studio →{" "}
        <b>Audio Library</b> (download, then upload here). Empty mood → free CC0 / CC BY music, credited automatically.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select value={mood} onChange={(e) => setMood(e.target.value)} className={`${inputCls} cursor-pointer sm:max-w-xs`}>
          {MOODS.map(([v, l]) => (
            <option key={v} value={v} className="bg-bg-elev">
              {l}
            </option>
          ))}
        </select>
        <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button
          onClick={() => input.current?.click()}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-sunset px-4 py-2 text-sm font-medium text-bg transition-transform enabled:hover:scale-105 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? `Uploading ${busy}…` : "Add tracks"}
        </button>
      </div>
      {tracks.isLoading ? (
        <div className="skeleton h-12 rounded-xl" />
      ) : byMood.size === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
          No tracks yet — videos use free Creative Commons music until you add some.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {[...byMood].map(([m, list]) => (
            <div key={m} className="rounded-xl border border-border">
              <p className="border-b border-border px-4 py-2 text-xs font-medium capitalize text-muted">
                {m} · {list.length}
              </p>
              {list.map((t) => (
                <div key={t.path} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Music2 className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="font-mono text-xs text-muted">{mb(t.size)}</span>
                  <button onClick={() => setDel(t)} aria-label={`Delete ${t.name}`} className="text-muted hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!del} title="Remove this track?" confirmLabel="Remove" tone="danger" onConfirm={() => del && remove(del)} onCancel={() => setDel(null)}>
        <p>
          <b>{del?.name}</b> will be removed from the music library.
        </p>
      </ConfirmDialog>
    </div>
  );
}
