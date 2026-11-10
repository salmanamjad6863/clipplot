import { connection } from "next/server";
import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { GAMES_BY_SLUG } from "@/lib/games";
import type { Settings } from "@/lib/types";

export async function GET() {
  await connection();
  return handle("get settings", () => getStore().getSettings());
}

function validate(body: Partial<Settings>) {
  const errors: string[] = [];
  const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

  if (body.games) {
    const slugs = body.games.map((g) => g.slug);
    if (slugs.some((s) => !GAMES_BY_SLUG[s]) || new Set(slugs).size !== slugs.length) errors.push("Invalid games list");
    if (!body.games.some((g) => g.enabled)) errors.push("Enable at least one game");
  }
  if (body.formats) {
    for (const [name, f] of Object.entries(body.formats)) {
      if (!(f.minSec > 0 && f.minSec < f.maxSec)) errors.push(`${name}: min length must be below max`);
    }
    if (body.formats.short && body.formats.short.maxSec > 180) errors.push("Shorts can be at most 3 minutes");
    if (body.formats.short && !int(body.formats.short.perDay, 1, 6)) errors.push("Shorts per day must be 1–6");
  }
  if (body.titleSimilarity !== undefined && !(body.titleSimilarity >= 0.3 && body.titleSimilarity <= 1)) {
    errors.push("Similarity must be between 0.3 and 1");
  }
  if (body.dedupeWindowDays !== undefined && !int(body.dedupeWindowDays, 1, 90)) errors.push("Repeat window must be 1–90 days");
  if (body.lookbackHours !== undefined && !int(body.lookbackHours, 1, 168)) errors.push("Look back must be 1–168 hours");
  if (body.maxFallbackDepth !== undefined && !int(body.maxFallbackDepth, 1, 8)) errors.push("Fallback depth must be 1–8");
  if (body.minViewsPerHour !== undefined && !int(body.minViewsPerHour, 0, 10_000_000)) errors.push("Invalid min views/hour");
  if (body.youtubePrivacy !== undefined && !["private", "unlisted", "public"].includes(body.youtubePrivacy)) {
    errors.push("Visibility must be private, unlisted or public");
  }
  if (body.uploadTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.uploadTime)) errors.push("Upload time must be HH:MM");
  return errors;
}

export async function PUT(req: Request) {
  return handle("update settings", async () => {
    const body = (await req.json().catch(() => ({}))) as Partial<Settings>;
    // youtubeConnected is derived server-side, never set by the client
    delete body.youtubeConnected;
    delete body.youtubeChannelTitle;
    const errors = validate(body);
    if (errors.length) throw new HttpError(400, errors.join(". "));
    return getStore().updateSettings(body);
  });
}
