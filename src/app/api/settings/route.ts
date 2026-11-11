import { connection } from "next/server";
import { currentWorkspaceId } from "@/lib/workspaces";
import { HttpError, handle } from "@/lib/api";
import { getStore } from "@/lib/data";
import { scheduleFor } from "@/lib/schedule-time";
import type { Settings } from "@/lib/types";

async function withSchedule(settings: Settings): Promise<Settings> {
  try {
    const st = await getStore(await currentWorkspaceId()).getSchedulerState();
    const sch = scheduleFor(settings.uploadTimes, Date.now(), { discovery: st.lastDiscoveryAt, release: st.lastReleaseAt });
    return {
      ...settings,
      schedule: { ...st, nextDiscoveryAt: sch.nextDiscoveryAt, nextReleaseAt: sch.nextReleaseAt, ready: true },
    };
  } catch {
    // migration 0002 not applied yet — settings still load
    return { ...settings, schedule: { lastDiscoveryAt: null, lastReleaseAt: null, nextDiscoveryAt: null, nextReleaseAt: null, ready: false } };
  }
}

export async function GET() {
  await connection();
  return handle("get settings", async () => withSchedule(await getStore(await currentWorkspaceId()).getSettings()));
}

function validate(body: Partial<Settings>) {
  const errors: string[] = [];
  const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

  if (body.games) delete body.games; // superseded by topics
  if (body.topics) {
    const t = body.topics;
    const slugs = t.map((x) => x.slug);
    if (!Array.isArray(t) || t.length < 1 || t.length > 30) errors.push("1–30 topics");
    else {
      if (new Set(slugs).size !== slugs.length || slugs.some((x) => !/^[\p{L}\p{N}-]{1,40}$/u.test(x))) errors.push("Invalid topic ids");
      if (!t.some((x) => x.enabled)) errors.push("Enable at least one topic");
      for (const x of t) {
        const where = `"${x.name || x.slug}"`;
        if (!x.name?.trim() || x.name.length > 40) errors.push(`${where}: name 1–40 characters`);
        if (!Array.isArray(x.queries) || x.queries.length < 1 || x.queries.length > 6 || x.queries.some((q) => !q.trim() || q.length > 80))
          errors.push(`${where}: 1–6 search terms`);
        if (!Array.isArray(x.keywords) || x.keywords.length > 12) errors.push(`${where}: up to 12 title keywords`);
        if (!Array.isArray(x.hashtags) || x.hashtags.length > 3 || x.hashtags.some((h) => !/^#[\p{L}\p{N}_]{1,30}$/u.test(h)))
          errors.push(`${where}: up to 3 hashtags like #GTA6`);
        if (!x.playlistTitle?.trim() || x.playlistTitle.length > 100) errors.push(`${where}: playlist name required`);
        if (!int(x.dailyShorts, 0, 6)) errors.push(`${where}: 0–6 Shorts per day`);
        if (typeof x.notes !== "string" || x.notes.length > 400) errors.push(`${where}: notes max 400 characters`);
        if (!/^#[0-9a-f]{6}$/i.test(x.color ?? "")) errors.push(`${where}: invalid color`);
      }
    }
  }
  if (body.topicMode !== undefined && !["fallback", "per_topic"].includes(body.topicMode)) errors.push("Invalid topic mode");
  if (body.channelPersona !== undefined && (typeof body.channelPersona !== "string" || body.channelPersona.length > 600))
    errors.push("Channel style max 600 characters");
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
  if (body.dedupeWindowDays !== undefined && !int(body.dedupeWindowDays, 1, 30)) errors.push("Repeat window must be 1–30 days");
  if (body.lookbackHours !== undefined && !int(body.lookbackHours, 1, 168)) errors.push("Look back must be 1–168 hours");
  if (body.maxFallbackDepth !== undefined && !int(body.maxFallbackDepth, 1, 8)) errors.push("Fallback depth must be 1–8");
  if (body.minViewsPerHour !== undefined && !int(body.minViewsPerHour, 0, 10_000_000)) errors.push("Invalid min views/hour");
  if (body.youtubePrivacy !== undefined && !["private", "unlisted", "public"].includes(body.youtubePrivacy)) {
    errors.push("Visibility must be private, unlisted or public");
  }
  if (body.render) {
    const r = body.render;
    if (r.footageMode !== undefined && !["auto", "gradient"].includes(r.footageMode)) errors.push("Footage mode must be auto or gradient");
    if (r.maxCutSec !== undefined && !int(r.maxCutSec, 0, 60)) errors.push("Max cut length must be 0–60 seconds");
    if (r.footageVolume !== undefined && !int(r.footageVolume, 0, 100)) errors.push("Footage volume must be 0–100");
    if (r.voiceRate !== undefined && !int(r.voiceRate, 120, 260)) errors.push("Voice speed must be 120–260 wpm");
    if (r.captionWords !== undefined && !int(r.captionWords, 1, 8)) errors.push("Caption words must be 1–8");
    if (r.voice !== undefined && !/^[A-Za-z][A-Za-z ()'.-]{0,40}$/.test(r.voice)) errors.push("Invalid voice name");
    if (r.brandText !== undefined && (typeof r.brandText !== "string" || r.brandText.length > 30)) errors.push("Watermark max 30 characters");
    if (r.keepFootageAudio !== undefined && typeof r.keepFootageAudio !== "boolean") errors.push("Invalid footage audio option");
  }
  if (body.uploadTimes !== undefined) {
    if (!Array.isArray(body.uploadTimes) || body.uploadTimes.length < 1 || body.uploadTimes.length > 6) {
      errors.push("1–6 upload times");
    } else if (body.uploadTimes.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) errors.push("Upload times must be HH:MM");
  }
  if (body.breakingEveryHours !== undefined && !int(body.breakingEveryHours, 1, 12)) errors.push("Breaking check every 1–12 hours");
  if (body.uploadTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.uploadTime)) errors.push("Upload time must be HH:MM");
  return errors;
}

export async function PUT(req: Request) {
  return handle("update settings", async () => {
    const body = (await req.json().catch(() => ({}))) as Partial<Settings>;
    // youtubeConnected is derived server-side, never set by the client
    delete body.youtubeConnected;
    delete body.youtubeChannelTitle;
    delete body.schedule;
    delete body.youtubeScopes;
    const errors = validate(body);
    if (errors.length) throw new HttpError(400, errors.join(". "));
    return withSchedule(await getStore(await currentWorkspaceId()).updateSettings(body));
  });
}
