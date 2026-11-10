// Inserts the settings row + games (fallback order) if missing: `pnpm db:seed`
// Safe to re-run: existing rows are left untouched.
import { createClient } from "@supabase/supabase-js";
import { GAMES } from "../src/lib/games.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Missing Supabase keys in .env.local");
const sb = createClient(url, key, { auth: { persistSession: false } });

const s = await sb.from("settings").upsert({ id: 1 }, { onConflict: "id", ignoreDuplicates: true });
if (s.error) throw new Error(`settings: ${s.error.message}`);

const g = await sb.from("games").upsert(
  GAMES.map((x) => ({
    slug: x.slug,
    name: x.name,
    priority: x.priority,
    queries: x.queries,
    hashtags: x.hashtags,
    playlist_title: x.playlistTitle,
  })),
  { onConflict: "slug", ignoreDuplicates: true },
);
if (g.error) throw new Error(`games: ${g.error.message}`);

const { count } = await sb.from("games").select("*", { count: "exact" }).limit(1);

// Storage for render PREVIEWS (full-quality files stay on the worker machine).
// Public = viewable by unguessable URL (clip UUID path); 50 MB = Supabase free-tier file limit.
const { data: buckets } = await sb.storage.listBuckets();
if (!buckets?.some((b) => b.name === "renders")) {
  const b = await sb.storage.createBucket("renders", {
    public: true,
    fileSizeLimit: "50MB",
    allowedMimeTypes: ["video/mp4", "image/jpeg"],
  });
  if (b.error) throw new Error(`bucket: ${b.error.message}`);
}
console.log(`seeded: settings ✓, games ${count}, storage bucket "renders" ✓`);
