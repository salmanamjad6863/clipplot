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

export function scheduleFor(uploadTime: string, now: number, last: { discovery: string | null; release: string | null }) {
  const dMin = discoveryMinutes(uploadTime);
  const rMin = parseHHMM(uploadTime);
  return {
    discoveryDue: isDue(dMin, last.discovery, now, DISCOVERY_CATCHUP_HOURS),
    releaseDue: isDue(rMin, last.release, now, RELEASE_CATCHUP_HOURS),
    nextDiscoveryAt: new Date(nextOccurrence(dMin, now) - (isDue(dMin, last.discovery, now, DISCOVERY_CATCHUP_HOURS) ? 24 * H : 0)).toISOString(),
    nextReleaseAt: new Date(nextOccurrence(rMin, now) - (isDue(rMin, last.release, now, RELEASE_CATCHUP_HOURS) ? 24 * H : 0)).toISOString(),
  };
}
