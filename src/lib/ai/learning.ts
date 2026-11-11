import type { Clip } from "../types";

/**
 * "What worked on THIS channel" — a few lines added to Claude's prompt so new scripts lean toward
 * the games, angles and hooks that performed, and away from what flopped. Pure (tested).
 *
 * Performance = views per day since publishing (first 14 days), lifted by retention when known.
 * Needs at least 4 videos that are ≥ 24h old, otherwise returns "" (not enough signal yet).
 */
export function buildLearnings(clips: Clip[], now = Date.now(), format?: Clip["format"]): string {
  const rated = clips
    .filter((c) => c.status === "published" && c.views !== undefined && c.publishedAt && (!format || c.format === format))
    .map((c) => {
      const days = Math.min(14, (now - Date.parse(c.publishedAt!)) / 86_400_000);
      return { c, days, perDay: c.views! / Math.max(1, days) };
    })
    .filter((x) => x.days >= 1);
  if (rated.length < 4) return "";

  // retention matters most for Shorts distribution: 1.0× at 50% watched, up to ~1.5× at 100%+
  const score = (x: (typeof rated)[number]) => x.perDay * (x.c.avgViewPct ? Math.min(1.5, Math.max(0.5, x.c.avgViewPct / 66)) : 1);
  rated.sort((a, b) => score(b) - score(a));
  const line = (x: (typeof rated)[number]) =>
    `- [${x.c.game}] "${x.c.title}" — hook "${x.c.hook}" — ${Math.round(x.perDay).toLocaleString("en")} views/day` +
    (x.c.avgViewPct ? `, ${x.c.avgViewPct}% watched` : "");

  const top = rated.slice(0, 3);
  const bottom = rated.slice(-2).filter((x) => !top.includes(x));
  return [
    "This channel's recent results (learn the pattern; never copy titles):",
    "Worked best:",
    ...top.map(line),
    ...(bottom.length ? ["Underperformed:", ...bottom.map(line)] : []),
  ].join("\n");
}
