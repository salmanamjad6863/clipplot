-- ClipPilot schema v1
-- Run once in Supabase → SQL Editor (or `supabase db push`).
-- Stores links + metadata only. Videos themselves live in R2 (rendered output) or nowhere (trend sources).

create extension if not exists pgcrypto;

-- ---------- Enums ----------
do $$ begin
  create type clip_status as enum ('discovered','scripting','rendering','awaiting_approval','scheduled','published','rejected','failed');
  create type video_format as enum ('short','long');
  create type trend_status as enum ('new','used','duplicate','below_threshold');
  create type job_type as enum ('script','render','upload');
  create type job_status as enum ('queued','running','done','failed');
exception when duplicate_object then null; end $$;

-- ---------- Games (niche + fallback order + per-game playlists) ----------
create table if not exists games (
  slug               text primary key,
  name               text not null,
  priority           int  not null,
  enabled            boolean not null default true,
  queries            text[] not null default '{}',
  hashtags           text[] not null default '{}',
  playlist_title     text not null,
  short_playlist_id  text,          -- YouTube playlist IDs, filled on first upload
  long_playlist_id   text
);

-- ---------- Settings (single row) ----------
create table if not exists settings (
  id                  int primary key default 1 check (id = 1),
  autopilot           boolean not null default false,
  upload_time         text    not null default '16:00',   -- HH:MM UTC
  min_views_per_hour  int     not null default 5000,
  max_fallback_depth  int     not null default 4,
  lookback_hours      int     not null default 48,
  dedupe_window_days  int     not null default 14,
  title_similarity    real    not null default 0.6,
  formats             jsonb   not null default '{
    "short": {"enabled": true, "minSec": 15, "maxSec": 60, "perDay": 1},
    "long":  {"enabled": true, "minSec": 480, "maxSec": 720, "cadence": "weekly", "clipsPerVideo": 8}
  }'::jsonb,
  youtube_channel_id     text,
  youtube_refresh_token  text,       -- encrypted with TOKEN_ENCRYPTION_KEY before storing (Step 6)
  updated_at          timestamptz not null default now()
);

-- ---------- Trends (viral videos spotted; link + stats only) ----------
create table if not exists trends (
  id                uuid primary key default gen_random_uuid(),
  game_slug         text not null references games(slug),
  youtube_video_id  text not null unique,           -- hard guarantee: never the same video twice
  url               text not null,
  title             text not null,
  channel           text not null default '',
  views             bigint not null default 0,
  views_per_hour    int not null default 0,
  duration_sec      int not null default 0,
  published_at      timestamptz,
  found_at          timestamptz not null default now(),
  status            trend_status not null default 'new',
  duplicate_reason  text
);
create index if not exists trends_found_at_idx on trends (found_at desc);
create index if not exists trends_status_idx on trends (status);

-- ---------- Clips (videos we make) ----------
create table if not exists clips (
  id              uuid primary key default gen_random_uuid(),
  game_slug       text not null references games(slug),
  is_fallback     boolean not null default false,
  format          video_format not null default 'short',
  duration_sec    int not null default 0,
  title           text not null,
  hook            text not null default '',
  script          text,
  description     text not null default '',
  tags            text[] not null default '{}',
  status          clip_status not null default 'discovered',
  trend_ids       uuid[] not null default '{}',
  trend_url       text not null default '',
  source_url      text,
  render_url      text,
  captions_url    text,
  youtube_url     text,
  youtube_video_id text,
  playlist_id     text,
  viral_score     int not null default 0,
  risk_score      int not null default 0,
  error           text,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists clips_status_idx on clips (status);
create index if not exists clips_created_at_idx on clips (created_at desc);

-- ---------- Jobs (work queue for script/render/upload) ----------
create table if not exists jobs (
  id          uuid primary key default gen_random_uuid(),
  clip_id     uuid not null references clips(id) on delete cascade,
  type        job_type not null,
  status      job_status not null default 'queued',
  attempts    int not null default 0,
  error       text,
  locked_by   text,
  locked_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists jobs_queue_idx on jobs (status, type, created_at);

-- ---------- updated_at trigger ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists clips_touch on clips;
create trigger clips_touch before update on clips for each row execute function touch_updated_at();
drop trigger if exists settings_touch on settings;
create trigger settings_touch before update on settings for each row execute function touch_updated_at();

-- ---------- Security ----------
-- RLS on with NO policies: the browser (publishable key) can't read/write anything.
-- Only our server, using SUPABASE_SECRET_KEY, can access these tables.
alter table games    enable row level security;
alter table settings enable row level security;
alter table trends   enable row level security;
alter table clips    enable row level security;
alter table jobs     enable row level security;

-- ---------- Seed: settings row + games (fallback order) ----------
insert into settings (id) values (1) on conflict (id) do nothing;

insert into games (slug, name, priority, queries, hashtags, playlist_title) values
  ('gta-6',        'GTA 6',                 0, '{"GTA 6","GTA VI","Grand Theft Auto 6 trailer","GTA 6 gameplay"}', '{"#GTA6","#GTAVI","#Shorts"}',              'GTA 6 Shorts'),
  ('gta-5',        'GTA 5 / Online',        1, '{"GTA 5","GTA Online"}',                                              '{"#GTA5","#GTAOnline","#Shorts"}',          'GTA 5 & Online Shorts'),
  ('rdr2',         'Red Dead Redemption 2', 2, '{"Red Dead Redemption 2","RDR2"}',                                    '{"#RDR2","#RedDeadRedemption2","#Shorts"}', 'Red Dead Redemption 2 Shorts'),
  ('minecraft',    'Minecraft',             3, '{"Minecraft"}',                                                       '{"#Minecraft","#Shorts"}',                  'Minecraft Shorts'),
  ('fortnite',     'Fortnite',              4, '{"Fortnite"}',                                                        '{"#Fortnite","#Shorts"}',                   'Fortnite Shorts'),
  ('call-of-duty', 'Call of Duty',          5, '{"Call of Duty","Warzone"}',                                          '{"#CallOfDuty","#Warzone","#Shorts"}',      'Call of Duty Shorts'),
  ('elden-ring',   'Elden Ring',            6, '{"Elden Ring","Elden Ring Nightreign"}',                              '{"#EldenRing","#Shorts"}',                  'Elden Ring Shorts'),
  ('roblox',       'Roblox',                7, '{"Roblox"}',                                                          '{"#Roblox","#Shorts"}',                     'Roblox Shorts')
on conflict (slug) do nothing;
