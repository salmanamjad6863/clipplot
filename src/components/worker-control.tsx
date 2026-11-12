"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Cpu, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/queries";

interface Beat {
  kind: "mac" | "cloud";
  state: string;
  title?: string;
  progress?: string;
  at: string;
}
interface Status {
  status: "working" | "idle" | "stopped";
  beat: Beat | null;
  queue: { render: number; upload: number; total: number };
  canStartLocal: boolean;
  canStartCloud: boolean;
}

/** Sidebar card: is the render/upload worker running, what it's doing, and Start / Stop buttons. */
export function WorkerControl() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["worker-status"],
    queryFn: () => api<Status>("/api/runner"),
    refetchInterval: (s) => (s.state.data?.status === "working" ? 4_000 : 10_000),
  });
  const control = useMutation({
    mutationFn: (action: "start" | "stop") =>
      api<{ message: string }>("/api/runner", { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: (r) => {
      toast.success(r.message);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["worker-status"] }), 2500);
    },
    onError: (e) => toast.error(e.message),
  });

  const s = q.data;
  const where = s?.beat?.kind === "cloud" ? "Cloud" : "Mac";
  const label =
    s?.status === "working"
      ? `${s.beat?.state === "uploading" ? "Uploading" : "Rendering"}${s.beat?.progress ? ` ${s.beat.progress}` : "…"}`
      : s?.status === "idle"
        ? `Running (${where}) · idle`
        : "Stopped";
  const canStart = s && s.status === "stopped" && (s.canStartLocal || s.canStartCloud);
  const canStop = s && s.status !== "stopped" && s.canStartLocal && s.beat?.kind !== "cloud";

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-violet" />
        <span className="font-medium">Worker</span>
        <span
          className={clsx(
            "ml-auto h-2 w-2 rounded-full",
            s?.status === "working" && "animate-pulse bg-warning shadow-[0_0_8px_var(--warning)]",
            s?.status === "idle" && "bg-success shadow-[0_0_8px_var(--success)]",
            (!s || s.status === "stopped") && "bg-danger/70",
          )}
        />
      </div>
      <p className="mt-1 truncate text-muted" title={s?.beat?.title}>
        {q.isLoading ? "Checking…" : label}
        {s?.status === "working" && s.beat?.title ? ` · ${s.beat.title}` : ""}
      </p>
      {!!s?.queue.total && (
        <p className="text-muted">
          {s.queue.render ? `${s.queue.render} to render` : ""}
          {s.queue.render && s.queue.upload ? " · " : ""}
          {s.queue.upload ? `${s.queue.upload} to upload` : ""}
        </p>
      )}
      {(canStart || canStop) && (
        <button
          onClick={() => control.mutate(canStop ? "stop" : "start")}
          disabled={control.isPending}
          className={clsx(
            "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
            canStop ? "border border-border hover:bg-white/5" : "bg-sunset text-bg",
          )}
        >
          {control.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : canStop ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {canStop ? "Stop worker" : s?.canStartLocal ? "Start worker" : "Start cloud worker"}
        </button>
      )}
      {s?.status === "stopped" && !s.canStartLocal && !s.canStartCloud && (
        <p className="mt-1 text-[11px] text-muted">Runs every 15 min in the cloud once set up.</p>
      )}
    </div>
  );
}
