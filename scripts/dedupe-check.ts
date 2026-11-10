// Quick self-check for the dedupe rules: `node scripts/dedupe-check.ts`
import assert from "node:assert/strict";
import { checkDuplicate, extractVideoId, titleSimilarity } from "../src/lib/dedupe.ts";

const id = "dQw4w9WgXcQ";
for (const u of [
  id,
  `https://www.youtube.com/watch?v=${id}&t=10s`,
  `https://youtu.be/${id}`,
  `https://youtube.com/shorts/${id}?feature=share`,
  `https://m.youtube.com/embed/${id}`,
]) {
  assert.equal(extractVideoId(u), id, u);
}
assert.equal(extractVideoId("https://example.com/watch?v=abc"), null);

assert.ok(titleSimilarity("GTA 6 Trailer 3 — Hidden Details!!", "gta 6 trailer 3 hidden details #shorts") > 0.9);
assert.ok(titleSimilarity("GTA 6 Trailer 3 hidden details", "Minecraft redstone trick") < 0.1);

const now = Date.UTC(2026, 10, 10);
const used = [{ videoId: id, title: "GTA 6 Trailer 3 hidden details", usedAt: new Date(now - 86_400_000).toISOString() }];
const opts = { windowDays: 14, similarity: 0.6, now };

assert.deepEqual(checkDuplicate({ videoId: id, title: "anything" }, used, opts), { duplicate: true, reason: "Video already used" });
assert.equal(checkDuplicate({ videoId: "AAAAAAAAAAA", title: "GTA 6 trailer 3: hidden details 🤯" }, used, opts).duplicate, true);
assert.equal(checkDuplicate({ videoId: "AAAAAAAAAAA", title: "Vice City beach physics" }, used, opts).duplicate, false);
assert.equal(
  checkDuplicate({ videoId: "AAAAAAAAAAA", title: "anything" }, [], { ...opts, batchIds: new Set(["AAAAAAAAAAA"]) }).duplicate,
  true,
);
// Old story outside the window is allowed again
assert.equal(
  checkDuplicate({ videoId: "BBBBBBBBBBB", title: "GTA 6 trailer 3 hidden details" }, used, { ...opts, now: now + 30 * 86_400_000 }).duplicate,
  false,
);

console.log("dedupe: all checks passed");
