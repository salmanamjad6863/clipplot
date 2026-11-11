/**
 * Daily schedule math — pure, UTC, no I/O (tested in scripts/schedule-check.mts).
 *
 *   discovery  = uploadTime − DISCOVERY_LEAD_HOURS   (scripts + renders are ready well before the slot)
 *   release    = uploadTime                          (approved clips go to YouTube, autopilot only)
 *
 * A job is "due" when its most recent occurrence has passed, it hasn't run since, and we're still
 * inside the catch-up window (so turning the app on at night doesn't fire this morning's slot).
 */
export const DISCOVERY_LEAD_HOURS = 4;
export const DISCOVERY_CATCHUP_HOURS = 12;
export const RELEASE_CATCHUP_HOURS = 6;

const H = 3_600_000;

export function parseHHMM(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Bad time "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Most recent moment (≤ now) at `minutesOfDay` UTC */
export function lastOccurrence(minutesOfDay: number, now: number): number {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + minutesOfDay * 60_000;
  return today <= now ? today : today - 24 * H;
}

export function nextOccurrence(minutesOfDay: number, now: number): number {
  return lastOccurrence(minutesOfDay, now) + 24 * H;
}

export function discoveryMinutes(uploadTime: string): number {
  return (((parseHHMM(uploadTime) - DISCOVERY_LEAD_HOURS * 60) % 1440) + 1440) % 1440;
}

export function isDue(minutesOfDay: number, lastRunIso: string | null, now: number, catchupHours: number): number | null {
  const occ = lastOccurrence(minutesOfDay, now);
  if (now - occ > catchupHours * H) return null; // too late for today's slot
  if (lastRunIso && Date.parse(lastRunIso) >= occ) return null; // already ran for this slot
  return occ;
}

/**
 * Daily plan for one workspace. Several upload slots are allowed: discovery runs before the FIRST slot;
 * a release is due when the most recent slot has passed and hasn't been released yet.
 */
export function scheduleFor(
  uploadTimes: string | string[],
  now: number,
  last: { discovery: string | null; release: string | null },
) {
  const times = (Array.isArray(uploadTimes) ? uploadTimes : [uploadTimes]).map(parseHHMM).sort((a, b) => a - b);
  const first = times[0];
  const dMin = (((first - DISCOVERY_LEAD_HOURS * 60) % 1440) + 1440) % 1440;

  // most recent slot occurrence across all times
  const occ = Math.max(...times.map((t) => lastOccurrence(t, now)));
  const slotMin = times.find((t) => lastOccurrence(t, now) === occ)!;
  // with several slots, a missed one only catches up until the next slot is near
  const gapMin = times.length > 1 ? Math.min(...times.map((t) => ((t - slotMin + 1440) % 1440) || 1440)) : 1440;
  const catchup = Math.min(RELEASE_CATCHUP_HOURS, gapMin / 60 - 0.25);
  const releaseDue = now - occ <= catchup * H && !(last.release && Date.parse(last.release) >= occ) ? occ : null;

  const discoveryDue = isDue(dMin, last.discovery, now, DISCOVERY_CATCHUP_HOURS);
  const nextRelease = releaseDue ?? Math.min(...times.map((t) => nextOccurrence(t, now)).filter((x) => x > now), ...times.map((t) => lastOccurrence(t, now) + 24 * H));
  return {
    discoveryDue,
    releaseDue,
    /** Which slot of the day is due (0 = first) — the full video goes out at the first slot */
    releaseSlotIndex: releaseDue !== null ? times.indexOf(slotMin) : null,
    slotsPerDay: times.length,
    nextDiscoveryAt: new Date(nextOccurrence(dMin, now) - (discoveryDue ? 24 * H : 0)).toISOString(),
    nextReleaseAt: new Date(nextRelease).toISOString(),
  };
}

/** Start of the current N-hour window (UTC) — used for breaking-news checks and stats refreshes */
export function windowStart(now: number, everyHours: number): number {
  const ms = Math.max(1, everyHours) * H;
  return Math.floor(now / ms) * ms;
}
