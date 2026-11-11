// Self-check for the daily schedule math: `pnpm test:schedule`
import assert from "node:assert/strict";
import { discoveryMinutes, isDue, lastOccurrence, scheduleFor, windowStart } from "../src/lib/schedule-time.ts";

const at = (iso: string) => Date.parse(iso);
const H = 3_600_000;

// discovery = upload − 4h, wrapping past midnight
assert.equal(discoveryMinutes("16:00"), 12 * 60);
assert.equal(discoveryMinutes("02:30"), 22 * 60 + 30);

// last occurrence today vs yesterday
assert.equal(lastOccurrence(16 * 60, at("2026-11-10T17:00:00Z")), at("2026-11-10T16:00:00Z"));
assert.equal(lastOccurrence(16 * 60, at("2026-11-10T15:00:00Z")), at("2026-11-09T16:00:00Z"));

// release at 16:00: due at 16:01 if not run, not due again after running
const t = at("2026-11-10T16:01:00Z");
assert.equal(isDue(960, null, t, 6), at("2026-11-10T16:00:00Z"));
assert.equal(isDue(960, "2026-11-10T16:00:30Z", t, 6), null);
// yesterday's run doesn't count for today
assert.equal(isDue(960, "2026-11-09T16:00:30Z", t, 6), at("2026-11-10T16:00:00Z"));
// outside catch-up window (opened app at 23:00) → wait for tomorrow
assert.equal(isDue(960, null, at("2026-11-10T23:00:00Z"), 6), null);
// before today's slot: yesterday's slot is > 6h old → nothing due
assert.equal(isDue(960, null, at("2026-11-10T15:59:00Z"), 6), null);

// full schedule
const s = scheduleFor("16:00", at("2026-11-10T12:05:00Z"), { discovery: null, release: null });
assert.equal(s.discoveryDue, at("2026-11-10T12:00:00Z"), "discovery due at 12:00");
assert.equal(s.releaseDue, null);
assert.equal(s.nextReleaseAt, "2026-11-10T16:00:00.000Z");
const s2 = scheduleFor("16:00", at("2026-11-10T12:05:00Z"), { discovery: "2026-11-10T12:01:00Z", release: null });
assert.equal(s2.discoveryDue, null);
assert.equal(s2.nextDiscoveryAt, "2026-11-11T12:00:00.000Z");
// several slots: 09:00, 13:00, 18:00 → discovery 05:00; at 13:05 the 13:00 slot (index 1) is due
{
  const times = ["13:00", "09:00", "18:00"];
  const m = scheduleFor(times, at("2026-11-10T13:05:00Z"), { discovery: "2026-11-10T05:00:00Z", release: "2026-11-10T09:00:10Z" });
  assert.equal(m.discoveryDue, null);
  assert.equal(m.releaseDue, at("2026-11-10T13:00:00Z"));
  assert.equal(m.releaseSlotIndex, 1);
  assert.equal(m.slotsPerDay, 3);
  // already released 13:00 → next is 18:00
  const m2 = scheduleFor(times, at("2026-11-10T13:05:00Z"), { discovery: null, release: "2026-11-10T13:00:30Z" });
  assert.equal(m2.releaseDue, null);
  assert.equal(m2.nextReleaseAt, "2026-11-10T18:00:00.000Z");
  // missed 13:00 entirely; at 17:50 it's too close to 18:00 → don't double-release, wait for 18:00
  const m3 = scheduleFor(times, at("2026-11-10T17:50:00Z"), { discovery: null, release: "2026-11-10T09:00:10Z" });
  assert.equal(m3.releaseDue, null);
  // first slot of the day → index 0 (full video goes out here)
  const m4 = scheduleFor(times, at("2026-11-10T09:01:00Z"), { discovery: null, release: "2026-11-09T18:00:10Z" });
  assert.equal(m4.releaseSlotIndex, 0);
  assert.equal(discoveryMinutes("09:00"), 5 * 60);
}
assert.equal(windowStart(at("2026-11-10T13:59:00Z"), 3), at("2026-11-10T12:00:00Z"));
void H;

console.log("schedule: all checks passed");
