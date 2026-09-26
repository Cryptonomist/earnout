/* Everything the settler asks the chain, with retries, because the public
 * devnet endpoint answers 429 to anything brisk. */

import {
  createSolanaRpc,
  getBase64Encoder,
  type Address,
  type Signature,
} from "@solana/kit";
import { channelAddress, decodeCampaign, decodeChannel } from "../sdk/program.ts";
import type { CampaignConfig } from "./config.ts";
import type { CampaignView, ConvRecord, RetentionFacts } from "./core.ts";
import { parseTransaction, type ParsedTx, type RawTx } from "./parse.ts";

export type Rpc = ReturnType<typeof createSolanaRpc>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /429|too many|fetch failed|ECONNRESET|ETIMEDOUT|timeout|502|503|504|socket/i;

export async function withRetry<T>(fn: () => Promise<T>, tries = 7): Promise<T> {
  let delay = 700;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const text = `${(e as Error)?.message ?? e} ${String((e as { cause?: unknown })?.cause ?? "")}`;
      if (i >= tries - 1 || !RETRYABLE.test(text)) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 10_000);
    }
  }
}

const bytes = (b64: string) => getBase64Encoder().encode(b64) as Uint8Array;

export async function loadCampaignView(rpc: Rpc, campaign: Address): Promise<CampaignView> {
  const { value } = await withRetry(() => rpc.getAccountInfo(campaign, { encoding: "base64", commitment: "confirmed" }).send());
  if (!value) throw new Error(`No campaign account at ${campaign}`);
  const c = decodeCampaign(bytes(value.data[0]));

  const addresses = await Promise.all(Array.from({ length: c.channels }, (_, i) => channelAddress(campaign, i)));
  const channels: CampaignView["channels"] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await withRetry(() => rpc.getMultipleAccounts(chunk, { encoding: "base64", commitment: "confirmed" }).send());
    res.value.forEach((acc, j) => {
      if (!acc) throw new Error(`Missing channel ${i + j}`);
      const ch = decodeChannel(bytes(acc.data[0]));
      channels.push({ index: ch.index, address: chunk[j], payee: ch.payee, batches: ch.batches });
    });
  }

  return {
    address: campaign,
    mint: c.mint,
    advertiser: c.advertiser,
    settler: c.settler,
    identity: c.identity,
    payout: c.payout,
    retentionSecs: c.retentionSecs,
    createdAt: Number(c.createdAt),
    endsAt: Number(c.endsAt),
    settleDeadline: Number(c.settleDeadline),
    funded: c.funded,
    committed: c.committed,
    channels,
  };
}

/** Signatures of successful transactions touching `address`, oldest first,
 * newer than `until`; and the newest one seen. */
export async function signaturesSince(rpc: Rpc, addr: Address, until: string | null) {
  const found: string[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await withRetry(() =>
      rpc
        .getSignaturesForAddress(addr, {
          commitment: "confirmed",
          limit: 1000,
          ...(before ? { before: before as Signature } : {}),
          ...(until ? { until: until as Signature } : {}),
        })
        .send(),
    );
    for (const s of page) if (s.err === null) found.push(s.signature);
    if (page.length < 1000) {
      const newest = found[0] ?? (page[0]?.signature as string | undefined) ?? until;
      return { signatures: found.reverse(), newest: newest ?? null };
    }
    before = page[page.length - 1].signature;
  }
}

export async function fetchParsed(rpc: Rpc, signature: string): Promise<ParsedTx | null> {
  const raw = await withRetry(() =>
    rpc
      .getTransaction(signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
      .send(),
  );
  return raw ? parseTransaction(raw as unknown as RawTx) : null;
}

/** The first successful transaction ever to carry this reference. */
export async function firstUse(rpc: Rpc, reference: Address): Promise<string | null> {
  let before: string | undefined;
  let oldest: string | null = null;
  for (let page = 0; page < 5; page++) {
    const list = await withRetry(() =>
      rpc
        .getSignaturesForAddress(reference, { commitment: "confirmed", limit: 1000, ...(before ? { before: before as Signature } : {}) })
        .send(),
    );
    for (const s of list) if (s.err === null) oldest = s.signature;
    if (list.length < 1000) return oldest;
    before = list[list.length - 1].signature;
  }
  return oldest;
}

/** Who first sent this wallet SOL, if its history is short enough to read
 * to the start (three pages). A long history means an old, busy wallet,
 * which is not what a farm looks like. */
export async function funderOf(rpc: Rpc, wallet: Address): Promise<string | null> {
  let before: string | undefined;
  let oldest: string | undefined;
  for (let page = 0; page < 3; page++) {
    const list = await withRetry(() =>
      rpc
        .getSignaturesForAddress(wallet, { commitment: "confirmed", limit: 1000, ...(before ? { before: before as Signature } : {}) })
        .send(),
    );
    if (!list.length) break;
    oldest = list[list.length - 1].signature;
    if (list.length < 1000) {
      const first = await fetchParsed(rpc, oldest);
      return first?.solMoves.find((m) => m.to === wallet && m.from !== wallet)?.from ?? null;
    }
    before = oldest;
  }
  return null;
}

/** A funder with a thousand or more transactions is a faucet, an exchange
 * or an app, and wallets sharing it prove nothing. */
export async function isBusy(rpc: Rpc, addr: string): Promise<boolean> {
  const list = await withRetry(() => rpc.getSignaturesForAddress(addr as Address, { limit: 1000 }).send());
  return list.length >= 1000;
}

/** How many of the wallet's transactions between `after` and `until`
 * (unix seconds) ran `program`. Reads the newest 50 and looks inside up to
 * 25 that fall in the window: a person who came back a few times is what
 * this is for, not a bot with hundreds. */
export async function programActivity(rpc: Rpc, wallet: Address, program: Address, after: number, until: number): Promise<number> {
  const list = await withRetry(() => rpc.getSignaturesForAddress(wallet, { limit: 50, commitment: "confirmed" }).send());
  const inWindow = list
    .filter((s) => s.err === null && s.blockTime !== null && Number(s.blockTime) > after && Number(s.blockTime) <= until)
    .slice(0, 25);
  let count = 0;
  for (const s of inWindow) {
    const tx = await fetchParsed(rpc, s.signature);
    if (tx?.programs.has(program)) count++;
  }
  return count;
}

export async function retentionFacts(rpc: Rpc, r: ConvRecord, cfg: CampaignConfig, windowEnd: number): Promise<RetentionFacts> {
  const wallet = r.wallet as Address;
  let stayed: boolean;
  if (cfg.retention.kind === "sol-balance") {
    const { value } = await withRetry(() => rpc.getBalance(wallet, { commitment: "confirmed" }).send());
    stayed = value >= cfg.retention.minLamports;
  } else if (cfg.retention.kind === "program-activity") {
    const times = await programActivity(rpc, wallet, cfg.retention.programId, r.blockTime, windowEnd);
    stayed = times >= cfg.retention.minTransactions;
  } else {
    const mint = cfg.retention.mint;
    const { value } = await withRetry(() =>
      rpc.getTokenAccountsByOwner(wallet, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }).send(),
    );
    const held = value.reduce(
      (n, a) => n + BigInt((a.account.data as any).parsed?.info?.tokenAmount?.amount ?? 0),
      0n,
    );
    stayed = held >= cfg.retention.minAmount;
  }
  const funder = await funderOf(rpc, wallet);
  return { stayed, funder, funderBusy: funder ? await isBusy(rpc, funder) : false };
}
