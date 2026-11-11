import "server-only";
import { mockStore } from "./mock-store";
import { MAIN_WORKSPACE_ID } from "../types";
import type { Store } from "./store";
import { createSupabaseStore } from "./supabase-store";

const stores = new Map<string, Store>();
// In dev, hot reload can swap in a new createSupabaseStore while this module keeps its cache —
// remember which factory built the cached stores and rebuild when it changes.
let builtBy: unknown;

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (key?.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY holds a publishable key — use the sb_secret_... key");
  }
  return url && key ? { url, key } : null;
}

/**
 * Store scoped to one workspace (= YouTube channel). Supabase when keys are configured,
 * otherwise the in-memory mock (dev only, single workspace).
 */
export function getStore(workspaceId: string): Store {
  if (builtBy !== createSupabaseStore) {
    stores.clear();
    builtBy = createSupabaseStore;
  }
  const cached = stores.get(workspaceId);
  if (cached) return cached;

  const env = supabaseEnv();
  let store: Store;
  if (env) {
    store = createSupabaseStore(env.url, env.key, workspaceId);
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY");
    }
    console.warn("[clippilot] Supabase keys missing — using in-memory mock data");
    store = mockStore;
  }
  stores.set(workspaceId, store);
  return store;
}

/**
 * For the global job queue (worker routes): jobs, storage and job→clip lookups are not
 * workspace-filtered, so any workspace's store works — this names that intent.
 */
export function jobsStore(): Store {
  return getStore(MAIN_WORKSPACE_ID);
}

export { supabaseEnv };
export type { Store };
