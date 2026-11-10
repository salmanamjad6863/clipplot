import { spawn } from "node:child_process";

/** Run a command (no shell — args are passed verbatim, so text can't inject anything). */
export function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error(`${cmd} not found or failed to start: ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) return resolve(out);
      const tail = err.trim().split("\n").slice(-6).join("\n");
      reject(new Error(`${cmd} exited ${code}${opts.quiet ? "" : `:\n${tail}`}`));
    });
  });
}

export const ffmpeg = (args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

export async function probeDuration(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = Number(out.trim());
  if (!Number.isFinite(d)) throw new Error(`Couldn't read duration of ${file}`);
  return d;
}
