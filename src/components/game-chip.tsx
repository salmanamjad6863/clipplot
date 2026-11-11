"use client";

import { useTopicMap } from "@/lib/queries";

export function GameChip({ slug, fallback }: { slug: string; fallback?: boolean }) {
  const game = useTopicMap()[slug] ?? { name: slug, color: "#9a98ad" }; // deleted custom topic → show its id
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-fg/80"
      title={fallback ? "Fallback — GTA 6 had no strong trend" : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: game.color, boxShadow: `0 0 6px ${game.color}` }} />
      {game.name}
      {fallback && <span className="text-muted">· fallback</span>}
    </span>
  );
}
