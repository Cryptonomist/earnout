/* The earnout Supabase project, read with the publishable key. That key is
 * meant to be public: row level security lets it read `reports`, `campaigns`
 * and `links`, and nothing else. Writes need the secret key and live in
 * db-admin.ts, on the server only. */

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://rglvyzffulvsyawnrenw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_FnShmwGT2wZnIWnItam2Ng_7Myr77E9";

/** Rows of a public table, or none when the database cannot be reached:
 * every reader degrades to what the repo's registry file says. With
 * `revalidateSecs`, Next keeps the answer that long; without it, each call
 * asks the database. */
export async function publicRows<T>(table: string, query: string, revalidateSecs?: number): Promise<T[]> {
  try {
    const init: RequestInit & { next?: { revalidate: number } } = { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } };
    if (revalidateSecs !== undefined) init.next = { revalidate: revalidateSecs };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, init);
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}
