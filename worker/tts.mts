import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDuration, run } from "./proc.mts";

/**
 * Free local text-to-speech.
 * - "kokoro:<voice>" → Kokoro-82M neural voice (natural, human-like), runs on this Mac's CPU.
 * - anything else → macOS `say` voice (robotic fallback).
 * Voice + speed come from Settings → Video & copyright (fallback: WORKER_VOICE / WORKER_VOICE_RATE env).
 */
const VOICE = process.env.WORKER_VOICE || "kokoro:am_michael";
const RATE = process.env.WORKER_VOICE_RATE || "185"; // words per minute
const KOKORO_BASE_WPM = 170; // Kokoro speaks ~170 wpm at speed 1.0

type Kokoro = { generate: (text: string, o: { voice: string; speed?: number }) => Promise<{ save: (f: string) => Promise<void> | void }> };
let kokoro: Promise<Kokoro> | null = null;
function loadKokoro(): Promise<Kokoro> {
  kokoro ??= import("kokoro-js").then(
    ({ KokoroTTS }) =>
      KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" }) as unknown as Promise<Kokoro>,
  );
  return kokoro;
}

async function sayToWav(text: string, dir: string, name: string, voice: string, rate: string, wav: string) {
  const txt = path.join(dir, `${name}.txt`);
  const aiff = path.join(dir, `${name}.aiff`);
  await writeFile(txt, text); // via file, so text starting with "-" isn't read as a flag
  try {
    await run("say", ["-v", voice, "-r", rate, "-f", txt, "-o", aiff]);
  } catch (err) {
    if (voice === "Samantha") throw err;
    console.warn(`voice "${voice}" not available — using Samantha`);
    await run("say", ["-v", "Samantha", "-r", rate, "-f", txt, "-o", aiff]);
  }
  await ffmpeg(["-i", aiff, "-ar", "48000", "-ac", "1", wav]);
}

export async function speak(
  text: string,
  dir: string,
  name: string,
  opts: { voice?: string; rate?: number } = {},
): Promise<{ file: string; duration: number }> {
  const wav = path.join(dir, `${name}.wav`);
  let voice = opts.voice || VOICE;
  if (process.platform !== "darwin" && !voice.startsWith("kokoro:")) voice = "kokoro:am_michael"; // `say` is Mac-only
  const rate = Number(opts.rate || RATE);
  if (voice.startsWith("kokoro:")) {
    try {
      const tts = await loadKokoro();
      const speed = Math.min(1.4, Math.max(0.75, rate / KOKORO_BASE_WPM));
      const raw = path.join(dir, `${name}-raw.wav`);
      await (await tts.generate(text, { voice: voice.slice(7), speed })).save(raw);
      await ffmpeg(["-i", raw, "-ar", "48000", "-ac", "1", wav]);
      return { file: wav, duration: await probeDuration(wav) };
    } catch (err) {
      console.warn(`Kokoro voice failed (${err instanceof Error ? err.message : err}) — using macOS voice`);
    }
  }
  await sayToWav(text, dir, name, voice.startsWith("kokoro:") ? "Samantha" : voice, String(rate), wav);
  return { file: wav, duration: await probeDuration(wav) };
}
