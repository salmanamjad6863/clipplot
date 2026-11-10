// Verifies the Supabase schema is installed: `pnpm db:check`
// Reads keys from .env.local; never prints them.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

if (key.startsWith("sb_publishable_")) {
  console.error("✗ SUPABASE_SECRET_KEY contains a *publishable* key. Use the sb_secret_... key from Project Settings → API Keys.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
let ok = true;
for (const table of ["settings", "games", "trends", "clips", "jobs"]) {
  const { count, error } = await sb.from(table).select("*", { count: "exact" }).limit(1);
  if (error) {
    ok = false;
    console.log(`✗ ${table.padEnd(9)} ${error.code ?? ""} ${error.message}`);
  } else {
    console.log(`✓ ${table.padEnd(9)} ${count} rows`);
  }
}

// Migration 0002 (YouTube publishing) applied?
if (ok) {
  const { error } = await sb.from("settings").select("youtube_privacy, youtube_channel_title").limit(1);
  console.log(error ? "✗ migration 0002 not applied — run supabase/migrations/0002_youtube.sql" : "✓ migration 0002 (YouTube) applied");
  if (error) ok = false;
  const { data: buckets } = await sb.storage.listBuckets();
  const hasBucket = buckets?.some((b) => b.name === "renders");
  console.log(hasBucket ? '✓ storage bucket "renders"' : '✗ storage bucket "renders" missing — run pnpm db:seed');
  if (!hasBucket) ok = false;
}

// Publishable key must NOT be able to read data (RLS on, no policies)
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (pub && ok) {
  const anon = createClient(url, pub, { auth: { persistSession: false } });
  const { data } = await anon.from("clips").select("id").limit(1);
  console.log(data?.length ? "✗ RLS: browser key can read clips!" : "✓ RLS: browser key can't read data");
}
process.exit(ok ? 0 : 1);
