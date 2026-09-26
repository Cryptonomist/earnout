/* What the settler publishes after every pass and the dashboard reads: per
 * channel counts and settlement links. It never carries a wallet address;
 * which wallet came through which channel stays in the private ledger.
 * Money figures are not here either: the dashboard reads those from the
 * chain, so they cannot drift. */

import type { CampaignView, Ledger } from "../../settler/core";
import { receipts } from "../../settler/core";

export type ChannelReport = {
  index: number;
  slug: string | null;
  tagged: number;
  waiting: number;
  gone: number;
  flagged: number;
  otherRejected: number;
  qualified: number;
  settled: number;
  /** Every rejection reason seen on this channel, with its count. */
  reasons: Record<string, number>;
};

export type PublicReport = {
  campaign: string;
  cluster: string;
  name: string;
  /** When the settler last finished a pass, ISO. */
  updatedAt: string;
  channels: ChannelReport[];
  /** Tagged transactions that could not be tied to any channel. */
  unattributed: number;
  batches: { channel: number; batch: number; conversions: number; evidence: string; tx: string | null }[];
};

export function buildReport(
  ledger: Ledger,
  v: CampaignView,
  meta: { cluster: string; name: string; slugs: Map<string, string>; now?: Date },
): PublicReport {
  const records = Object.values(ledger.records);
  const channels = receipts(ledger, v).map((r) => {
    const reasons: Record<string, number> = {};
    for (const rec of records) {
      if (rec.channel === r.channel && rec.reason) reasons[rec.reason] = (reasons[rec.reason] ?? 0) + 1;
    }
    return {
      index: r.channel,
      slug: meta.slugs.get(`${v.address}:${r.channel}`) ?? null,
      tagged: r.tagged,
      waiting: r.waiting,
      gone: r.gone,
      flagged: r.flagged,
      otherRejected: r.otherRejected,
      qualified: r.qualified,
      settled: r.settled,
      reasons,
    };
  });
  return {
    campaign: v.address,
    cluster: meta.cluster,
    name: meta.name,
    updatedAt: (meta.now ?? new Date()).toISOString(),
    channels,
    unattributed: records.filter((r) => r.channel === null).length,
    batches: ledger.batches.map((b) => ({
      channel: b.channel,
      batch: b.batch,
      conversions: b.signatures.length,
      evidence: b.evidence,
      tx: b.tx ?? null,
    })),
  };
}
