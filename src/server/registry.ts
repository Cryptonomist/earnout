/* Which slug is which channel. Kept in the repo for the pilots, one file per
 * cluster; campaigns created from the dashboard will move this to a
 * database. Written by scripts/create-campaign.ts. The same file's
 * `campaigns` section holds the settler's rules; see settler/config.ts. */

import { address } from "@solana/kit";
import devnet from "../../registry/devnet.json";
import type { LinkEntry, Registry } from "./links";

type RawEntry = { campaign: string; channel: number; destination: string; label?: string };

/** Turn a registry file into typed entries, checking every address on the
 * way; a malformed entry fails loudly here rather than on a click. */
export function parseRegistry(raw: Record<string, RawEntry>): Registry {
  const out: Registry = {};
  for (const [slug, e] of Object.entries(raw)) {
    if (!Number.isInteger(e.channel) || e.channel < 0) throw new Error(`registry: bad channel for ${slug}`);
    const entry: LinkEntry = { campaign: address(e.campaign), channel: e.channel, destination: e.destination };
    if (e.label) entry.label = e.label;
    out[slug] = entry;
  }
  return out;
}

const BY_CLUSTER: Record<string, Registry> = { devnet: parseRegistry(devnet.links) };

export function registry(): Registry {
  return BY_CLUSTER[process.env.EARNOUT_CLUSTER ?? "devnet"] ?? {};
}
