import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { HttpError } from "../api";
import type { Topic } from "../topics";
import type { Clip, EditMoment } from "../types";
import { MODEL, friendlyError, getClient } from "./script";

/** A pure edit: the best moments of the original video (its own voice/audio) + our overlays. No voiceover. */
const Moment = z.object({
  start: z.number().describe("Start second in the original video"),
  end: z.number().describe("End second; 3–12 s after start, cut at a sentence boundary"),
  caption: z.string().describe("≤6-word context text over this moment, or empty"),
  memeText: z.string().describe("Optional funny meme caption (≤6 words, no emoji) or empty"),
  fx: z.enum(["none", "punch", "shake", "wait"]),
  sfx: z.enum(["none", "whoosh", "boom", "ding", "scratch", "pop"]),
});

const EditSchema = z.object({
  title: z.string().describe("Shorts title ≤60 chars, game name early, honest"),
  description: z.string().describe("1–2 short lines; credit the original creator by name. No hashtags"),
  tags: z.array(z.string()).describe("8–12 tags, no #"),
  hookText: z.string().describe("≤5-word text shown at the top the whole time, a curiosity hook"),
  musicMood: z.enum(["hype", "mystery", "chill", "epic", "funny"]),
  pinnedComment: z.string().describe("A specific question that invites opinions"),
  moments: z.array(Moment).describe("3–5 moments, best/most surprising first, total 20–45 s"),
});

const SYSTEM = `You are a short-form video editor for a gaming channel. You get the transcript of a trending video (timestamps in seconds) and pick the moments that make the best YouTube Short — no voiceover, the original speaker's own words.

- Open with the most surprising/funny/hype line (a hook in the first 2 seconds). Then 2–4 more moments that build or pay off. Total 20–45 s.
- Each moment must make sense on its own: start at the beginning of a sentence, end after it finishes. Never cut mid-word.
- Prefer reactions, reveals, numbers, strong opinions, funny lines. Skip intros, sponsor reads, "like and subscribe".
- Overlays are light: caption only when context is needed; memeText on 1–2 moments max; fx punch/shake on the biggest line; sfx whoosh between moments, boom on a reveal.
- If no transcript is given, pick moments spread across the video (early hook, middle, near the end), 5–8 s each.
- Title: honest, no fake "official", game name early. Credit the creator in the description.`;

export interface EditPlan {
  title: string;
  description: string;
  tags: string[];
  hookText: string;
  musicMood: "hype" | "mystery" | "chill" | "epic" | "funny";
  pinnedComment: string;
  moments: EditMoment[];
}

export async function generateEditPlan(
  clip: Clip,
  source: { title: string; channel: string },
  transcript: { start: number; text: string }[],
  durationSec: number,
  topic?: Topic,
): Promise<EditPlan> {
  // ~1 line per cue, capped so a long video stays cheap
  const lines = transcript.slice(0, 900).map((c) => `[${c.start.toFixed(1)}] ${c.text}`).join("\n");
  const user = `${topic?.name ?? clip.game} — pure-edit Short (9:16).
Original: "${source.title}" by ${source.channel}, ${Math.round(durationSec)} s long${transcript.length ? "" : " (no transcript available)"}.
${lines ? `Transcript:\n${lines}` : ""}`;

  let res;
  try {
    res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(EditSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
  } catch (err) {
    throw friendlyError(err);
  }
  if (res.stop_reason === "refusal") throw new HttpError(422, "Claude declined this video — skip it");
  const out = res.parsed_output;
  if (!out) throw new Error("Claude returned no edit plan");
  console.info(`[edit] tokens in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);

  // clamp to the real video and sane lengths
  const moments = out.moments
    .map((m) => {
      const start = Math.max(0, Math.min(m.start, durationSec - 2));
      const end = Math.min(durationSec, Math.max(start + 2, Math.min(m.end, start + 14)));
      return { ...m, start, end, memeText: m.memeText.replace(/[^\p{L}\p{N}\s'!?.,:%#-]/gu, "").trim().slice(0, 40) };
    })
    .filter((m) => m.end - m.start >= 2)
    .slice(0, 6);
  if (!moments.length) throw new Error("Edit plan had no usable moments");
  return {
    title: out.title.slice(0, 100),
    description: out.description,
    tags: out.tags.slice(0, 15),
    hookText: out.hookText.slice(0, 40),
    musicMood: out.musicMood,
    pinnedComment: out.pinnedComment,
    moments,
  };
}
