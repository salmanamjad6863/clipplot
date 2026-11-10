import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { HttpError } from "../api";
import { GAMES_BY_SLUG } from "../games";
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
  onScreenText: z.string().describe("≤6 words or empty"),
  visual: z.string().describe("Rights-safe footage: own gameplay, official trailer excerpt, or graphics"),
});

export const ScriptSchema = z.object({
  hook: z.string().describe("≤12 words"),
  title: z.string().describe("≤70 chars, includes game name"),
  description: z.string().describe("2–3 short lines, no hashtags"),
  tags: z.array(z.string()).describe("8–12 tags, no #"),
  thumbnailText: z.string().describe("2–4 words"),
  angle: z.string().describe("One sentence: our original value-add"),
  segments: z.array(Segment),
  riskScore: z.number().describe("0–100, 0 = safe"),
  riskNotes: z.string().describe("One sentence"),
});

export type ScriptResult = z.infer<typeof ScriptSchema> & { sources: { title: string; channel: string; url: string }[] };

const SYSTEM = `You write scripts for a YouTube gaming channel (mainly GTA 6). Rules:
- Trend videos are inspiration only. We never reuse other creators' footage; we add our own commentary over our gameplay, short official trailer excerpts, or graphics.
- You only know the titles/stats given. Present leaks and datamines as rumors. Never invent numbers, dates or quotes.
- Curiosity without lies: no ALL CAPS, no fake "official".
- Spoken style, short sentences, no emojis. ~2.5 words per second.
- Risk score rises for: reliance on one creator's footage, leaked material, unverified claims, ad-unfriendly content.
Be concise.`;

function userPrompt(clip: Clip, trends: Trend[]) {
  const game = GAMES_BY_SLUG[clip.game]?.name ?? clip.game;
  const kind =
    clip.format === "short"
      ? `Short, 9:16, ~${clip.durationSec}s, 5–8 beats`
      : `full video, 16:9, ~${Math.round(clip.durationSec / 60)} min, ranked breakdown with intro + outro, 10–14 beats`;
  const list = trends.map((t, i) => `${i + 1}. ${t.title} (${t.channel}, ${Math.round(t.viewsPerHour / 1000)}k views/h)`).join("\n");
  return `${game} — ${kind}${clip.isFallback ? " (fallback game today)" : ""}.\nTrending titles:\n${list}`;
}

/** Typed SDK errors → short messages the dashboard can show */
function friendlyError(err: unknown): Error {
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
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, "Add ANTHROPIC_API_KEY to .env.local");
  client ??= new Anthropic();
  return client;
}

export async function generateScript(clip: Clip, trends: Trend[]): Promise<ScriptResult> {
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
      messages: [{ role: "user", content: userPrompt(clip, trends) }],
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
  const game = GAMES_BY_SLUG[clip.game];
  return {
    ...out,
    sources,
    title: out.title.slice(0, 100),
    tags: [...new Set(out.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean))].slice(0, 12),
    riskScore: Math.max(0, Math.min(100, Math.round(out.riskScore))),
    description: [
      out.description.trim(),
      "",
      `Inspired by: ${sources.map((s) => `${s.channel} (${s.url})`).join(", ")}`,
      game ? game.hashtags.join(" ") : "",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n")
      .trim(),
  };
}
