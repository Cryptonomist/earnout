/* Every campaign the settler runs, and its slugs, from both registries:
 * registry/<cluster>.json in the repo (the pilots) and the `campaigns` and
 * `links` tables in Supabase (campaigns made from the dashboard). The file
 * wins any campaign or slug both name.
 *
 * A database row is trusted only if its rules still hash to the hash the
 * advertiser committed to on chain (src/lib/rules.ts). A row that does not
 * is skipped with a warning: whoever changed it was not the advertiser. */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { rulesHash, validateRules } from "../src/lib/rules.ts";
import { parseCampaigns, type CampaignConfig } from "./config.ts";

export type Registry = { campaigns: CampaignConfig[]; slugs: Map<string, string> };

type FileShape = { campaigns?: Record<string, unknown>; links?: Record<string, { campaign: string; channel: number }> };
export type CampaignRow = { campaign: string; rules: unknown; rules_hash: string };
export type LinkRow = { slug: string; campaign: string; channel: number };
export type Rows = { campaigns: CampaignRow[]; links: LinkRow[] };

export async function mergeRegistry(file: FileShape, rows: Rows, warn: (s: string) => void = console.warn): Promise<Registry> {
  const campaigns = parseCampaigns((file.campaigns ?? {}) as Record<string, Record<string, unknown>>);
  const known = new Set<string>(campaigns.map((c) => c.campaign));
  const slugs = new Map(Object.entries(file.links ?? {}).map(([slug, e]) => [`${e.campaign}:${e.channel}`, slug]));

  for (const row of rows.campaigns) {
    if (known.has(row.campaign)) continue;
    try {
      const rules = validateRules(row.rules);
      if ((await rulesHash(rules)) !== row.rules_hash) {
        warn(`registry: ${row.campaign} has rules that do not match the hash committed on chain; skipping it`);
        continue;
      }
      campaigns.push(...parseCampaigns({ [row.campaign]: rules }));
      known.add(row.campaign);
    } catch (e) {
      warn(`registry: skipping ${row.campaign}: ${(e as Error).message}`);
    }
  }
  for (const l of rows.links) {
    const key = `${l.campaign}:${l.channel}`;
    if (known.has(l.campaign) && !slugs.has(key)) slugs.set(key, l.slug);
  }
  return { campaigns, slugs };
}

async function fetchRows(cluster: string): Promise<Rows> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { campaigns: [], links: [] };
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const c = await db.from("campaigns").select("campaign, rules, rules_hash").eq("cluster", cluster);
  if (c.error) throw new Error(`read campaigns: ${c.error.message}`);
  const l = await db.from("links").select("slug, campaign, channel");
  if (l.error) throw new Error(`read links: ${l.error.message}`);
  return { campaigns: c.data as CampaignRow[], links: l.data as LinkRow[] };
}

export async function loadRegistry(cluster: string, root = process.cwd()): Promise<Registry> {
  const file = JSON.parse(fs.readFileSync(path.join(root, "registry", `${cluster}.json`), "utf8")) as FileShape;
  return mergeRegistry(file, await fetchRows(cluster));
}
