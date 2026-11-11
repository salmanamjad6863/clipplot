"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { ConfirmDialog } from "./confirm-dialog";
import { ease, inputCls } from "./ui";
import { useCreateWorkspace, useSwitchWorkspace, useWorkspaces } from "@/lib/queries";

const dot = (connected: boolean) =>
  clsx("h-2 w-2 shrink-0 rounded-full", connected ? "bg-success shadow-[0_0_6px_var(--success)]" : "bg-white/20");

/** Sidebar workspace picker — one workspace per YouTube channel. */
export function WorkspaceSwitcher({ compact }: { compact?: boolean }) {
  const { data } = useWorkspaces();
  const switchTo = useSwitchWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = data?.workspaces.find((w) => w.id === data.currentId);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "flex w-full items-center gap-2.5 rounded-xl border border-border bg-white/[0.03] text-left transition hover:bg-white/[0.06]",
          compact ? "px-2.5 py-1.5" : "px-3 py-2.5",
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sunset font-display text-xs font-bold text-bg">
          {(current?.name ?? "…").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{current?.name ?? "Loading…"}</span>
          {!compact && (
            <span className="flex items-center gap-1.5 truncate text-[11px] text-muted">
              <span className={dot(Boolean(current?.youtubeConnected))} />
              {current?.youtubeConnected ? current.channelTitle : "No channel connected"}
            </span>
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" />
      </button>

      <AnimatePresence>
        {open && data && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease }}
            className="absolute left-0 right-0 top-full z-40 mt-2 min-w-56 overflow-hidden rounded-xl border border-border bg-bg-elev/95 p-1 shadow-2xl backdrop-blur-xl"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted">Workspaces · one per channel</p>
            {data.workspaces.map((w) => (
              <button
                key={w.id}
                role="option"
                aria-selected={w.id === data.currentId}
                onClick={() => {
                  setOpen(false);
                  if (w.id !== data.currentId) switchTo.mutate(w.id);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]"
              >
                <span className={dot(w.youtubeConnected)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{w.name}</span>
                  <span className="block truncate text-[11px] text-muted">{w.youtubeConnected ? w.channelTitle : "Not connected"}</span>
                </span>
                {w.id === data.currentId && <Check className="h-4 w-4 shrink-0 text-coral" />}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg/90 transition hover:bg-white/[0.06]"
            >
              <Plus className="h-4 w-4 text-coral" /> New workspace
            </button>
            <Link
              href="/settings#workspace"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted transition hover:bg-white/[0.06] hover:text-fg"
            >
              <Settings2 className="h-4 w-4" /> Manage workspace
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} currentName={current?.name} />
    </div>
  );
}

function CreateWorkspaceDialog({ open, onClose, currentName }: { open: boolean; onClose: () => void; currentName?: string }) {
  const create = useCreateWorkspace();
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(true);
  const close = useCallback(() => {
    setName("");
    onClose();
  }, [onClose]);

  const submit = () => {
    if (!name.trim()) return;
    create.mutate({ name: name.trim(), copySettings: copy }, { onSuccess: close });
  };

  return (
    <ConfirmDialog
      open={open}
      title="New workspace"
      confirmLabel={create.isPending ? "Creating…" : "Create workspace"}
      busy={create.isPending || !name.trim()}
      onConfirm={submit}
      onCancel={close}
    >
      <p>Each workspace runs its own YouTube channel: its own games, schedule, video style, clips and playlists.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        maxLength={40}
        placeholder="e.g. GTA Clips Daily"
        aria-label="Workspace name"
        className={`${inputCls} mt-2`}
      />
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-fg/90">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="accent-[var(--coral)]" />
        Copy settings from {currentName ? `"${currentName}"` : "the current workspace"}
      </label>
      <p className="text-[11px]">After creating, connect its channel in Settings → Connect YouTube and pick that channel in Google&apos;s account list.</p>
    </ConfirmDialog>
  );
}
