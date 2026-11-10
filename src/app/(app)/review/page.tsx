"use client";

import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { ReviewCard } from "@/components/clip-card";
import { FilterBar, applyFilters, type FormatFilter } from "@/components/filter-bar";
import { EmptyState, PageHeader, SkeletonGrid } from "@/components/ui";
import { useClips } from "@/lib/queries";

export default function ReviewQueue() {
  const { data, isLoading } = useClips();
  const [game, setGame] = useState("all");
  const [format, setFormat] = useState<FormatFilter>("all");
  const queue = applyFilters(data ?? [], game, format)
    .filter((c) => c.status === "awaiting_approval")
    .sort((a, b) => b.viralScore - a.viralScore);

  return (
    <>
      <PageHeader title="Review" accent="queue" />
      <p className="mt-2 text-sm text-muted">Nothing goes to YouTube until you approve it. Highest viral score first.</p>
      <div className="mt-6">
        <FilterBar id="review" game={game} onGame={setGame} format={format} onFormat={setFormat} />
      </div>
      <div className="mt-6">
        {isLoading ? (
          <SkeletonGrid count={4} />
        ) : queue.length === 0 ? (
          <EmptyState title="All caught up" body="You've reviewed everything for now." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {queue.map((c, i) => (
                <ReviewCard key={c.id} clip={c} i={i} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );
}
