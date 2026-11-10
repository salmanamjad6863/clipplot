import "server-only";
import { getStore } from "../data";
import type { Clip } from "../types";
import { MODEL, generateScript } from "./script";

/** Writes the script for one already-claimed clip (status = scripting). */
export async function scriptClip(clip: Clip): Promise<Clip | null> {
  const store = getStore();
  try {
    const trends = await store.getTrendsByIds(clip.trendIds);
    const r = await generateScript(clip, trends);
    const saved = await store.saveScript(clip.id, {
      hook: r.hook,
      title: r.title,
      description: r.description,
      tags: r.tags,
      riskScore: r.riskScore,
      script: {
        angle: r.angle,
        thumbnailText: r.thumbnailText,
        segments: r.segments,
        sources: r.sources,
        riskNotes: r.riskNotes,
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
export async function scriptPending(limit = 3) {
  const clips = await getStore().claimForScripting(limit);
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
