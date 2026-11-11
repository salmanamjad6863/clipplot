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

export async function captionFrame(
  file: string,
  c: Canvas,
  opts: { caption?: string; title?: string; brand?: string; emphasis?: string[] },
): Promise<string> {
  const parts: string[] = [];

  if (opts.title) {
    const size = c.vertical ? 56 : 46;
    const lines = wrap(opts.title.toUpperCase(), c.vertical ? 22 : 40).slice(0, 2);
    const y0 = c.vertical ? 230 : 90;
    const boxH = lines.length * size * 1.2 + 36;
    const boxW = Math.min(c.w - 80, Math.max(...lines.map((l) => l.length)) * size * 0.66 + 70);
    parts.push(
      `<rect x="${(c.w - boxW) / 2}" y="${y0 - size - 8}" width="${boxW}" height="${boxH}" rx="22" fill="#ff5e7e" fill-opacity="0.92"/>`,
      ...lines.map(
        (l, i) =>
          `<text x="50%" y="${y0 + i * size * 1.2}" text-anchor="middle" font-family="Arial Black, Arial" font-weight="900" font-size="${size}" fill="#0b0b12">${esc(l)}</text>`,
      ),
    );
  }

  if (opts.caption) {
    const size = c.vertical ? 92 : 64;
    const lines = wrap(opts.caption.toUpperCase(), c.vertical ? 16 : 36).slice(0, 3);
    // Shorts: captions sit above the bottom UI (title/buttons) but below the face-zone
    const yBase = c.vertical ? c.h * 0.62 : c.h * 0.84;
    const hot = new Set((opts.emphasis ?? []).flatMap((e) => e.split(/\s+/)).map(normWord).filter(Boolean));
    parts.push(
      ...lines.map((l, i) => {
        // highlighted key words: yellow + slightly bigger (a common retention style)
        const words = l.split(" ").map((w) =>
          hot.has(normWord(w)) ? `<tspan fill="#ffd84d" font-size="${Math.round(size * 1.12)}">${esc(w)}</tspan>` : esc(w),
        );
        return `<text x="50%" y="${yBase + (i - (lines.length - 1) / 2) * size * 1.14}" text-anchor="middle" font-family="Impact, Arial Black" font-size="${size}" fill="#ffffff" stroke="#000000" stroke-width="${c.vertical ? 14 : 10}" stroke-linejoin="round" paint-order="stroke">${words.join(" ")}</text>`;
      }),
    );
  }

  if (opts.brand) {
    parts.push(
      `<text x="${c.w - 36}" y="${c.h - (c.vertical ? 64 : 36)}" text-anchor="end" font-family="Arial Black, Arial" font-size="${c.vertical ? 34 : 26}" fill="#ffffff" fill-opacity="0.55">${esc(opts.brand)}</text>`,
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
