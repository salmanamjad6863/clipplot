"use client";

import { GAMES } from "@/lib/games";
import type { VideoFormat } from "@/lib/types";
import { Segmented } from "./ui";

export type FormatFilter = VideoFormat | "all";

export function FilterBar({
  game,
  onGame,
  format,
  onFormat,
  id,
}: {
  game: string;
  onGame: (v: string) => void;
  format: FormatFilter;
  onFormat: (v: FormatFilter) => void;
  id: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        id={`${id}-format`}
        value={format}
        onChange={onFormat}
        options={[
          { value: "all", label: "All" },
          { value: "short", label: "Shorts" },
          { value: "long", label: "Full videos" },
        ]}
      />
      <select
        value={game}
        onChange={(e) => onGame(e.target.value)}
        aria-label="Filter by game"
        className="glass cursor-pointer rounded-full px-3 py-2 text-xs text-fg outline-none"
      >
        <option value="all" className="bg-bg-elev">All games</option>
        {GAMES.map((g) => (
          <option key={g.slug} value={g.slug} className="bg-bg-elev">
            {g.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function applyFilters<T extends { game: string; format?: VideoFormat }>(items: T[], game: string, format: FormatFilter) {
  return items.filter((i) => (game === "all" || i.game === game) && (format === "all" || i.format === format));
}
