-- ClipPilot schema v4 — growth engine batch 2 + topics you manage from the dashboard
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

-- performance of published videos (refreshed every few hours by the scheduler)
alter table clips add column if not exists views          bigint;
alter table clips add column if not exists likes          int;
alter table clips add column if not exists comments       int;
alter table clips add column if not exists avg_view_pct   real;      -- YouTube Analytics: average % of the video watched
alter table clips add column if not exists stats_at       timestamptz;
alter table clips add column if not exists comment_posted boolean not null default false;

-- several upload times per day (replaces the single upload_time; that one stays as the first slot)
alter table settings add column if not exists upload_times text[];
update settings set upload_times = array[upload_time] where upload_times is null;

-- breaking-news mode: extra checks of the primary game every N hours
alter table settings add column if not exists breaking_news          boolean not null default false;
alter table settings add column if not exists breaking_every_hours   int     not null default 3;
alter table settings add column if not exists last_breaking_at       timestamptz;

-- performance refresh bookkeeping + which Google permissions the connection has
alter table settings add column if not exists last_stats_at  timestamptz;
alter table settings add column if not exists youtube_scopes text;

-- ---------- topics (games/niches) editable from Settings ----------
alter table games add column if not exists keywords     text[];                       -- title must contain one (empty = built-in rule)
alter table games add column if not exists color        text;
alter table games add column if not exists daily_shorts int     not null default 1;  -- used in "daily count per topic" mode
alter table games add column if not exists notes        text    not null default ''; -- style notes for Claude
alter table games add column if not exists custom       boolean not null default false;

alter table settings add column if not exists topic_mode      text not null default 'fallback'; -- fallback | per_topic
alter table settings add column if not exists channel_persona text not null default '';

-- visibility chosen when approving (null = workspace default)
alter table clips add column if not exists privacy text;

notify pgrst, 'reload schema';
