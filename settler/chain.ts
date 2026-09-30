/* Everything the settler asks the chain, with retries, because the public
 * devnet endpoint answers 429 to anything brisk, and because a node a few
 * slots behind answers "no such transaction" for one that exists.
 *
 * Every read is at finalized commitment: a conversion the settler has
 * screened, or a balance it has judged, can never be rolled back under it.
 * With Alpenglow, finality on devnet arrives well under a second after a
 * transaction, so this costs nothing; under the old consensus it would add
 * the thirteen seconds a ten-minute pass can well afford. */

import {
  getBase64Encoder,
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__UNKNOWN,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  SOLANA_ERROR__TRANSACTION_ERROR__UNKNOWN,
  type Address,
  type Signature,
} from "@solana/kit";
import { channelAddress, decodeCampaign, decodeChannel } from "../sdk/program.ts";
import type { Rpc } from "../sdk/read.ts";
import type { CampaignConfig } from "./config.ts";
import type { CampaignView, ConvRecord, RetentionFacts } from "./core.ts";
import { parseTransaction, type ParsedTx, type RawTx } from "./parse.ts";

export type { Rpc } from "../sdk/read.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── retries ──────────────────────────────────────────────────────────────────

/** A condition a later try may not see: a node not caught up yet, a rate
 * limit, a dropped connection. */
export class Transient extends Error {}

const TRANSIENT = /429|too many|fetch failed|ECONNRESET|ETIMEDOUT|timeout|502|503|504|socket/i;
const errorText = (e: unknown) => `${(e as Error)?.message ?? e} ${String((e as { cause?: unknown })?.cause ?? "")}`;

export const isTransient = (e: unknown): boolean => e instanceof Transient || TRANSIENT.test(errorText(e));
export const isRateLimited = (e: unknown): boolean => /429|too many/i.test(errorText(e));

/** Run `fn` until it succeeds or `tries` are spent, backing off from 0.7s
 * to 10s, for errors `retryable` says are worth another go. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 7,
  retryable: (e: unknown) => boolean = isTransient,
): Promise<T> {
  let delay = 700;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !retryable(e)) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 10_000);
    }
  }
}

/** Whether a failed send was refused outright, so the transaction cannot
 * have changed anything: the program or the runtime rejected it, in
 * preflight or in the block. Anything else (a timeout, a lost connection,
 * an expired blockhash, "already processed") leaves the outcome unknown
 * until the chain is read again. Decided from kit's error codes, not from
 * message text, which changes between development and production builds. */
export function refusedByProgram(e: unknown): boolean {
  if (isSolanaError(e, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) return true;
  for (const x of [e, (e as { cause?: unknown })?.cause]) {
    if (!isSolanaError(x)) continue;
    const code = x.context.__code;
    if (code === SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED) return false;
    if (
      inFamily(code, SOLANA_ERROR__INSTRUCTION_ERROR__UNKNOWN) ||
      inFamily(code, SOLANA_ERROR__TRANSACTION_ERROR__UNKNOWN)
    )
      return true;
  }
  return false;
}

/** Kit numbers each family of errors from a base code up. */
const inFamily = (code: number, base: number) => code >= base && code < base + 1000;

// ── reads ────────────────────────────────────────────────────────────────────

/** The commitment every read here asks for; see the header. */
const READ = "finalized" as const;

const bytes = (b64: string) => getBase64Encoder().encode(b64) as Uint8Array;

export async function loadCampaignView(rpc: Rpc, campaign: Address): Promise<CampaignView> {
  const { value } = await withRetry(() =>
    rpc.getAccountInfo(campaign, { encoding: "base64", commitment: READ }).send(),
  );
  if (!value) throw new Error(`No campaign account at ${campaign}`);
  const c = decodeCampaign(bytes(value.data[0]));

  const addresses = await Promise.all(Array.from({ length: c.channels }, (_, i) => channelAddress(campaign, i)));
  const channels: CampaignView["channels"] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await withRetry(() => rpc.getMultipleAccounts(chunk, { encoding: "base64", commitment: READ }).send());
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
          commitment: READ,
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

/** One transaction, parsed, or null if the RPC does not have it. A node
 * that is behind answers null for a transaction that exists, so a null is
 * asked again (with backoff, `tries` times) before it is believed. */
export async function fetchParsed(rpc: Rpc, signature: string, tries = 7): Promise<ParsedTx | null> {
  try {
    const raw = await withRetry(async () => {
      const r = await rpc
        .getTransaction(signature as Signature, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          commitment: READ,
        })
        .send();
      if (!r) throw new Transient(`${signature} is not on this node yet`);
      return r;
    }, tries);
    return parseTransaction(raw as unknown as RawTx);
  } catch (e) {
    if (e instanceof Transient) return null;
    throw e;
  }
}

/** The first successful transaction ever to carry this reference. */
export async function firstUse(rpc: Rpc, reference: Address): Promise<string | null> {
  let before: string | undefined;
  let oldest: string | null = null;
  for (let page = 0; page < 5; page++) {
    const list = await withRetry(() =>
      rpc
        .getSignaturesForAddress(reference, {
          commitment: READ,
          limit: 1000,
          ...(before ? { before: before as Signature } : {}),
        })
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
        .getSignaturesForAddress(wallet, {
          commitment: READ,
          limit: 1000,
          ...(before ? { before: before as Signature } : {}),
        })
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
  const list = await withRetry(() =>
    rpc.getSignaturesForAddress(addr as Address, { limit: 1000, commitment: READ }).send(),
  );
  return list.length >= 1000;
}

/** How many of the wallet's successful transactions between `after` and
 * `until` (unix seconds) ran `program`. Pages back through the history
 * until it is older than `after` (three pages at most), looks inside the
 * ones in the window, and stops as soon as `enough` have been found: a
 * person who came back a few times is what this is for, and a wallet that
 * came back hundreds of times need not be read to the end. */
export async function programActivity(
  rpc: Rpc,
  wallet: Address,
  program: Address,
  after: number,
  until: number,
  enough = Infinity,
): Promise<number> {
  let count = 0;
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const list = await withRetry(() =>
      rpc
        .getSignaturesForAddress(wallet, {
          limit: 1000,
          commitment: READ,
          ...(before ? { before: before as Signature } : {}),
        })
        .send(),
    );
    for (const s of list) {
      if (s.err !== null || s.blockTime === null) continue;
      const t = Number(s.blockTime);
      if (t > until) continue;
      if (t <= after) return count;
      const tx = await fetchParsed(rpc, s.signature);
      if (tx?.programs.has(program) && ++count >= enough) return count;
    }
    if (list.length < 1000) break;
    before = list[list.length - 1].signature;
  }
  return count;
}

/** Lookups shared across one pass: who funded a wallet, and whether that
 * funder is busy, are the same answer for every wallet the funder sent. */
export type FactsCache = { funder: Map<string, Promise<string | null>>; busy: Map<string, Promise<boolean>> };
export const factsCache = (): FactsCache => ({ funder: new Map(), busy: new Map() });

function memo<T>(cache: Map<string, Promise<T>>, key: string, compute: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = compute();
    cache.set(key, p);
  }
  return p;
}

type ParsedTokenAccount = { parsed?: { info?: { tokenAmount?: { amount?: string } } } };

export async function retentionFacts(
  rpc: Rpc,
  r: ConvRecord,
  cfg: CampaignConfig,
  windowEnd: number,
  cache: FactsCache = factsCache(),
): Promise<RetentionFacts> {
  const wallet = r.wallet as Address;
  let stayed: boolean;
  if (cfg.retention.kind === "sol-balance") {
    const { value } = await withRetry(() => rpc.getBalance(wallet, { commitment: READ }).send());
    stayed = value >= cfg.retention.minLamports;
  } else if (cfg.retention.kind === "program-activity") {
    const { programId, minTransactions } = cfg.retention;
    stayed =
      (await programActivity(rpc, wallet, programId, r.blockTime, windowEnd, minTransactions)) >= minTransactions;
  } else {
    const mint = cfg.retention.mint;
    const { value } = await withRetry(() =>
      rpc.getTokenAccountsByOwner(wallet, { mint }, { encoding: "jsonParsed", commitment: READ }).send(),
    );
    const held = value.reduce((n, a) => {
      const data = a.account.data as unknown;
      const amount =
        typeof data === "object" && data !== null && "parsed" in data
          ? (data as ParsedTokenAccount).parsed?.info?.tokenAmount?.amount
          : undefined;
      return n + BigInt(amount ?? 0);
    }, 0n);
    stayed = held >= cfg.retention.minAmount;
  }
  const funder = await memo(cache.funder, wallet, () => funderOf(rpc, wallet));
  const funderBusy = funder ? await memo(cache.busy, funder, () => isBusy(rpc, funder)) : false;
  return { stayed, funder, funderBusy };
}
