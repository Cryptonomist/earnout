/* Which campaigns the site knows, and which slug is which channel.
 *
 * Two sources, read together. The repo's registry/<cluster>.json holds the
 * pilots (written by scripts/create-campaign.ts; its `campaigns` section is
 * also where the settler's rules for them live). The `campaigns` and `links`
 * tables in Supabase hold everything made from the dashboard; a row gets
 * there only through registry-write.ts, on the strength of a transaction the
 * advertiser signed. The file wins any slug both claim, and nothing here
 * writes to either. */

import { address, isAddress, type Address } from "@solana/kit";
import devnet from "../../registry/devnet.json";
import { SLUG, type Rules } from "../lib/rules";
import { publicRows } from "./db";
import type { LinkEntry, Registry } from "./links";

export const CLUSTER = process.env.EARNOUT_CLUSTER ?? "devnet";

export type CampaignEntry = {
  address: Address;
  name: string;
  description: string | null;
  /** Where its links send people. */
  destination: string;
  /** "file" for a pilot in the repo, "db" for a campaign made from the dashboard. */
  source: "file" | "db";
  /** For a dashboard campaign: its rules, their hash, and the transaction that committed to them. */
  rules: Rules | null;
  rulesHash: string | null;
  rulesTx: string | null;
};

type RawLink = { campaign: string; channel: number; destination: string; label?: string };
type RawFile = { campaigns: Record<string, { name?: string; description?: string }>; links: Record<string, RawLink> };
type CampaignRow = { campaign: string; name: string; description: string | null; destination: string; rules: Rules; rules_hash: string; rules_tx: string };
type LinkRow = { slug: string; campaign: string; channel: number };

const FILES: Record<string, RawFile> = { devnet: devnet as unknown as RawFile };
const file = (): RawFile => FILES[CLUSTER] ?? { campaigns: {}, links: {} };

/** Turn a registry file's links into typed entries, checking every address
 * on the way; a malformed entry fails loudly here rather than on a click. */
export function parseRegistry(raw: Record<string, RawLink>): Registry {
  const out: Registry = {};
  for (const [slug, e] of Object.entries(raw)) {
    if (!Number.isInteger(e.channel) || e.channel < 0) throw new Error(`registry: bad channel for ${slug}`);
    const entry: LinkEntry = { campaign: address(e.campaign), channel: e.channel, destination: e.destination };
    if (e.label) entry.label = e.label;
    out[slug] = entry;
  }
  return out;
}

export function fileLinks(): Registry {
  return parseRegistry(file().links);
}

export function fileCampaigns(): CampaignEntry[] {
  const links = Object.values(file().links);
  return Object.entries(file().campaigns).map(([a, c]) => ({
    address: address(a),
    name: c.name ?? a,
    description: c.description ?? null,
    destination: links.find((l) => l.campaign === a)?.destination ?? "/demo",
    source: "file",
    rules: null,
    rulesHash: null,
    rulesTx: null,
  }));
}

/* The database rows, fetched fresh but at most once every couple of seconds
 * per server instance: one page renders several of these reads, and a link
 * click must not queue behind the database. A write on another instance is
 * seen within that long; the hub waits it out before showing the result. */
const TTL_MS = 2_000;
type Rows = { campaigns: CampaignRow[]; links: LinkRow[] };
let rows: { at: number; value: Promise<Rows> } | null = null;

function dbRows(): Promise<Rows> {
  if (!rows || Date.now() - rows.at > TTL_MS) {
    const value = Promise.all([
      publicRows<CampaignRow>(
        "campaigns",
        `select=campaign,name,description,destination,rules,rules_hash,rules_tx&cluster=eq.${CLUSTER}&order=created_at.desc`,
      ),
      publicRows<LinkRow>("links", "select=slug,campaign,channel&order=created_at.asc"),
    ]).then(([campaigns, links]) => ({ campaigns, links }));
    rows = { at: Date.now(), value };
  }
  return rows.value;
}

/** Drop the cached rows, right after a write. */
export function forgetRegistry(): void {
  rows = null;
}

/** Every campaign: the pilots first, then the newest from the dashboard. */
export async function campaigns(): Promise<CampaignEntry[]> {
  const fromFile = fileCampaigns();
  const known = new Set<string>(fromFile.map((c) => c.address));
  const fromDb: CampaignEntry[] = [];
  for (const r of (await dbRows()).campaigns) {
    if (!isAddress(r.campaign) || known.has(r.campaign)) continue;
    known.add(r.campaign);
    fromDb.push({
      address: address(r.campaign),
      name: r.name,
      description: r.description,
      destination: r.destination,
      source: "db",
      rules: r.rules,
      rulesHash: r.rules_hash,
      rulesTx: r.rules_tx,
    });
  }
  return [...fromFile, ...fromDb];
}

export async function campaignMeta(a: string): Promise<CampaignEntry | null> {
  if (!isAddress(a)) return null;
  return (await campaigns()).find((c) => c.address === a) ?? null;
}

/** Every slug the site serves, with the file's entries winning a collision. */
export async function registry(): Promise<Registry> {
  const out: Registry = { ...fileLinks() };
  const [all, { links }] = await Promise.all([campaigns(), dbRows()]);
  const byAddress = new Map(all.filter((c) => c.source === "db").map((c) => [c.address as string, c]));
  for (const l of links) {
    const c = byAddress.get(l.campaign);
    if (!c || !SLUG.test(l.slug) || Object.hasOwn(out, l.slug) || !Number.isInteger(l.channel) || l.channel < 0) continue;
    out[l.slug] = { campaign: c.address, channel: l.channel, destination: c.destination, label: l.slug };
  }
  return out;
}

/** The link slug for each channel, keyed `campaign:index`. */
export async function slugsByChannel(): Promise<Map<string, string>> {
  return new Map(Object.entries(await registry()).map(([slug, e]) => [`${e.campaign}:${e.channel}`, slug]));
}

export async function linkFor(slug: string): Promise<{ campaign: Address; channel: number } | null> {
  if (!SLUG.test(slug)) return null;
  const e = (await registry())[slug];
  return e ? { campaign: e.campaign, channel: e.channel } : null;
}
