import sharp from "sharp";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const box = (x, y, w, h, title, lines, color) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fff" stroke="${color}" stroke-width="3"/>
  <rect x="${x}" y="${y}" width="${w}" height="46" rx="18" fill="${color}"/>
  <rect x="${x}" y="${y + 28}" width="${w}" height="18" fill="${color}"/>
  <text x="${x + w / 2}" y="${y + 31}" text-anchor="middle" font-size="21" font-weight="700" fill="#fff">${esc(title)}</text>
  ${lines.map((l, i) => `<text x="${x + 20}" y="${y + 78 + i * 27}" font-size="17" fill="#1f2333">${esc(l)}</text>`).join("")}`;
const arrow = (x1, y1, x2, y2, label, lx, ly, dashed) => `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#444a5e" stroke-width="2.5" marker-end="url(#a)" ${dashed ? 'stroke-dasharray="8 6"' : ""}/>
  ${label ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="15" fill="#444a5e" font-style="italic">${esc(label)}</text>` : ""}`;
const defs = `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#444a5e"/></marker></defs>`;
const frame = (w, h, title, sub, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial, Helvetica, sans-serif">${defs}
  <rect width="${w}" height="${h}" fill="#f7f7fb"/>
  <text x="60" y="70" font-size="34" font-weight="700" fill="#14151f">${esc(title)}</text>
  <text x="60" y="104" font-size="18" fill="#5a5f73">${esc(sub)}</text>${body}</svg>`;

// ---------------- Architecture ----------------
const A = frame(1800, 1120, "ClipPilot — System Architecture", "Internal tool · publishes only to channels we own · a person approves every upload · project 878155465105", `
  ${box(60, 150, 400, 210, "Team member (browser)", ["Signs in with team password", "Reviews scripts + preview videos", "Approves / skips each video", "Connects / disconnects channels"], "#6b4fd8")}
  ${box(700, 150, 460, 300, "ClipPilot web app (Vercel)", ["Next.js dashboard + API routes", "Password-protected (httpOnly session)", "Google OAuth 2.0 per channel", "Refresh tokens AES-256-GCM encrypted", "Daily scheduler (trend research)", "Builds upload metadata"], "#e2466a")}
  ${box(1300, 150, 440, 240, "Supabase (database + storage)", ["Settings, topics, clips, job queue", "Trend links + metadata only", "Small review previews (deleted 7d", "after publish); API data ≤ 30 days", "Row-level security: server-only"], "#1f9d74")}
  ${box(60, 560, 400, 300, "Render worker (our computer)", ["Claims approved jobs (secret key)", "FFmpeg render: our footage /", "graphics + our voiceover + captions", "Small preview → Supabase storage", "  (one-time signed upload URL)", "Resumable upload of the final", "video using a 1-hour access token"], "#d4831a")}
  ${box(700, 600, 460, 210, "Anthropic Claude API", ["Drafts original scripts + titles", "Input: public trend titles/stats and", "our own videos' performance", "No tokens or personal data sent"], "#7a7f93")}
  ${box(1300, 500, 440, 450, "Google / YouTube", ["YouTube Data API v3", " • search.list, videos.list,", "   channels.list (public metadata,", "   API key) — trend research", " • videos.insert, thumbnails.set,", "   playlists.insert,", "   playlistItems.insert,", "   commentThreads.insert (OAuth,", "   our channels only)", "YouTube Analytics API (read-only)", " • avg % watched of our videos", "Google OAuth 2.0 (consent,", "  revocation)"], "#d93025")}
  ${arrow(460, 255, 696, 255, "HTTPS (dashboard)", 578, 242)}
  ${arrow(1160, 270, 1296, 270, "read/write", 1228, 257)}
  ${arrow(930, 450, 930, 596, "", 0, 0)}
  <text x="918" y="530" text-anchor="end" font-size="15" fill="#444a5e" font-style="italic">script drafting</text>
  ${arrow(1160, 420, 1296, 560, "", 0, 0)}
  <text x="1238" y="535" text-anchor="end" font-size="15" fill="#444a5e" font-style="italic">search · metadata · OAuth</text>
  ${arrow(700, 400, 464, 600, "", 0, 0)}
  <text x="598" y="470" text-anchor="end" font-size="15" fill="#444a5e" font-style="italic">jobs + 1-hour token</text>
  ${arrow(460, 830, 1296, 900, "", 0, 0)}
  <text x="880" y="900" text-anchor="middle" font-size="15" fill="#444a5e" font-style="italic">videos.insert — resumable upload of the approved video</text>
  <text x="60" y="1060" font-size="16" fill="#5a5f73">Never: downloading or re-uploading other creators' videos · selling data · ads · storing YouTube API data longer than 30 days without refresh.</text>
`);

// ---------------- User flow ----------------
const steps = [
  ["1. Connect channel", ["Channel owner clicks", "Connect YouTube →", "Google consent screen", "→ grants upload access"], "#6b4fd8"],
  ["2. Trend research", ["Daily (or manual search):", "search.list + videos.list", "→ titles, views, links only", "duplicates skipped"], "#e2466a"],
  ["3. Script draft", ["Claude writes an original", "commentary script, title,", "description, tags, risk", "score for review"], "#7a7f93"],
  ["4. Render", ["Worker renders with our", "footage / graphics, our", "voiceover + captions;", "uploads a small preview"], "#d4831a"],
  ["5. Human review", ["Team watches preview,", "edits title/description,", "Approve (pick Private/", "Unlisted/Public) or Skip"], "#1f9d74"],
  ["6. Publish", ["Worker uploads via", "videos.insert (resumable)", "+ thumbnail, adds to", "playlist, posts 1 comment"], "#d93025"],
  ["7. Measure", ["Every 6h: videos.list +", "Analytics (% watched) for", "our videos → improves", "future scripts"], "#2f6fd6"],
];
let body = "";
const W = 230, H = 210, gap = 22, x0 = 60, y0 = 170;
steps.forEach(([t, l, c], i) => {
  const x = x0 + i * (W + gap);
  body += box(x, y0, W, H, t, l, c);
  if (i < steps.length - 1) body += arrow(x + W, y0 + H / 2, x + W + gap - 2, y0 + H / 2);
});
body += `
  <rect x="${x0 + 4 * (W + gap)}" y="440" width="${W}" height="120" rx="16" fill="#fff" stroke="#9aa0b4" stroke-width="2" stroke-dasharray="7 6"/>
  <text x="${x0 + 4 * (W + gap) + W / 2}" y="478" text-anchor="middle" font-size="18" font-weight="700" fill="#1f2333">Skip</text>
  <text x="${x0 + 4 * (W + gap) + W / 2}" y="506" text-anchor="middle" font-size="16" fill="#1f2333">Not uploaded.</text>
  <text x="${x0 + 4 * (W + gap) + W / 2}" y="530" text-anchor="middle" font-size="16" fill="#1f2333">Trend not reused.</text>
  ${arrow(x0 + 4 * (W + gap) + W / 2, y0 + H, x0 + 4 * (W + gap) + W / 2, 436, "", 0, 0, true)}
  <rect x="60" y="620" width="1680" height="150" rx="16" fill="#fff" stroke="#d93025" stroke-width="2"/>
  <text x="90" y="660" font-size="20" font-weight="700" fill="#d93025">Revoke / delete at any time</text>
  <text x="90" y="694" font-size="17" fill="#1f2333">• ClipPilot Settings → Disconnect: revokes the Google token and deletes it immediately.</text>
  <text x="90" y="722" font-size="17" fill="#1f2333">• Google Account → Security → Third-party connections (myaccount.google.com/connections).</text>
  <text x="90" y="750" font-size="17" fill="#1f2333">• Deleting a workspace removes its settings, trends, clips, stats and previews. YouTube API data older than 30 days is purged automatically.</text>
`;
const F = frame(1820, 820, "ClipPilot — User Flow", "From channel connection to a published video — nothing reaches YouTube without step 5 (human approval)", body);

await sharp(Buffer.from(A)).png().toFile("docs/audit/architecture-diagram.png");
await sharp(Buffer.from(F)).png().toFile("docs/audit/user-flow-diagram.png");
console.log("ok");
