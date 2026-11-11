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
- [x] **Step 6 — YouTube connect + upload** (code done; live test needs Google OAuth client + migration 0002)
  Settings → "Connect YouTube" → Google OAuth (scope `youtube`, offline) → refresh token AES-256-GCM encrypted
  (`TOKEN_ENCRYPTION_KEY`) in `settings`; channel name shown; Disconnect revokes. Approve → upload job queued
  (if autopilot off; with autopilot on it waits for the daily slot — Step 7). Worker gets a 1-hour access token
  + metadata from `/api/worker/upload-plan`, does a resumable 8 MB-chunk upload of the full local MP4
  (re-renders if the file is missing), then `/api/worker/published` marks it published and adds it to the
  game's playlist ("GTA 6 Shorts" / "GTA 6 — Full Videos", created on first use, recreated if deleted).
  Category Gaming, not made for kids, #Shorts only on Shorts, visibility private/unlisted/public in Settings.
  Tests: `pnpm test` (incl. fake-YouTube upload with a mid-upload 503).
- [x] **Step 7 — Daily autopilot** (needs migration 0002 to run)
  `src/lib/scheduler.ts` tick: (1) recover clips stuck in scripting >15 min, (2) daily discovery at upload
  time − 4h (+ retry up to 3 failed scripts, then Claude scripts), (3) autopilot ON → at the upload time release
  the oldest approved clips (Shorts/day + 1 full video) as upload jobs; OFF → approve uploads immediately,
  (4) delete previews of videos published >7 days ago (server + worker/output). Each slot claimed with a
  compare-and-set (`last_discovery_at` / `last_release_at`) so it runs once; catch-up windows 12h / 6h.
  Clocks: the worker ticks every 5 min (`/api/worker/tick`, precise) + Vercel Cron daily backup
  (`vercel.ts` → `/api/cron/tick` 12:00 UTC, Hobby = 1/day). Settings shows next/last runs.
  Tests: `pnpm test:schedule`.
- [x] **Dashboard controls + confirmations**
  Settings → **Video & copyright** (stored in `settings.render`, sent to the worker with each render job):
  footage mode (my footage cut up / gradient only), **max seconds per footage cut** (montage of random cuts from
  all files for the game; 0 = one piece), keep footage sound on/off + volume (off by default — audio is what
  Content ID matches most), narrator voice + speed, words per caption, watermark text.
  Approve / Skip / Disconnect now open a confirm dialog that says exactly what will happen (upload now vs
  daily slot vs waiting for YouTube connect, privacy, playlist, risk warning). Undo toast kept.
- [x] **Workspaces — one per YouTube channel** (migration `0003_workspaces.sql`)
  Same login, many channels (Brand Accounts). Each workspace has its own settings, games/fallback order,
  playlists, schedule, autopilot, Video & copyright, trends (never-repeat is per workspace), clips and YouTube
  connection. Existing data → "Main" workspace. Sidebar switcher (+ New workspace, optionally copying settings),
  Settings → Workspace card (rename / delete with confirm). Current workspace = `cp_ws` cookie; scheduler +
  worker serve all workspaces (one worker, global job queue); Google sign-in always shows the account/channel
  picker and refuses a channel already connected to another workspace. Shared: YouTube API quota, footage folder.
- [x] **Growth engine — batch 1** (manual control + smarter content)
  - Manual: Trends search bar (keyword, last 7 days) or paste a YouTube link → joins the radar; **Make Short /
    Full video** from any trend; **Find more now** (1 extra Short beyond the daily count); clip page **Swap trend**
    (skip → next-best unused trend) and **Regenerate with a note** ("funnier", "focus on the map"…). All confirmed.
  - Ranking = speed (log views/hour) + **breakout** (views ÷ uploader's subscribers: a small channel at 10× its
    size = hot topic). Feeds the viral score.
  - Claude rules: ≤8-word hook in <2s, 20–40s Shorts (target capped at 40s), new info every beat, payoff in the last
    third, **loop ending** that flows into the hook, comment-question CTA (not "subscribe"), ≤50-char Shorts titles
    with the game name first, keyword-first description, max 3 hashtags; full videos: 15-second promise, ranked
    countdown, re-hooks ~every 60s. Outputs **emphasis words** (yellow, bigger in captions), a **comment to pin**,
    and **2 alternative titles** for A/B tests.
- [x] **Growth engine — batch 2** (migration `0004_growth.sql`)
  - Performance loop every 6h per workspace: views/likes/comments (videos.list as the channel → works for private),
    **average % watched** from YouTube Analytics (optional `yt-analytics.readonly` scope), Library columns +
    Dashboard "last 7 days" card. **Learning loop**: best/worst recent videos of THIS channel (views/day × retention)
    go into Claude's prompt.
  - **Several upload times per day** (Settings → Publishing), Shorts spread across slots, full video at the first slot.
  - **Breaking-news mode**: primary topic every 2–6h, only viral score 90+ becomes an extra Short (max 2/day).
  - Full videos: **chapters** from real beat timing + **custom thumbnail** (blurred frame + big text; needs a
    phone-verified channel). Suggested comment **auto-posted** once the video is public (`youtube.force-ssl`) — pin it in Studio.
- [x] **Topics you manage from the dashboard** (same migration)
  - Settings → **Topics**: edit presets or add any game/niche (search terms, title keywords, ≤3 hashtags, playlist,
    color, notes for Claude), delete custom ones, drag order, on/off.
  - Mode: **Fallback order** (primary first, then next until N/day) or **Daily count per topic** (e.g. 1/day for 4 games).
  - **Channel style** text for Claude (tone, audience, recurring sign-off).
  - **Visibility per video** in the Approve dialog (Private / Unlisted / Public; default = workspace setting).
- [ ] **Later ideas**: hook A/B (two hooks, keep the better 1-hour swipe rate), per-workspace audience timezone for
  slots, auto-generated end screens, voice cloning/premium TTS, trending-audio suggestions.
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
