import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./db";

/* The one place the site writes to Supabase: the registry rows behind the
 * campaigns and links made from the dashboard (registry-write.ts). The
 * secret key bypasses row level security, so it lives in SUPABASE_SECRET_KEY
 * on the host, is never read by a page, and every write it makes is earned
 * by a transaction the advertiser signed. Without it the hub is read-only,
 * and says so. */

let client: SupabaseClient | null | undefined;

export function adminDb(): SupabaseClient | null {
  if (client === undefined) {
    const key = process.env.SUPABASE_SECRET_KEY;
    client = key ? createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }
  return client;
}

export const canWriteRegistry = () => !!process.env.SUPABASE_SECRET_KEY;
