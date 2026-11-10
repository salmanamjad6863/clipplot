/**
 * Duplicate protection — makes sure we never build two videos from the same source video,
 * and never repeat the same story when other channels re-upload it.
 *
 * Rules (checked in order):
 *  1. Same YouTube video ID already used (any URL form: watch, youtu.be, shorts, embed).
 *  2. Same video ID twice in today's batch.
 *  3. Title is near-identical to something used inside the dedupe window (re-uploads / same story).
 */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Extract the 11-char YouTube video ID from any common URL form, or return null. */
export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return check(url.pathname.slice(1));
    if (host.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return check(v);
      const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) return check(m[2]);
    }
  } catch {
    /* not a URL */
  }
  return null;
}

const check = (id: string) => (ID_RE.test(id) ? id : null);

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "it", "this", "that", "with",
  "you", "your", "my", "we", "new", "official", "video", "shorts", "short", "vs", "how", "why", "what",
]);

/** Lowercase, strip emojis/punctuation/hashtags, drop stop words. */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/#\w+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Jaccard similarity of two titles' token sets, 0–1. */
export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface UsedItem {
  videoId: string;
  title: string;
  usedAt: string;
}

export interface Candidate {
  videoId: string;
  title: string;
}

export type DedupeResult = { duplicate: false } | { duplicate: true; reason: string };

export function checkDuplicate(
  candidate: Candidate,
  used: UsedItem[],
  opts: { windowDays: number; similarity: number; now?: number; batchIds?: Set<string> },
): DedupeResult {
  const now = opts.now ?? Date.now();

  if (used.some((u) => u.videoId === candidate.videoId)) {
    return { duplicate: true, reason: "Video already used" };
  }
  if (opts.batchIds?.has(candidate.videoId)) {
    return { duplicate: true, reason: "Appears twice in today's results" };
  }

  const cutoff = now - opts.windowDays * 86_400_000;
  for (const u of used) {
    if (Date.parse(u.usedAt) < cutoff) continue;
    const sim = titleSimilarity(candidate.title, u.title);
    if (sim >= opts.similarity) {
      return { duplicate: true, reason: `Same story as “${u.title}” (${Math.round(sim * 100)}% match)` };
    }
  }
  return { duplicate: false };
}
