import "server-only";
import { getStore } from "../data";
import type { Clip } from "../types";
import { buildLearnings } from "./learning";
import { MODEL, generateScript } from "./script";

/** Writes the script for one already-claimed clip (status = scripting). */
export async function scriptClip(clip: Clip, note?: string): Promise<Clip | null> {
  const store = getStore(clip.workspaceId);
  if (clip.script?.style === "edit") {
    // pure edit: no voiceover script — the worker reads the video's transcript and asks Claude for the best
    // moments at render time (it has the video; this server doesn't)
    const trends = await store.getTrendsByIds(clip.trendIds);
    return store.saveScript(clip.id, {
      hook: "",
      title: clip.title,
      description: "",
      tags: [],
      riskScore: 50,
      script: {
        style: "edit",
        angle: "Pure edit of the original video",
        riskNotes: "Uses the original creator's footage and audio — may get Content ID claims",
        thumbnailText: "",
        segments: [],
        sources: trends.map((t) => ({ title: t.title, channel: t.channel, url: t.url })),
        model: "none",
        generatedAt: new Date().toISOString(),
      },
    });
  }
  try {
    const [trends, all, settings] = await Promise.all([store.getTrendsByIds(clip.trendIds), store.listClips(), store.getSettings()]);
    const r = await generateScript(clip, trends, {
      note,
      // feed this channel's own results back in (empty until there are ≥4 videos with stats)
      learnings: buildLearnings(all, Date.now(), clip.format),
      topic: settings.topics.find((t) => t.slug === clip.game),
      persona: settings.channelPersona || undefined,
      // last 30 videos so Claude rotates format + angle instead of repeating itself
      recent: all
        .filter((c) => c.id !== clip.id && c.script)
        .slice(0, 30)
        .map((c) => `${c.script?.format ?? "?"} — ${c.title}`),
    });
    const saved = await store.saveScript(clip.id, {
      hook: r.hook,
      title: r.title,
      description: r.description,
      tags: r.tags,
      riskScore: r.riskScore,
      script: {
        voice: clip.script?.voice, // keep a per-clip voice choice across rewrites
        angle: r.angle,
        thumbnailText: r.thumbnailText,
        segments: r.segments,
        sources: r.sources,
        riskNotes: r.riskNotes,
        pinnedComment: r.pinnedComment,
        stockQueries: r.stockQueries?.slice(0, 6),
        format: r.format,
        musicMood: r.musicMood,
        titleAlternatives: r.titleAlternatives,
        model: MODEL,
        generatedAt: new Date().toISOString(),
      },
    });
    console.info(`[script] ${clip.id} ✓ "${r.title}" risk=${r.riskScore}`);
    return saved;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[script] ${clip.id} failed:`, msg);
    await store.failScript(clip.id, `Script: ${msg}`);
    throw err;
  }
}

/** Scripts clips waiting in `discovered` one at a time (gentle on free-tier rate limits). */
export async function scriptPending(ws: string, limit = 3) {
  const clips = await getStore(ws).claimForScripting(limit);
  let ok = 0;
  for (const c of clips) {
    try {
      await scriptClip(c);
      ok++;
    } catch {
      /* already logged + marked failed */
    }
  }
  if (clips.length) console.info(`[script] batch done: ${ok}/${clips.length} scripted`);
  return { claimed: clips.length, scripted: ok };
}
