-- ClipPilot schema v2 — YouTube publishing (Step 6)
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

alter table settings add column if not exists youtube_channel_title text;
alter table settings add column if not exists youtube_privacy text not null default 'private';

do $$ begin
  alter table settings add constraint settings_youtube_privacy_check
    check (youtube_privacy in ('private', 'unlisted', 'public'));
exception when duplicate_object then null; end $$;

-- one queued/running job per clip+type, so double-clicking Approve can't upload twice
create unique index if not exists jobs_one_active_per_clip
  on jobs (clip_id, type) where status in ('queued', 'running');

-- make PostgREST see the new columns immediately
notify pgrst, 'reload schema';
