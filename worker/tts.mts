import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDuration, run } from "./proc.mts";

/**
 * Free local text-to-speech using macOS `say`.
 * Voice + speed come from Settings → Video & copyright (fallback: WORKER_VOICE / WORKER_VOICE_RATE env).
 * Run `say -v '?'` to list installed voices; Premium/Enhanced voices sound best.
 */
const VOICE = process.env.WORKER_VOICE || "Samantha";
const RATE = process.env.WORKER_VOICE_RATE || "185"; // words per minute

export async function speak(
  text: string,
  dir: string,
  name: string,
  opts: { voice?: string; rate?: number } = {},
): Promise<{ file: string; duration: number }> {
  const txt = path.join(dir, `${name}.txt`);
  const aiff = path.join(dir, `${name}.aiff`);
  const wav = path.join(dir, `${name}.wav`);
  await writeFile(txt, text); // via file, so text starting with "-" isn't read as a flag
  const rate = String(opts.rate || RATE);
  try {
    await run("say", ["-v", opts.voice || VOICE, "-r", rate, "-f", txt, "-o", aiff]);
  } catch (err) {
    // voice picked in Settings isn't installed on this Mac → fall back instead of failing the render
    if (!opts.voice || opts.voice === "Samantha") throw err;
    console.warn(`voice "${opts.voice}" not available — using Samantha (install it in System Settings → Accessibility → Spoken Content)`);
    await run("say", ["-v", "Samantha", "-r", rate, "-f", txt, "-o", aiff]);
  }
  await ffmpeg(["-i", aiff, "-ar", "48000", "-ac", "1", wav]);
  return { file: wav, duration: await probeDuration(wav) };
}
