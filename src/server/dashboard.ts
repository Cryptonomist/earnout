/* What the dashboard shows, from two places. Money comes from the chain,
 * read live: nothing to drift, nothing to trust. Counts (tagged, gone,
 * flagged) come from the settler's last published report in Supabase,
 * because only the settler can tell which channel a wallet came through.
 * Which campaigns and slugs exist comes from the registry (./registry.ts). */

import "server-only";
import { createSolanaRpc, getBase64Encoder, type Address } from "@solana/kit";
import { channelAddress, channelIdentityAddress, decodeCampaign, decodeChannel, decodeChannelIdentity } from "../../sdk/program";
import type { PublicReport } from "@/lib/report";
import { rpcUrl } from "./chain";
import { publicRows } from "./db";
import { campaigns, CLUSTER, type CampaignEntry } from "./registry";

export { CLUSTER, campaignMeta, linkFor, slugsByChannel, type CampaignEntry } from "./registry";
export { duration, money } from "@/lib/money";

export type CampaignMeta = CampaignEntry;

/** Campaigns the dashboard lists: the pilots, then the newest from the hub. */
export async function campaignList(opts: { limit?: number } = {}): Promise<CampaignEntry[]> {
  const all = await campaigns();
  return opts.limit ? all.slice(0, opts.limit) : all;
}

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
  settler: Address;
  identity: Address;
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
    settler: c.settler,
    identity: c.identity,
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
      const identity = identities[i] ? decodeChannelIdentity(bytes(identities[i]!.data[0])) : null;
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
          handle: identity?.handle ?? null,
          xId: identity?.xId ?? null,
        },
      ];
    }),
  };
}

export async function campaignReport(a: Address): Promise<PublicReport | null> {
  const [r] = await publicRows<{ data: PublicReport }>("reports", `select=data&campaign=eq.${a}&cluster=eq.${CLUSTER}`, 30);
  return r?.data ?? null;
}

// ── formatting ───────────────────────────────────────────────────────────────

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} seconds ago`;
  if (s < 5_400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129_600) return `${Math.round(s / 3_600)} hours ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

export const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
export const explorer = (kind: "address" | "tx", v: string) => `https://explorer.solana.com/${kind}/${v}?cluster=${CLUSTER}`;
