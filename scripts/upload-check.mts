// Tests the worker's resumable YouTube upload against a local fake server: `pnpm test:upload`
// Simulates: session start, 8 MB chunks with 308 responses, one 503 mid-upload (must resume), final 200.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const SIZE = 20 * 1024 * 1024 + 12345; // 3 chunks
let received = 0;
let failedOnce = false;
let probes = 0;
let meta: { snippet?: { title?: string } } = {};
let auth = "";
let port = 0;

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.method === "POST") {
      auth = req.headers.authorization ?? "";
      meta = JSON.parse(body.toString());
      assert.equal(req.headers["x-upload-content-length"], String(SIZE));
      res.writeHead(200, { Location: `http://127.0.0.1:${port}/session/abc` }).end();
      return;
    }
    const range = String(req.headers["content-range"] ?? "");
    if (range.startsWith("bytes */")) {
      probes++;
      res.writeHead(308, received ? { Range: `bytes=0-${received - 1}` } : {}).end();
      return;
    }
    const start = Number(range.match(/bytes (\d+)-/)?.[1]);
    assert.equal(start, received, "chunk must start where the server left off");
    if (!failedOnce && received > 0) {
      failedOnce = true; // drop the 2nd chunk
      res.writeHead(503).end();
      return;
    }
    received += body.length;
    if (received >= SIZE) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "dQw4w9WgXcQ" }));
    } else {
      res.writeHead(308, { Range: `bytes=0-${received - 1}` }).end();
    }
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
port = (server.address() as { port: number }).port;
process.env.WORKER_YT_UPLOAD_URL = `http://127.0.0.1:${port}/upload`;

const { uploadToYouTube } = await import("../worker/youtube.mts");
const dir = await mkdtemp(path.join(os.tmpdir(), "cp-up-"));
const file = path.join(dir, "v.mp4");
await writeFile(file, randomBytes(SIZE));

const logs: string[] = [];
const id = await uploadToYouTube(file, { snippet: { title: "Test" }, status: { privacyStatus: "private" } }, "tok123", (m) =>
  logs.push(m),
);
server.close();
await rm(dir, { recursive: true, force: true });

assert.equal(id, "dQw4w9WgXcQ");
assert.equal(received, SIZE, "every byte delivered exactly once");
assert.ok(failedOnce, "the 503 was exercised");
assert.equal(probes, 1, "resumed by asking the server for its offset");
assert.equal(auth, "Bearer tok123");
assert.equal(meta.snippet?.title, "Test");
console.log(`upload: all checks passed (resumed after a 503; ${logs.join(" | ")})`);
