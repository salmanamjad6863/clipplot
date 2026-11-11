# ClipPilot — your setup checklist

Everything the code needs from you, in order. `.env.local` lives in this folder; never paste its values into chat.
Already done: Supabase keys + tables + seed, YouTube API key, FFmpeg, `CRON_SECRET`, `WORKER_SECRET`,
`TOKEN_ENCRYPTION_KEY`, `APP_PASSWORD`, `SESSION_SECRET`.

## 1. Claude credits (scripts) — pending
1. [console.anthropic.com](https://console.anthropic.com) → **Billing** → add credits ($5 minimum).
2. **API Keys → Create key** (starts with `sk-ant-api…`) → `.env.local`: `ANTHROPIC_API_KEY=…`
3. Restart `pnpm dev`. Open a failed clip → **Write script**.

## 2. Database update (YouTube + daily scheduler) — pending
Supabase → **SQL Editor → New query** → paste all of `supabase/migrations/0002_publishing.sql` → **Run**.
Check: `pnpm db:check` → every line ✓.

## 2b. Database update for workspaces — pending
Supabase → **SQL Editor → New query** → paste all of `supabase/migrations/0003_workspaces.sql` → **Run**.
Your current data becomes the **Main** workspace. Check: `pnpm db:check`.

**Several channels:** sidebar → workspace name → **New workspace** → Settings → **Connect YouTube** → in Google's
account list pick the other channel (Brand Accounts show as separate entries). Each channel can be connected to
one workspace only. Add every channel's Google login as an OAuth **test user**.

## 2c. Database update for growth + topics — pending
Supabase → **SQL Editor → New query** → paste all of `supabase/migrations/0004_growth.sql` → **Run**.
Check: `pnpm db:check` (every line ✓). Until then: topics can't be saved and stats don't refresh.

**Then reconnect YouTube once** (Settings → Connect YouTube, tick every permission) so ClipPilot can read
retention (% watched) and post the suggested comment. In Google Cloud → OAuth consent screen → **Data access**,
also add these two scopes: `.../auth/yt-analytics.readonly` and `.../auth/youtube.force-ssl`.

## 3. Google OAuth client (uploading) — pending
In the same Google Cloud project as your YouTube API key:

1. **APIs & Services → OAuth consent screen** (Google Auth Platform)
   - User type **External** → app name "ClipPilot", your email as support + developer contact.
   - **Audience → Test users → Add users** → the Google account that owns your YouTube channel.
   - Leave the app in **Testing**.
2. **Data access → Add or remove scopes** → add `https://www.googleapis.com/auth/youtube` → Save.
3. **Credentials → Create credentials → OAuth client ID**
   - Application type **Web application**, name "ClipPilot web".
   - **Authorized redirect URIs** → `http://localhost:3000/api/youtube/callback`
     (later also `https://<your-vercel-domain>/api/youtube/callback`).
   - Create → copy the Client ID and Client secret.
4. `.env.local`:
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-…
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/youtube/callback
   ```
5. Restart `pnpm dev` → sign in → **Settings → Connect YouTube** → pick your channel's account → tick the
   YouTube permission → you land back on Settings with "Connected: <channel name>".
   (Google shows "Google hasn't verified this app" in Testing mode → **Continue**.)

**Know before you post:**
- Testing-mode apps: the connection expires after **7 days** → just click Connect again. Publishing the app
  (OAuth consent screen → Publish) removes that, but then Google wants verification for the `youtube` scope.
- Unverified API projects can **only upload as Private** — YouTube enforces this, whatever Settings says.
  Make videos public by hand in YouTube Studio, or apply for the free
  [YouTube API audit](https://support.google.com/youtube/contact/yt_api_form) to unlock public uploads.
- Daily quota is 10,000 units: one upload ≈ 1,600, a discovery run ≈ 101 per game searched.

## 4. Daily autopilot (how it runs)
- Keep `pnpm worker` running on your Mac — it renders, uploads, **and is the scheduler clock** (ticks every 5 min).
- Settings → **Daily upload time (UTC)**. Discovery + Claude scripts run 4h earlier so you can review.
- Autopilot **off**: approving uploads right away. **On**: approved videos wait for the daily upload time
  (Shorts per day + 1 full video). Settings shows the next/last runs.
- On Vercel, a daily cron (12:00 UTC) is the backup for discovery if your Mac is off. If you move the upload
  time far from 16:00 UTC, change the schedule in `vercel.ts` to (upload time − 4h).
- Check any time: `pnpm worker --tick` prints the next discovery and upload slot.

## 5. Test the whole pipeline
```bash
pnpm dev        # terminal 1
pnpm worker     # terminal 2 — renders + uploads, polls every 30s
```
1. **Trends → Run discovery** → new clip → Claude writes the script → worker renders it.
2. **Review** → watch the preview → **Approve** (autopilot off = uploads right away).
3. Worker log shows `upload 100% → video …` and `✓ published https://www.youtube.com/shorts/…`.
4. YouTube Studio: the video (private) is in the **GTA 6 Shorts** playlist.

Optional: put your own gameplay / official trailer clips in `worker/footage/gta-6/` (see its README) —
otherwise videos use an animated gradient background. **Settings → Video & copyright** controls how they're
used: max seconds per cut (default 3s), footage sound (off by default), voice, captions, watermark.

## 6. Later — Step 8 (deploy)
Vercel project + all `.env.local` values as Vercel env vars (including `CRON_SECRET` — Vercel sends it to the
cron automatically), the production redirect URI above, and the worker pointed at the live site with
`CLIPPILOT_URL=https://<your-domain>`.
