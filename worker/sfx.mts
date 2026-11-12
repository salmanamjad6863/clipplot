import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "./proc.mts";

/**
 * Sound effects synthesized by FFmpeg from math (sine sweeps, noise, envelopes) — no samples, so nothing
 * anyone can claim. Generated once into worker/cache/sfx/.
 */
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "cache", "sfx");

export type Sfx = "whoosh" | "boom" | "ding" | "scratch" | "pop";

const RECIPES: Record<Sfx, string[]> = {
  // filtered pink-noise swell
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.9", "-af", "highpass=f=350,lowpass=f=5000,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.2,volume=2.2,alimiter=limit=0.7"],
  // falling sub sine + a little noise for the hit
  boom: ["-f", "lavfi", "-i", "aevalsrc=0.95*sin(2*PI*t*(70-45*t))*exp(-3.5*t)+0.25*(random(0)-0.5)*exp(-25*t):d=0.9:s=48000"],
  // bell: two harmonics with fast decay
  ding: ["-f", "lavfi", "-i", "aevalsrc=0.45*sin(2*PI*1568*t)*exp(-5*t)+0.2*sin(2*PI*3136*t)*exp(-8*t):d=0.9:s=48000"],
  // wobbling tone + noise = vinyl-scratch feel
  scratch: ["-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*(380+260*sin(2*PI*11*t))*t)*exp(-2.2*t)+0.18*(random(0)-0.5)*exp(-3*t):d=0.55:s=48000"],
  // short downward blip
  pop: ["-f", "lavfi", "-i", "aevalsrc=0.7*sin(2*PI*(1100-2600*t)*t)*exp(-28*t):d=0.16:s=48000"],
};

export async function sfxFile(name: Sfx): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${name}.wav`);
  if (!existsSync(file)) await ffmpeg([...RECIPES[name], "-ar", "48000", "-ac", "2", file]);
  return file;
}

export const SFX_NAMES = Object.keys(RECIPES) as Sfx[];
