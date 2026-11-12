import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { HttpError } from "../api";
import type { Topic } from "../topics";
import type { Clip, Trend } from "../types";

/**
 * Claude "content brain": turns trend metadata (titles/stats — never the videos) into an
 * ORIGINAL commentary script + YouTube metadata, plus a policy/copyright risk score.
 */

export const MODEL = "claude-opus-5-5";

// Token-lean schema: short hints, nothing we can compute ourselves (credits/URLs are added in code)
const Segment = z.object({
  startSec: z.number(),
  voiceover: z.string().describe("Spoken line, our own words"),
  onScreenText: z.string().describe("≤4 words, a punchy claim, or empty"),
  visual: z.string().describe("Rights-safe footage: own gameplay, official trailer excerpt, or graphics"),
  emphasis: z.array(z.string()).describe("1–2 key words copied exactly from this voiceover to highlight (numbers, names, shock words)"),
  speaker: z.enum(["A", "B"]).describe("A = hype host, B = skeptical co-host. Alternate like a real conversation"),
  fx: z.enum(["none", "punch", "shake", "wait"]).describe("Edit effect on this beat: punch = quick zoom-in, shake = impact, wait = 'WAIT…' freeze moment"),
  sfx: z.enum(["none", "whoosh", "boom", "ding", "scratch", "pop"]).describe("Sound effect at the start of this beat"),
  memeText: z.string().describe("Optional meme caption at the top of the screen (≤6 words, gamer slang, no emoji) or empty"),
  receipt: z.number().describe("Seconds (0 or 3–5) of the ORIGINAL trending clip, with its own audio, played right before this line as proof the hosts react to"),
});

export const FORMATS = ["news_flash", "myth_vs_fact", "countdown", "hot_take", "versus", "would_you_rather", "reaction"] as const;

export const ScriptSchema = z.object({
  format: z.enum(FORMATS).describe("Video format — must differ from the channel's recent formats"),
  musicMood: z.enum(["hype", "mystery", "chill", "epic", "funny"]).describe("Background music mood"),
  hook: z.string().describe("The first spoken line, ≤8 words"),
  title: z.string().describe("Shorts ≤50 chars / full video ≤70; game name in the first 3 words"),
  titleAlternatives: z.array(z.string()).describe("2 other honest title angles for A/B testing"),
  description: z.string().describe("Line 1 = keyword-rich one-sentence summary; then 1–2 short lines. No hashtags"),
  tags: z.array(z.string()).describe("8–12 tags, no #"),
  thumbnailText: z.string().describe("2–4 words"),
  angle: z.string().describe("One sentence: our original value-add"),
  pinnedComment: z.string().describe("A specific question for the pinned comment that invites opinions/predictions"),
  stockQueries: z
    .array(z.string())
    .describe("4–6 short English stock-video searches (2–3 words, no brand/game names) matching the mood, e.g. 'neon city night', 'sports car drifting'"),
  segments: z.array(Segment),
  riskScore: z.number().describe("0–100, 0 = safe"),
  riskNotes: z.string().describe("One sentence"),
});

export type ScriptResult = z.infer<typeof ScriptSchema> & { sources: { title: string; channel: string; url: string }[] };

// Kept stable (no dates/ids) so it can be prompt-cached later. Rules = widely observed YouTube retention practice.
const SYSTEM = `You write scripts for a YouTube gaming channel covering the game/topic given (GTA, other big games, gaming news, viral moments). Goal: maximum watch-through, replays and comments.

Integrity
- Trend videos are inspiration. The only footage of theirs we show is 1–3 short "receipts" (3–5 s each, max ~20% of the video) that our hosts then react to — our commentary must dominate.
- You only know the titles/stats given. Present leaks/datamines as rumors. Never invent numbers, dates or quotes. No ALL CAPS, no fake "official", no clickbait the video doesn't pay off.

Shorts (9:16)
- Beat 1 is the hook, ≤8 words, spoken in under 2 seconds, over the most striking visual. Open a curiosity gap or make a bold, true claim. Never "Hey guys", "In this video", or a slow intro.
- 20–40 seconds total. Beats of 2–5 seconds; every beat adds something new (a reveal, a number, a contrast). Cut filler words.
- Save the payoff for the last third. The final line must flow naturally back into the hook so the loop replays seamlessly.
- End with a pointed question that sparks comments (an opinion or prediction), not "like and subscribe".
- onScreenText: a ≤4-word claim per beat, not a copy of the voiceover.

Full videos (16:9)
- First 15 seconds: say exactly what the viewer gets and tease the best item. Ranked countdown, best last. A re-hook roughly every 60 seconds ("but number 1 changes everything"). Close by teasing a related topic.

Make it feel human-edited, not AI
- Two hosts talk to each other: A is the hyped one, B is the skeptical, funny one. Short back-and-forth, interruptions, reactions ("Wait, what?", "Bro.", "No way."). Never a lecture.
- Pick a format (news flash, myth vs fact, countdown, hot take, versus, would-you-rather, reaction) that differs from the recent videos listed, and give the title/hook its own angle — never reuse a recent title pattern.
- Receipts: on 1–3 beats set receipt (3–5) so the original clip plays first; the next line reacts to it.
- Edit beats: fx punch/shake on the 1–3 biggest claims, "wait" at most once; sfx on ~half the beats (whoosh on transitions, boom on big claims, ding on facts, scratch for a twist, pop for jokes).
- memeText on 2–3 beats max: a funny one-liner like a meme caption ("bro really said 30 fps", "copium levels: max").

Style: spoken, short sentences, no emojis, ~2.5 words/second.
Risk score rises for: reliance on one creator's footage, leaked material, unverified claims, ad-unfriendly content.
Be concise.`;

export interface ScriptContext {
  /** One-off direction from you (Regenerate with a note) */
  note?: string;
  /** "What worked on this channel" summary */
  learnings?: string;
  topic?: Topic;
  /** Channel-wide direction (Settings → Topics → Channel style) */
  persona?: string;
  /** Recent videos on this channel ("format — title") so the new one is different */
  recent?: string[];
}

function userPrompt(clip: Clip, trends: Trend[], ctx: ScriptContext) {
  const { note, learnings, topic, persona, recent } = ctx;
  const game = topic?.name ?? clip.game;
  const kind =
    clip.format === "short"
      ? `Short, 9:16, ~${clip.durationSec}s, 5–8 beats`
      : `full video, 16:9, ~${Math.round(clip.durationSec / 60)} min, ranked breakdown with intro + outro, 10–14 beats`;
  const list = trends.map((t, i) => `${i + 1}. ${t.title} (${t.channel}, ${Math.round(t.viewsPerHour / 1000)}k views/h)`).join("\n");
  const style = [persona && `Channel style: ${persona}`, topic?.notes && `Topic notes: ${topic.notes}`].filter(Boolean).join("\n");
  const direction = (style ? `\n${style}` : "") + (note ? `\nDirection for this video (follow it within the rules): ${note}` : "");
  const learned = (learnings ? `\n\n${learnings}` : "") + (recent?.length ? `\n\nRecent videos on this channel (be different):\n${recent.join("\n")}` : "");
  return `${game} — ${kind}${clip.isFallback ? " (fallback game today)" : ""}.\nTrending titles:\n${list}${direction}${learned}`;
}

/** Typed SDK errors → short messages the dashboard can show */
export function friendlyError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new HttpError(503, "Anthropic API key is invalid — check ANTHROPIC_API_KEY");
  if (err instanceof Anthropic.PermissionDeniedError) return new HttpError(503, "Anthropic API key lacks permission for this model");
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, "Claude rate limit hit — try again in a minute");
  if (err instanceof Anthropic.BadRequestError) {
    const billing = /credit balance/i.test(err.message);
    return new HttpError(
      billing ? 402 : 400,
      billing ? "Anthropic credit balance is too low — add credits at console.anthropic.com → Billing" : `Claude rejected the request: ${err.message}`,
    );
  }
  if (err instanceof Anthropic.APIConnectionError) return new HttpError(503, "Couldn't reach the Claude API — network issue");
  if (err instanceof Anthropic.APIError) return new HttpError(502, `Claude API error ${err.status ?? ""}`.trim());
  return err instanceof Error ? err : new Error(String(err));
}

let client: Anthropic | undefined;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, "Add ANTHROPIC_API_KEY to .env.local");
  client ??= new Anthropic();
  return client;
}

export async function generateScript(clip: Clip, trends: Trend[], ctx: ScriptContext = {}): Promise<ScriptResult> {
  if (trends.length === 0) throw new HttpError(400, "Clip has no trend sources to write from");

  let res;
  try {
    res = await getClient().beta.messages.parse({
      model: MODEL,
      // only billed for what's generated; caps keep a runaway response cheap
      max_tokens: clip.format === "short" ? 6000 : 12000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a safety-classifier decline is retried on a fallback model in the same call
      output_config: { effort: "low", format: betaZodOutputFormat(ScriptSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(clip, trends, ctx) }],
    });
  } catch (err) {
    throw friendlyError(err);
  }

  if (res.stop_reason === "refusal") {
    throw new HttpError(422, `Claude declined this topic${res.stop_details?.category ? ` (${res.stop_details.category})` : ""} — skip it`);
  }
  if (res.stop_reason === "max_tokens") throw new Error("Script was cut off (max_tokens)");
  const out = res.parsed_output;
  if (!out) throw new Error("Claude returned no structured output");
  console.info(
    `[script] tokens in=${res.usage.input_tokens} out=${res.usage.output_tokens} (${clip.format}, ${trends.length} trends)`,
  );
  const sources = trends.map((t) => ({ title: t.title, channel: t.channel, url: t.url }));

  // Normalize: limits YouTube enforces, plus the game's hashtags
  const game = ctx.topic;
  return {
    ...out,
    sources,
    title: out.title.slice(0, 100),
    titleAlternatives: out.titleAlternatives.slice(0, 2).map((t) => t.slice(0, 100)),
    // keep only emphasis words that really appear in the line (the worker highlights them)
    segments: out.segments.map((seg) => ({
      ...seg,
      receipt: seg.receipt >= 2 ? Math.min(6, Math.round(seg.receipt)) : 0,
      memeText: seg.memeText.replace(/[^\p{L}\p{N}\s'!?.,:%#-]/gu, "").trim().slice(0, 40),
      emphasis: seg.emphasis.filter((w) => seg.voiceover.toLowerCase().includes(w.toLowerCase())).slice(0, 2),
    })),
    tags: [...new Set(out.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean))].slice(0, 12),
    riskScore: Math.max(0, Math.min(100, Math.round(out.riskScore))),
    description: [
      out.description.trim(),
      "",
      `Inspired by: ${sources.map((s) => `${s.channel} (${s.url})`).join(", ")}`,
      game ? game.hashtags.slice(0, 3).join(" ") : "",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n")
      .trim(),
  };
}
