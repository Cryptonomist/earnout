/* What the dashboard shows, from two places. Money comes from the chain,
 * read live: nothing to drift, nothing to trust. Counts (tagged, gone,
 * flagged) come from the settler's last published report in Supabase,
 * because only the settler can tell which channel a wallet came through.
 *
 * The publishable key below is designed to be public: it can read the
 * `reports` table and nothing else (the ledgers are service-role only). */

import "server-only";
import { address, createSolanaRpc, getBase64Encoder, type Address } from "@solana/kit";
import devnet from "../../registry/devnet.json";
import { channelAddress, channelIdentityAddress, decodeCampaign, decodeChannel, decodeChannelIdentity } from "../../sdk/program";
import type { PublicReport } from "@/lib/report";
import { rpcUrl } from "./chain";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://rglvyzffulvsyawnrenw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_FnShmwGT2wZnIWnItam2Ng_7Myr77E9";
export const CLUSTER = process.env.EARNOUT_CLUSTER ?? "devnet";

export type ChannelChain = {
  index: number;
  address: Address;
  payee: Address;
  batches: number;
  conversions: bigint;
  earned: bigint;
  claimed: bigint;
  evidence: string;
  /** The verified X account this channel was created for; null for a
   * channel made before verification existed. */
  handle: string | null;
  xId: bigint | null;
};

export type CampaignChain = {
  address: Address;
  advertiser: Address;
  mint: Address;
  decimals: number;
  payout: bigint;
  retentionSecs: number;
  createdAt: number;
  endsAt: number;
  settleDeadline: number;
  funded: bigint;
  committed: bigint;
  claimed: bigint;
  refunded: bigint;
  channels: ChannelChain[];
};

export type CampaignMeta = { address: Address; name: string; description: string | null };

type RawCampaign = { name?: string; description?: string };

/** Campaigns the dashboard lists: the ones the settler runs. */
export function campaignList(): CampaignMeta[] {
  if (CLUSTER !== "devnet") return [];
  return Object.entries(devnet.campaigns as Record<string, RawCampaign>).map(([a, c]) => ({
    address: address(a),
    name: c.name ?? a,
    description: c.description ?? null,
  }));
}

export function campaignMeta(a: string): CampaignMeta | null {
  return campaignList().find((c) => c.address === a) ?? null;
}

/** The link slug for each channel, keyed `campaign:index`. */
export function slugsByChannel(): Map<string, string> {
  const links = devnet.links as Record<string, { campaign: string; channel: number }>;
  return new Map(Object.entries(links).map(([slug, e]) => [`${e.campaign}:${e.channel}`, slug]));
}

export function linkFor(slug: string): { campaign: Address; channel: number } | null {
  const links = devnet.links as Record<string, { campaign: string; channel: number }>;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) || !Object.hasOwn(links, slug)) return null;
  return { campaign: address(links[slug].campaign), channel: links[slug].channel };
}

const bytes = (b64: string) => getBase64Encoder().encode(b64) as Uint8Array;

export async function campaignChain(a: Address): Promise<CampaignChain | null> {
  const rpc = createSolanaRpc(rpcUrl());
  const { value } = await rpc.getAccountInfo(a, { encoding: "base64", commitment: "confirmed" }).send();
  if (!value) return null;
  const c = decodeCampaign(bytes(value.data[0]));

  const channelAddresses = await Promise.all(Array.from({ length: c.channels }, (_, i) => channelAddress(a, i)));
  const identityAddresses = await Promise.all(channelAddresses.map((ch) => channelIdentityAddress(ch)));
  const { value: accounts } = await rpc
    .getMultipleAccounts([c.mint, ...channelAddresses, ...identityAddresses], { encoding: "base64", commitment: "confirmed" })
    .send();
  const mint = accounts[0];
  const channels = accounts.slice(1, 1 + channelAddresses.length);
  const identities = accounts.slice(1 + channelAddresses.length);

  return {
    address: a,
    advertiser: c.advertiser,
    mint: c.mint,
    decimals: mint ? bytes(mint.data[0])[44] : 0,
    payout: c.payout,
    retentionSecs: c.retentionSecs,
    createdAt: Number(c.createdAt),
    endsAt: Number(c.endsAt),
    settleDeadline: Number(c.settleDeadline),
    funded: c.funded,
    committed: c.committed,
    claimed: c.claimed,
    refunded: c.refunded,
    channels: channels.flatMap((acc, i) => {
      if (!acc) return [];
      const ch = decodeChannel(bytes(acc.data[0]));
      return [
        {
          index: ch.index,
          address: channelAddresses[i],
          payee: ch.payee,
          batches: ch.batches,
          conversions: ch.conversions,
          earned: ch.earned,
          claimed: ch.claimed,
          evidence: Buffer.from(ch.evidence).toString("hex"),
          handle: identities[i] ? decodeChannelIdentity(bytes(identities[i]!.data[0])).handle : null,
          xId: identities[i] ? decodeChannelIdentity(bytes(identities[i]!.data[0])).xId : null,
        },
      ];
    }),
  };
}

async function reportsWhere(filter: string): Promise<PublicReport[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?select=data&${filter}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    return ((await res.json()) as { data: PublicReport }[]).map((r) => r.data);
  } catch {
    return [];
  }
}

export async function campaignReport(a: Address): Promise<PublicReport | null> {
  const [r] = await reportsWhere(`campaign=eq.${a}&cluster=eq.${CLUSTER}`);
  return r ?? null;
}

// ── formatting ───────────────────────────────────────────────────────────────

export function money(n: bigint, decimals: number): string {
  const v = Number(n) / 10 ** decimals;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function duration(secs: number): string {
  if (secs % 86_400 === 0) return `${secs / 86_400} day${secs === 86_400 ? "" : "s"}`;
  if (secs % 3_600 === 0) return `${secs / 3_600} hour${secs === 3_600 ? "" : "s"}`;
  return `${Math.round(secs / 60)} minute${secs === 60 ? "" : "s"}`;
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} seconds ago`;
  if (s < 5_400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129_600) return `${Math.round(s / 3_600)} hours ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

export const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
export const explorer = (kind: "address" | "tx", v: string) => `https://explorer.solana.com/${kind}/${v}?cluster=${CLUSTER}`;
