/* The settler's decisions, with no network in them: given what the chain
 * said, which transactions are conversions, which conversions qualified,
 * and what to settle next. settler/chain.ts fetches; this decides; the
 * script sends. Everything here is replayable from a ledger file.
 *
 * A tagged transaction becomes a record and moves through
 *
 *   waiting ──(retention window closes)──> qualified ──> settled
 *      └──────────> rejected, with a reason, at any point before settled
 *
 * Settling is exactly once. A batch is written to the ledger as pending
 * before it is sent, and the program refuses a batch number twice, so on
 * the next run the chain says whether it landed (channel.batches moved
 * past it) or must be sent again, unchanged. */

import type { Address } from "@solana/kit";
import { verifiedReferences } from "../sdk/identity.ts";
import { openReference, type ReferenceKeys } from "../sdk/reference.ts";
import type { CampaignConfig } from "./config.ts";
import { evidenceHex } from "./evidence.ts";
import type { ParsedTx } from "./parse.ts";

/** A click can be issued a little after the clock that stamped the block. */
const CLOCK_SKEW = 300;

export type CampaignView = {
  address: Address;
  mint: Address;
  advertiser: Address;
  settler: Address;
  identity: Address;
  payout: bigint;
  retentionSecs: number;
  createdAt: number;
  endsAt: number;
  settleDeadline: number;
  funded: bigint;
  committed: bigint;
  channels: { index: number; address: Address; payee: Address; batches: number }[];
};

export type Reason =
  | "wrong identity"
  | "memo not signed"
  | "reference not ours"
  | "unknown channel"
  | "outside campaign"
  | "click expired"
  | "no qualifying action"
  | "self-referral"
  | "reference reused"
  | "wallet already converted"
  | "left before retention"
  | "funded by a channel"
  | "wallet cluster";

export type Status = "waiting" | "qualified" | "settled" | "rejected";

export type ConvRecord = {
  signature: string;
  wallet: string;
  channel: number | null;
  blockTime: number;
  issuedAt: number | null;
  status: Status;
  reason?: Reason;
  funder?: string | null;
  funderBusy?: boolean;
  batch?: number;
};

export type Batch = { channel: number; batch: number; signatures: string[]; evidence: string; tx?: string };

export type Ledger = {
  campaign: string;
  /** The newest campaign transaction already looked at. */
  cursor: string | null;
  records: Record<string, ConvRecord>;
  /** Sent or about to be sent, not yet seen on chain; by channel. */
  pending: Record<string, Batch>;
  batches: Batch[];
};

export const emptyLedger = (campaign: string): Ledger => ({ campaign, cursor: null, records: {}, pending: {}, batches: [] });

export type RetentionFacts = { stayed: boolean; funder: string | null; funderBusy: boolean };

// ── screening a tagged transaction ───────────────────────────────────────────

export function converts(tx: ParsedTx, cfg: CampaignConfig): boolean {
  const rule = cfg.conversion;
  if (rule.kind === "sol-transfer") {
    return tx.solMoves.some(
      (m) => m.kind === "transfer" && m.from === tx.feePayer && m.to === rule.to && m.lamports >= rule.minLamports,
    );
  }
  return tx.programs.has(rule.programId);
}

/** A record for a transaction tagged for this campaign, or null if it is not
 * one (the campaign's own create, fund and settle transactions, say). The
 * converting wallet is the fee payer. */
export async function screen(
  tx: ParsedTx,
  v: CampaignView,
  cfg: CampaignConfig,
  keys: ReferenceKeys,
  firstUse: (reference: Address) => Promise<string | null>,
): Promise<ConvRecord | null> {
  if (tx.failed) return null;
  const tag = tx.tags.find((t) => t.campaign === v.address);
  if (!tag) return null;

  const base = { signature: tx.signature, wallet: tx.feePayer, blockTime: tx.blockTime };
  const reject = (reason: Reason, channel: number | null = null, issuedAt: number | null = null): ConvRecord => ({
    ...base,
    channel,
    issuedAt,
    status: "rejected",
    reason,
  });

  if (tag.identity !== v.identity) return reject("wrong identity");
  if (!(await verifiedReferences(v.identity, tx.memos.join(";"))).includes(tag.reference)) return reject("memo not signed");
  const opened = openReference(keys, tag.reference);
  if (!opened) return reject("reference not ours");

  const { channel, issuedAt } = opened;
  if (channel >= v.channels.length) return reject("unknown channel", null, issuedAt);
  if (tx.blockTime < v.createdAt || tx.blockTime >= v.endsAt) return reject("outside campaign", channel, issuedAt);
  if (tx.blockTime < issuedAt - CLOCK_SKEW || tx.blockTime > issuedAt + cfg.attributionWindowSecs) {
    return reject("click expired", channel, issuedAt);
  }
  if (!converts(tx, cfg)) return reject("no qualifying action", channel, issuedAt);
  const insiders = new Set<string>([v.advertiser, v.settler, ...v.channels.map((c) => c.payee)]);
  if (insiders.has(tx.feePayer)) return reject("self-referral", channel, issuedAt);
  if ((await firstUse(tag.reference)) !== tx.signature) return reject("reference reused", channel, issuedAt);

  return { ...base, channel, issuedAt, status: "waiting" };
}

/** Add a screened record. One conversion per wallet per campaign: records
 * arrive oldest first, so the first one stands and later ones are refused. */
export function admit(ledger: Ledger, rec: ConvRecord): void {
  if (ledger.records[rec.signature]) return;
  if (rec.status !== "rejected") {
    const earlier = Object.values(ledger.records).some((r) => r.wallet === rec.wallet && r.status !== "rejected");
    if (earlier) {
      ledger.records[rec.signature] = { ...rec, status: "rejected", reason: "wallet already converted" };
      return;
    }
  }
  ledger.records[rec.signature] = rec;
}

// ── after the retention window ───────────────────────────────────────────────

export const due = (r: ConvRecord, v: CampaignView, now: number) =>
  r.status === "waiting" && now >= r.blockTime + v.retentionSecs;

/** Decide every waiting record whose facts have been gathered, then look for
 * clusters across the whole campaign. */
export function applyRetention(
  ledger: Ledger,
  facts: Record<string, RetentionFacts>,
  v: CampaignView,
  cfg: CampaignConfig,
): void {
  const payees = new Set<string>(v.channels.map((c) => c.payee));
  for (const [sig, f] of Object.entries(facts)) {
    const r = ledger.records[sig];
    if (!r || r.status !== "waiting") continue;
    r.funder = f.funder;
    r.funderBusy = f.funderBusy;
    if (!f.stayed) Object.assign(r, { status: "rejected", reason: "left before retention" });
    else if (f.funder && payees.has(f.funder)) Object.assign(r, { status: "rejected", reason: "funded by a channel" });
    else r.status = "qualified";
  }

  const byFunder = new Map<string, ConvRecord[]>();
  for (const r of Object.values(ledger.records)) {
    if (r.status === "rejected" || !r.funder || r.funderBusy) continue;
    byFunder.set(r.funder, [...(byFunder.get(r.funder) ?? []), r]);
  }
  for (const group of byFunder.values()) {
    if (group.length <= cfg.sybil.maxWalletsPerFunder) continue;
    for (const r of group) if (r.status === "qualified") Object.assign(r, { status: "rejected", reason: "wallet cluster" });
  }
}

// ── settling ─────────────────────────────────────────────────────────────────

/** Fold pending batches that have landed on chain into the ledger. */
export function reconcile(ledger: Ledger, v: CampaignView): void {
  for (const [key, p] of Object.entries(ledger.pending)) {
    if (v.channels[p.channel].batches > p.batch) {
      for (const s of p.signatures) Object.assign(ledger.records[s], { status: "settled", batch: p.batch });
      ledger.batches.push(p);
      delete ledger.pending[key];
    }
  }
}

/** What to send this run: pending batches again, unchanged, then one new
 * batch per other channel, oldest conversions first, as far as the budget
 * that is not yet committed or pending will stretch. */
export function planBatches(ledger: Ledger, v: CampaignView): Batch[] {
  const plans: Batch[] = Object.values(ledger.pending);
  const held = new Set(plans.map((p) => p.channel));
  const reserved = new Set(plans.flatMap((p) => p.signatures));
  let remaining = v.funded - v.committed - plans.reduce((n, p) => n + BigInt(p.signatures.length) * v.payout, 0n);

  const ready = Object.values(ledger.records)
    .filter((r) => r.status === "qualified" && r.channel !== null && !reserved.has(r.signature) && !held.has(r.channel))
    .sort((a, b) => a.blockTime - b.blockTime || a.signature.localeCompare(b.signature));

  const byChannel = new Map<number, string[]>();
  for (const r of ready) {
    if (remaining < v.payout) break;
    remaining -= v.payout;
    byChannel.set(r.channel!, [...(byChannel.get(r.channel!) ?? []), r.signature]);
  }
  for (const [channel, signatures] of byChannel) {
    plans.push({ channel, batch: v.channels[channel].batches, signatures, evidence: evidenceHex(signatures) });
  }
  return plans;
}

// ── receipts ─────────────────────────────────────────────────────────────────

export type Receipt = {
  channel: number;
  tagged: number;
  waiting: number;
  gone: number;
  flagged: number;
  otherRejected: number;
  qualified: number;
  settled: number;
  paid: bigint;
};

const FLAGGED = new Set<Reason>(["self-referral", "funded by a channel", "wallet cluster"]);

/** Per channel, the numbers on the landing page's receipt. */
export function receipts(ledger: Ledger, v: CampaignView): Receipt[] {
  return v.channels.map(({ index }) => {
    const rs = Object.values(ledger.records).filter((r) => r.channel === index);
    const count = (f: (r: ConvRecord) => boolean) => rs.filter(f).length;
    const settled = count((r) => r.status === "settled");
    return {
      channel: index,
      tagged: rs.length,
      waiting: count((r) => r.status === "waiting"),
      gone: count((r) => r.reason === "left before retention"),
      flagged: count((r) => !!r.reason && FLAGGED.has(r.reason)),
      otherRejected: count((r) => r.status === "rejected" && r.reason !== "left before retention" && !FLAGGED.has(r.reason!)),
      qualified: count((r) => r.status === "qualified"),
      settled,
      paid: BigInt(settled) * v.payout,
    };
  });
}
