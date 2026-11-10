-- OPTIONAL demo data so the dashboard isn't empty before Step 3 (real discovery).
-- Run after 0001_init.sql. Remove later with:  delete from clips; delete from trends;

insert into trends (id, game_slug, youtube_video_id, url, title, channel, views, views_per_hour, duration_sec, published_at, found_at, status, duplicate_reason) values
  ('00000000-0000-4000-8000-000000000001','gta-6','Lq1aZ0dGTa6','https://www.youtube.com/watch?v=Lq1aZ0dGTa6','GTA 6 Leonida skyline detail nobody noticed','ViceWatch',812000,41000,612, now()-interval '20 hours', now()-interval '2 hours','used',null),
  ('00000000-0000-4000-8000-000000000002','gta-6','Bp7cWv3Phys','https://www.youtube.com/watch?v=Bp7cWv3Phys','GTA 6 beach & wave physics breakdown','FrameByFrame',455000,19000,58, now()-interval '24 hours', now()-interval '3 hours','used',null),
  ('00000000-0000-4000-8000-000000000003','gta-6','Tr3hFrTh3ry','https://www.youtube.com/watch?v=Tr3hFrTh3ry','GTA 6 Trailer 3 frame by frame theory','RockstarIntel',1240000,52000,945, now()-interval '24 hours', now()-interval '4 hours','used',null),
  ('00000000-0000-4000-8000-000000000004','gta-6','Dup1Trailr3','https://www.youtube.com/watch?v=Dup1Trailr3','GTA 6 TRAILER 3 — frame-by-frame THEORY 🤯 #shorts','ReuploadKing',98000,8200,45, now()-interval '12 hours', now()-interval '4 hours','duplicate','Same story as “GTA 6 Trailer 3 frame by frame theory” (100% match)'),
  ('00000000-0000-4000-8000-000000000005','gta-6','Smal1Trend0','https://www.youtube.com/watch?v=Smal1Trend0','GTA 6 phone UI concept','ConceptLab',30000,1100,40, now()-interval '27 hours', now()-interval '2 hours','below_threshold',null),
  ('00000000-0000-4000-8000-000000000006','gta-5','H3istTier5x','https://www.youtube.com/watch?v=H3istTier5x','Every GTA Online heist ranked before GTA 6','HeistHub',300000,9800,1320, now()-interval '30 hours', now()-interval '5 hours','used',null)
on conflict (youtube_video_id) do nothing;

insert into clips (game_slug, is_fallback, format, duration_sec, title, hook, description, tags, status, trend_ids, trend_url, viral_score, risk_score, created_at) values
  ('gta-6', false, 'short', 42, 'Leonida map detail nobody noticed', 'Pause at 0:14 — look at the skyline.', 'Pause at 0:14 — look at the skyline.', '{GTA6,GTAVI,Leonida}', 'awaiting_approval', '{00000000-0000-4000-8000-000000000001}', 'https://www.youtube.com/watch?v=Lq1aZ0dGTa6', 92, 12, now()-interval '2 hours'),
  ('gta-6', false, 'long', 560, 'GTA 6 — Every Trailer 3 Secret Explained', '12 details Rockstar hid in plain sight.', '12 details Rockstar hid in plain sight.', '{GTA6,Trailer3,Breakdown}', 'awaiting_approval', '{00000000-0000-4000-8000-000000000003,00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002}', 'https://www.youtube.com/watch?v=Tr3hFrTh3ry', 89, 22, now()-interval '3 hours'),
  ('gta-6', false, 'short', 38, 'Vice City beach physics breakdown', 'This wave tech is insane.', '', '{GTA6}', 'rendering', '{00000000-0000-4000-8000-000000000002}', 'https://www.youtube.com/watch?v=Bp7cWv3Phys', 84, 10, now()-interval '3 hours'),
  ('gta-5', true, 'long', 660, 'Every GTA Online heist ranked before GTA 6', 'Number one surprised everyone.', '', '{GTA5,GTAOnline}', 'discovered', '{00000000-0000-4000-8000-000000000006}', 'https://www.youtube.com/watch?v=H3istTier5x', 71, 8, now()-interval '5 hours');
