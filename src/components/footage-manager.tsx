"use client";

import { useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/queries";
import type { Topic } from "@/lib/topics";
import { ConfirmDialog } from "./confirm-dialog";
import { inputCls } from "./ui";

interface FootageFile {
  game: string;
  name: string;
  path: string;
  size: number;
}

const MAX_MB = 50;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * Settings → Footage library. Clips uploaded here are used by the cloud worker (and your Mac) as the
 * background of every video for that topic. Files go straight from the browser to storage.
 */
export function FootageManager({ topics }: { topics: Topic[] }) {
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ["footage"], queryFn: () => api<FootageFile[]>("/api/footage") });
  const [game, setGame] = useState(topics[0]?.slug ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<FootageFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | null) {
    if (!list?.length || !game) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return toast.error("Supabase isn't configured");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    for (const f of Array.from(list)) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(`${f.name} is ${mb(f.size)} — max ${MAX_MB} MB per file`, { description: "Trim or compress it first." });
        continue;
      }
      setBusy(f.name);
      try {
        const { path, token } = await api<{ path: string; token: string }>("/api/footage", {
          method: "POST",
          body: JSON.stringify({ game, name: f.name, size: f.size }),
        });
        const { error } = await sb.storage.from("footage").uploadToSignedUrl(path, token, f, { contentType: f.type || "video/mp4", upsert: true });
        if (error) throw new Error(error.message);
        toast.success(`Uploaded ${f.name}`);
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    qc.invalidateQueries({ queryKey: ["footage"] });
  }

  async function remove(f: FootageFile) {
    setDel(null);
    try {
      await api(`/api/footage?path=${encodeURIComponent(f.path)}`, { method: "DELETE" });
      toast.success(`Deleted ${f.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
    qc.invalidateQueries({ queryKey: ["footage"] });
  }

  const byGame = new Map<string, FootageFile[]>();
  for (const f of files.data ?? []) byGame.set(f.game, [...(byGame.get(f.game) ?? []), f]);
  const name = (slug: string) => topics.find((t) => t.slug === slug)?.name ?? slug;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Short gameplay or official trailer clips (.mp4, max {MAX_MB} MB each). Every video for that topic is built from
        quick cuts of these. Used by the cloud worker, so your Mac doesn&apos;t need to be on.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select value={game} onChange={(e) => setGame(e.target.value)} className={`${inputCls} cursor-pointer sm:max-w-xs`}>
          {topics.map((t) => (
            <option key={t.slug} value={t.slug} className="bg-bg-elev">
              {t.name}
            </option>
          ))}
        </select>
        <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button
          onClick={() => input.current?.click()}
          disabled={!!busy || !game}
          className="inline-flex items-center gap-1.5 rounded-full bg-sunset px-4 py-2 text-sm font-medium text-bg transition-transform enabled:hover:scale-105 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? `Uploading ${busy}…` : "Upload clips"}
        </button>
      </div>

      {files.isLoading ? (
        <div className="skeleton h-16 rounded-xl" />
      ) : byGame.size === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No footage yet — videos use an animated gradient background until you add some.
        </p>
      ) : (
        <div className="space-y-3">
          {[...byGame].map(([g, list]) => (
            <div key={g} className="rounded-xl border border-border">
              <p className="border-b border-border px-4 py-2 text-xs font-medium text-muted">
                {name(g)} · {list.length} clip{list.length === 1 ? "" : "s"}
              </p>
              {list.map((f) => (
                <div key={f.path} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Film className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="font-mono text-xs text-muted">{mb(f.size)}</span>
                  <button onClick={() => setDel(f)} aria-label={`Delete ${f.name}`} className="text-muted hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog open={!!del} title="Delete this clip?" confirmLabel="Delete" tone="danger" onConfirm={() => del && remove(del)} onCancel={() => setDel(null)}>
        <p>
          <b>{del?.name}</b> will be removed from the footage library. Videos already made aren&apos;t affected.
        </p>
      </ConfirmDialog>
    </div>
  );
}
