# ClipPilot — Build Plan

> Automated daily YouTube Shorts pipeline: spot today's viral GTA 6 moment → Claude writes a Short → a worker renders it → **you approve** → it uploads to YouTube (optionally on a daily schedule).
> We store **links + metadata only** — never the videos themselves in the database.

---

## 0. Niche: GTA 6 first, famous games as fallback

**Primary:** GTA 6 viral videos. **Fallback chain** (used only when GTA 6 has no strong trend that day), in priority order — config lives in `src/lib/games.ts`:

| # | Game | Playlist on your channel |
|---|---|---|
| 0 | **GTA 6** (primary) | GTA 6 Shorts |
| 1 | GTA 5 / Online | GTA 5 & Online Shorts |
| 2 | Red Dead Redemption 2 | Red Dead Redemption 2 Shorts |
| 3 | Minecraft | Minecraft Shorts |
| 4 | Fortnite | Fortnite Shorts |
| 5 | Call of Duty / Warzone | Call of Duty Shorts |
| 6 | Elden Ring | Elden Ring Shorts |
| 7 | Roblox | Roblox Shorts |

**Daily fallback logic**
1. Search GTA 6 queries for videos from the last 48 h, rank by views/hour.
2. If the best one is ≥ 5,000 views/hour (and not already used) → make today's Short from it.
3. Otherwise try the next game in the list, up to 4 games deep. Clips made this way are tagged **fallback** in the dashboard.
4. Nothing strong anywhere → no Short that day (better than posting a weak one).

You can reorder, enable/disable games and change thresholds in Settings (Step 1/2).

**Separate playlist per game**
- On the first upload for a game, ClipPilot creates its playlist on your channel (`playlists.insert`) and saves the playlist ID.
- Every later Short of that game is added to it (`playlistItems.insert`).
- Each game also has its own hashtags (e.g. `#GTA6 #GTAVI #Shorts`) added to the description.
- Quota cost per Short ≈ 1,600 (upload) + 50 (add to playlist) units; the 10,000/day default still allows ~6 Shorts/day.

---

## 0b. Video formats

| Format | Shape | Default length | Cadence | Playlist |
|---|---|---|---|---|
| **Short / reel** | 9:16 vertical | 15–60 s (max 3 min) | 1 per day (up to 6) | `<Game> Shorts` |
| **Full video** | 16:9 horizontal | 8–12 min | weekly (or daily) | `<Game> — Full Videos` |

- A Short is built from **one** trend. A full video is a compilation/breakdown of the period's best **N trends** (default 8) for one game.
- Lengths, cadence and per-day counts are editable in Settings.

## 0c. No repeats (duplicate protection) — `src/lib/dedupe.ts`

1. **Same video ID** is never used twice — every URL form is normalised (`watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`). Enforced again in the DB with a unique index on `trends.youtube_video_id`.
2. **Same ID twice in one discovery run** is collapsed.
3. **Same story re-uploaded by another channel**: title similarity (Jaccard on cleaned words) ≥ 60% against anything used in the last 14 days → skipped.
4. Skipped items are kept with a reason and shown on the Trends page, so you can see why.
5. Self-test: `pnpm test:dedupe`.

---

## 1. Stack (paid: Claude + Vercel; everything else free tier)

| Layer | Choice | Why |
|---|---|---|
| App + API | **Next.js 16 (App Router) on Vercel**, pnpm | Dashboard, API routes, OAuth callback, cron |
| Client data | **TanStack Query v5** | Caching, polling job status, optimistic approve/skip |
| UI | Tailwind v4 + `motion` + lucide-react | "Neon Dusk" theme: dark glass, sunset gradient, smooth spring animations |
| AI | **Claude API** (`claude-sonnet-5-5` for scripts, `claude-haiku-5-5` for scoring/tags) | Hooks, scripts, titles, descriptions, tags, caption cleanup, risk score |
| DB + auth | **Supabase free** (Postgres + Auth) | Tiny data: clips, links, settings, upload log. 500 MB is plenty |
| File storage | **Supabase Storage** (free 1 GB) | Small review previews only; full renders stay on your Mac |
| Daily trigger | **Vercel Cron** (1×/day on Hobby) | Kicks off the daily discovery job |
| Rendering | **Worker on your PC** (Node + FFmpeg + Whisper) — fallback: GitHub Actions | Vercel functions cap at 300 s; rendering doesn't belong there |
| Trend discovery | **YouTube Data API** search (metadata only) | View velocity on recent GTA 6 videos |
| Publishing | **YouTube Data API** `videos.insert` via OAuth | Official upload |

> Note: Vercel Hobby is for non-commercial use. If the channel is monetized, move to Vercel Pro ($20/mo).

---

## 2. Content & copyright rules (built into the product)

YouTube's API policy forbids downloading/storing other creators' videos, and re-uploads of someone else's clip get claimed/struck and demonetized for "reused content". So ClipPilot uses trends as **inspiration**, and footage from **rights-safe sources**:

1. **Your own GTA 6 gameplay captures** (once the game is out) — drop files in the worker's `inbox/` folder.
2. **Official Rockstar trailers/screenshots** used as short excerpts with **original commentary on top** (transformative, at your own judgment).
3. **Creator-submitted clips** with written permission (a simple submit form + permission checkbox).
4. **Creative Commons** videos, only after checking the license and adding attribution.

Every Short gets original value: Claude-written commentary/voiceover, captions, analysis, branding. The approval step is the final safety gate, and Claude adds a "policy risk" score to each draft.

---

## 3. Data model (Supabase)

```
settings      id, daily_upload_time, autopilot (bool), min_views_per_hour, max_fallback_depth, lookback_hours,
              dedupe_window_days, title_similarity, formats (jsonb: short/long enabled, min/max sec, cadence),
              youtube_channel_id, refresh_token (encrypted)
games         slug (pk), name, priority, enabled, queries[], hashtags[],
              playlist_title, short_playlist_id, long_playlist_id (null until first upload)
trends        id, game_slug, youtube_video_id (UNIQUE), url, duration_sec, status (new|used|duplicate|below_threshold), duplicate_reason, title, channel, views, views_per_hour, found_at
clips         id, trend_ids[], game_slug, is_fallback, format (short|long), duration_sec, status, hook, script, title, description, tags[],
              captions_srt_url, source_url, render_url, youtube_url, viral_score, risk_score,
              scheduled_for, created_at, updated_at
jobs          id, clip_id, type (script|render|upload), status, attempts, error, locked_by, created_at
```
Statuses: `discovered → scripting → rendering → awaiting_approval → scheduled → published` (+ `rejected`, `failed`).

---

## 4. Architecture

```
Vercel Cron (daily 08:00 UTC)
   └─▶ /api/cron/discover ─ YouTube search GTA 6 (metadata) ─▶ strong trend? ─ no ─▶ next game in fallback list
         └─▶ trends table (best by views/hour, tagged with game)
         └─▶ Claude: pick best angles, write hook + script + title + tags ─▶ clips (status: rendering) + render job
Home PC worker (polls /api/worker/next every 60s, secret-authenticated)
   └─▶ gets source footage (inbox / official / submitted) ─▶ FFmpeg 9:16 cut + Whisper captions + TTS/voiceover
         └─▶ keep full MP4 locally, upload small preview to Supabase Storage ─▶ clip → awaiting_approval
Dashboard (TanStack Query, polls)
   └─▶ Preview + Approve / Edit / Skip
         └─▶ Approve ─▶ scheduled ─▶ /api/youtube/upload (now, or next daily slot if autopilot)
                         └─▶ YouTube Data API videos.insert ─▶ add to that game's playlist
                               (create playlist first if missing) ─▶ published + youtube_url
```

---

## 5. Build steps (we do these one at a time — I'll ask before each)

- [x] **Step 0 — Scaffold & design system**
  Next.js 16 + pnpm + TanStack Query + motion. Neon Dusk theme, animated landing page, dashboard shell with mock data.
- [x] **Step 1 — App shell & pages**
  Sidebar + mobile bottom nav, Dashboard, Review queue + detail (edit title/description/tags), Library, Trends, Settings
  (drag-to-reorder games, formats & lengths, duplicate rules, autopilot). Toasts with undo, optimistic approve/skip,
  game + format filters. Runs on an in-memory mock store (`src/lib/mock-db.ts`) until Step 2.
- [x] **Step 2 — Supabase**
  Schema in `supabase/migrations/0001_init.sql` (games, settings, trends with UNIQUE video id, clips, jobs; RLS on, server-only access
  via secret key). Data layer `src/lib/data/` (Supabase, falls back to in-memory mock in dev when keys are missing).
  Single-user password gate (`src/proxy.ts`, `/login`, signed httpOnly cookie). `pnpm db:check` verifies the database.
  Optional demo rows: `supabase/seed-demo.sql`.
- [x] **Step 3 — Trend discovery** (code done; live run needs `YOUTUBE_API_KEY`)
  `src/lib/youtube/search.ts` (1 search + 1 stats call per game ≈ 101 quota units, queries OR-ed),
  `src/lib/discovery/plan.ts` (GTA 6 → fallback chain, views/hour scoring, dedupe, daily Short count, weekly/daily
  long compilation from the game's best trends), `run.ts`, `POST /api/discover` (button on Trends page),
  `GET /api/cron/discover` (Bearer CRON_SECRET). Tests: `pnpm test` (dedupe + 7 discovery scenarios).
- [x] **Step 4 — Claude content brain** (code done; live run needs Anthropic credits)
  `src/lib/ai/script.ts`: Claude Opus 5.5 (`claude-opus-5-5`, effort low, token-lean prompt) with structured output (Zod) →
  hook, title, description (+ "Inspired by" credits + game hashtags), tags, cover text, our original angle,
  timed beats (voiceover / on-screen text / rights-safe visual), risk score + notes. Server-side refusal
  fallback on. Runs automatically after discovery (`after()`), clip → `rendering` + render job queued.
  "Write script / Regenerate" on the clip page (`POST /api/clips/:id/script`). ≈ 1–3k tokens per Short. `GET /api/cron/script` scripts waiting clips one by one.
- [x] **Step 5 — Render worker** (`worker/`, run `pnpm worker` on your Mac)
  Polls `/api/worker/claim` (Bearer WORKER_SECRET), renders with FFmpeg: macOS `say` voiceover per beat →
  real timeline, captions drawn as PNG frames with sharp (works with stock Homebrew FFmpeg — no libass),
  background = your footage in `worker/footage/<game>/` or an animated gradient, progress bar, loudness
  -14 LUFS. Full quality stays in `worker/output/<clipId>/`; a ≤45 MB preview is uploaded to Supabase
  Storage (`renders` bucket) via signed URL → clip goes to review. 3 retries, stale jobs reclaimed after 30 min.
  **R2 dropped** — not needed (worker uploads to YouTube itself in Step 6). `pnpm worker --local clip.json` renders offline.
- [ ] **Step 6 — YouTube OAuth + upload**
  Connect channel (Google OAuth, `youtube.upload` scope), store refresh token encrypted, worker does the resumable upload of the full local MP4, set title/description/game hashtags/#Shorts, privacy setting; auto-create per-game playlist and add each Short to it.
- [ ] **Step 7 — Daily autopilot**
  Vercel Cron config, daily slot scheduling, "auto-upload approved" toggle, retry/failure handling, preview cleanup after publish.
- [ ] **Step 8 — Polish & deploy**
  Notifications (email/Telegram when a clip is ready), analytics card (views of published Shorts), deploy to Vercel, production env setup.

---

## 6. What you'll need to do manually (collected at the end)

- Anthropic API key
- Supabase project (URL + publishable key + secret key) and run `0001_init.sql` once in the SQL Editor
- `APP_PASSWORD` + `SESSION_SECRET` for the login gate
- Google Cloud project: enable **YouTube Data API v3**, OAuth consent screen, OAuth client (web), API key; add yourself as test user; request upload quota/verification if needed (default 10,000 units/day ≈ 6 uploads/day)
- Install FFmpeg + Whisper on your PC and run the worker
- Vercel project + env vars, `CRON_SECRET`, `WORKER_SECRET`

Full `.env` list is in `.env.example` and will be finalised at Step 8.
