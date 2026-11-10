import "server-only";
import { mockStore } from "./mock-store";
import type { Store } from "./store";
import { createSupabaseStore } from "./supabase-store";

let store: Store | undefined;
// In dev, hot reload can swap in a new createSupabaseStore while this module keeps its cache —
// remember which factory built the cached store and rebuild when it changes.
let builtBy: unknown;

/** Supabase when keys are configured, otherwise the in-memory mock (dev only). */
export function getStore(): Store {
  if (store && builtBy === createSupabaseStore) return store;
  builtBy = createSupabaseStore;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (key?.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY holds a publishable key — use the sb_secret_... key");
  }
  if (url && key) {
    store = createSupabaseStore(url, key);
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY");
    }
    console.warn("[clippilot] Supabase keys missing — using in-memory mock data");
    store = mockStore;
  }
  return store;
}

export type { Store };
