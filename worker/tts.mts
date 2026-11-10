import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDuration, run } from "./proc.mts";

/**
 * Free local text-to-speech using macOS `say`.
 * Voice is configurable with WORKER_VOICE (run `say -v '?'` to list; Premium/Enhanced voices sound best).
 */
const VOICE = process.env.WORKER_VOICE || "Samantha";
const RATE = process.env.WORKER_VOICE_RATE || "185"; // words per minute

export async function speak(text: string, dir: string, name: string): Promise<{ file: string; duration: number }> {
  const txt = path.join(dir, `${name}.txt`);
  const aiff = path.join(dir, `${name}.aiff`);
  const wav = path.join(dir, `${name}.wav`);
  await writeFile(txt, text); // via file, so text starting with "-" isn't read as a flag
  await run("say", ["-v", VOICE, "-r", RATE, "-f", txt, "-o", aiff]);
  await ffmpeg(["-i", aiff, "-ar", "48000", "-ac", "1", wav]);
  return { file: wav, duration: await probeDuration(wav) };
}
