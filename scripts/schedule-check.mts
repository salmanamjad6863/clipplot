// Self-check for the daily schedule math: `pnpm test:schedule`
import assert from "node:assert/strict";
import { discoveryMinutes, isDue, lastOccurrence, scheduleFor } from "../src/lib/schedule-time.ts";

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
void H;

console.log("schedule: all checks passed");
