import "server-only";

/**
 * Wakes the cloud worker (GitHub Actions workflow .github/workflows/worker.yml) as soon as a render or
 * upload job is queued, instead of waiting for its 15-minute schedule. No-op unless GITHUB_DISPATCH_TOKEN
 * and GITHUB_REPO are set. GitHub's concurrency group keeps it to one running + one queued run.
 */
let last = 0;
export const cloudWorkerConfigured = () => Boolean(process.env.GITHUB_DISPATCH_TOKEN && process.env.GITHUB_REPO);

export async function kickWorker(reason: string, force = false): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return false;
  if (!force && Date.now() - last < 20_000) return true; // a burst of jobs → one dispatch
  last = Date.now();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/worker.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "clippilot",
      },
      body: JSON.stringify({ ref: process.env.GITHUB_BRANCH || "main" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[worker] cloud kick failed (${res.status}) — check GITHUB_DISPATCH_TOKEN / GITHUB_REPO`);
      return false;
    }
    console.info(`[worker] cloud worker started (${reason})`);
    return true;
  } catch (err) {
    console.warn(`[worker] cloud kick error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
