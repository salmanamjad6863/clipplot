import path from "node:path";
import sharp from "sharp";

/**
 * Captions drawn as full-frame transparent PNGs (no libass/drawtext needed — works with any FFmpeg).
 * Each "frame" = one caption chunk + the beat's on-screen title; FFmpeg's concat demuxer turns
 * the sequence into a single overlay track.
 */

export interface Canvas {
  w: number;
  h: number;
  vertical: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Break text into lines of at most `max` chars without splitting words */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/** Visual theme — rotated per video so uploads don't all look identical. */
export interface CaptionStyle {
  name: string;
  /** title box color */
  accent: string;
  /** title text color */
  accentInk: string;
  /** highlighted key words */
  hot: string;
  font: string;
  /** caption vertical position (fraction of height, Shorts) */
  y: number;
  /** speaker name tags */
  hostA: string;
  hostB: string;
}

export const STYLES: CaptionStyle[] = [
  { name: "neon", accent: "#ff5e7e", accentInk: "#0b0b12", hot: "#ffd84d", font: "Impact, Anton, Arial Black, Archivo Black", y: 0.62, hostA: "#ff5e7e", hostB: "#7aa2ff" },
  { name: "lime", accent: "#b6ff3b", accentInk: "#0b0b12", hot: "#b6ff3b", font: "Impact, Anton, Arial Black, Archivo Black", y: 0.66, hostA: "#b6ff3b", hostB: "#ff9f43" },
  { name: "vice", accent: "#ff4fd8", accentInk: "#ffffff", hot: "#38f2ff", font: "Arial Black, Archivo Black, Impact, Anton", y: 0.6, hostA: "#ff4fd8", hostB: "#38f2ff" },
  { name: "gold", accent: "#ffcc33", accentInk: "#141414", hot: "#ffcc33", font: "Impact, Anton, Arial Black, Archivo Black", y: 0.64, hostA: "#ffcc33", hostB: "#ff6b6b" },
  { name: "ice", accent: "#ffffff", accentInk: "#0b0b12", hot: "#5ee6ff", font: "Arial Black, Archivo Black, Impact, Anton", y: 0.62, hostA: "#5ee6ff", hostB: "#ffd84d" },
];

export async function captionFrame(
  file: string,
  c: Canvas,
  opts: {
    caption?: string;
    title?: string;
    brand?: string;
    emphasis?: string[];
    /** meme-style caption at the top */
    meme?: string;
    /** small pill, e.g. "ORIGINAL CLIP · @channel" */
    badge?: string;
    /** name tag above the caption ("MAX" / "ZOE") */
    speaker?: { name: string; host: "A" | "B" };
    style?: CaptionStyle;
  },
): Promise<string> {
  const parts: string[] = [];
  const st = opts.style ?? STYLES[0];

  if (opts.badge) {
    const size = c.vertical ? 34 : 28;
    const w = Math.min(c.w - 60, opts.badge.length * size * 0.62 + 60);
    const y = c.vertical ? 120 : 50;
    parts.push(
      `<rect x="40" y="${y}" width="${w}" height="${size + 26}" rx="${(size + 26) / 2}" fill="#e3242b"/>`,
      `<circle cx="${40 + 30}" cy="${y + (size + 26) / 2}" r="9" fill="#ffffff"/>`,
      `<text x="${40 + 50}" y="${y + size + 6}" font-family="Arial Black, Archivo Black, Arial" font-size="${size}" fill="#ffffff">${esc(opts.badge.toUpperCase())}</text>`,
    );
  }

  if (opts.meme) {
    const size = c.vertical ? 78 : 60;
    const lines = wrap(opts.meme.toUpperCase(), c.vertical ? 18 : 34).slice(0, 2);
    const y0 = c.vertical ? 470 : 200;
    parts.push(
      ...lines.map(
        (l, i) =>
          `<text x="50%" y="${y0 + i * size * 1.1}" text-anchor="middle" font-family="Impact, Anton, Arial Black" font-size="${size}" fill="#ffffff" stroke="#000000" stroke-width="${c.vertical ? 12 : 9}" stroke-linejoin="round" paint-order="stroke" transform="rotate(-3 ${c.w / 2} ${y0})">${esc(l)}</text>`,
      ),
    );
  }

  if (opts.title) {
    const size = c.vertical ? 56 : 46;
    const lines = wrap(opts.title.toUpperCase(), c.vertical ? 22 : 40).slice(0, 2);
    const y0 = c.vertical ? 230 : 90;
    const boxH = lines.length * size * 1.2 + 36;
    const boxW = Math.min(c.w - 80, Math.max(...lines.map((l) => l.length)) * size * 0.66 + 70);
    parts.push(
      `<rect x="${(c.w - boxW) / 2}" y="${y0 - size - 8}" width="${boxW}" height="${boxH}" rx="22" fill="${st.accent}" fill-opacity="0.92"/>`,
      ...lines.map(
        (l, i) =>
          `<text x="50%" y="${y0 + i * size * 1.2}" text-anchor="middle" font-family="Arial Black, Archivo Black, Arial" font-weight="900" font-size="${size}" fill="${st.accentInk}">${esc(l)}</text>`,
      ),
    );
  }

  if (opts.caption) {
    const size = c.vertical ? 92 : 64;
    const lines = wrap(opts.caption.toUpperCase(), c.vertical ? 16 : 36).slice(0, 3);
    // Shorts: captions sit above the bottom UI (title/buttons) but below the face-zone
    const yBase = c.vertical ? c.h * st.y : c.h * 0.84;
    if (opts.speaker) {
      const tag = opts.speaker.name.toUpperCase();
      const ts = c.vertical ? 36 : 28;
      const tw = tag.length * ts * 0.72 + 40;
      // sit clearly above the first caption line (its cap height + stroke)
      const firstBaseline = yBase - ((lines.length - 1) / 2) * size * 1.14;
      const ty = firstBaseline - size * 0.9 - ts - 34;
      const color = opts.speaker.host === "A" ? st.hostA : st.hostB;
      parts.push(
        `<rect x="${(c.w - tw) / 2}" y="${ty}" width="${tw}" height="${ts + 18}" rx="10" fill="${color}"/>`,
        `<text x="50%" y="${ty + ts + 3}" text-anchor="middle" font-family="Arial Black, Archivo Black, Arial" font-size="${ts}" fill="#0b0b12">${esc(tag)}</text>`,
      );
    }
    const hot = new Set((opts.emphasis ?? []).flatMap((e) => e.split(/\s+/)).map(normWord).filter(Boolean));
    parts.push(
      ...lines.map((l, i) => {
        // highlighted key words: yellow + slightly bigger (a common retention style)
        const words = l.split(" ").map((w) =>
          hot.has(normWord(w)) ? `<tspan fill="${st.hot}" font-size="${Math.round(size * 1.12)}">${esc(w)}</tspan>` : esc(w),
        );
        return `<text x="50%" y="${yBase + (i - (lines.length - 1) / 2) * size * 1.14}" text-anchor="middle" font-family="${st.font}" font-size="${size}" fill="#ffffff" stroke="#000000" stroke-width="${c.vertical ? 14 : 10}" stroke-linejoin="round" paint-order="stroke">${words.join(" ")}</text>`;
      }),
    );
  }

  if (opts.brand) {
    parts.push(
      `<text x="${c.w - 36}" y="${c.h - (c.vertical ? 64 : 36)}" text-anchor="end" font-family="Arial Black, Archivo Black, Arial" font-size="${c.vertical ? 34 : 26}" fill="#ffffff" fill-opacity="0.55">${esc(opts.brand)}</text>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.h}">${parts.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  return file;
}

/** Split a beat's voiceover into short chunks timed by character length */
export function chunkCaption(text: string, start: number, duration: number, wordsPerChunk: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  const totalChars = chunks.reduce((n, c) => n + c.length + 1, 0) || 1;
  let t = start;
  return chunks.map((text) => {
    const d = (duration * (text.length + 1)) / totalChars;
    const item = { text, start: t, end: t + d };
    t += d;
    return item;
  });
}

export const framePath = (dir: string, i: number) => path.join(dir, `cap-${String(i).padStart(4, "0")}.png`);
