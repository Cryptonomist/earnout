/* A campaign's rules, as the settler reads them from the registry: the
 * `campaigns` section of registry/<cluster>.json, or a row the dashboard
 * wrote (settler/registry.ts reads both).
 *
 * The program knows a campaign's money and dates. What counts as a
 * conversion, and what "stayed" means, depend on the partner's product, so
 * they live here: a deposit of at least so much into this treasury; still
 * holding so much when the window closes. */

import { address, type Address } from "@solana/kit";

export type ConversionRule =
  /** The converting wallet sent at least this much SOL to `to`. */
  | { kind: "sol-transfer"; to: Address; minLamports: bigint }
  /** The transaction invoked this program (the partner's deposit, say). */
  | { kind: "program"; programId: Address };

export type RetentionRule =
  /** The wallet still holds at least this much SOL. */
  | { kind: "sol-balance"; minLamports: bigint }
  /** The wallet still holds at least this much of a token (a receipt or LP
   * token, say): the position is still open. */
  | { kind: "token-balance"; mint: Address; minAmount: bigint }
  /** The wallet used this program again, at least this many times, after
   * converting and before the window closed: it came back. For games and
   * apps where "staying" means playing, not holding. */
  | { kind: "program-activity"; programId: Address; minTransactions: number };

export type CampaignConfig = {
  campaign: Address;
  name: string;
  conversion: ConversionRule;
  retention: RetentionRule;
  /** How long after a click a conversion still counts. */
  attributionWindowSecs: number;
  sybil: {
    /** More converting wallets than this funded by one quiet source is a
     * cluster. Busy sources (faucets, exchanges) are never counted. */
    maxWalletsPerFunder: number;
    /** Funders known to fund many unrelated wallets, never counted as a
     * cluster: the demo's own faucet, say. Each one listed is a way around
     * the cluster check, so a real campaign lists none it does not run. */
    ignoreFunders: string[];
  };
};

type Raw = Record<string, any>;

function conversion(r: Raw): ConversionRule {
  if (r.kind === "sol-transfer") return { kind: r.kind, to: address(r.to), minLamports: BigInt(r.minLamports) };
  if (r.kind === "program") return { kind: r.kind, programId: address(r.programId) };
  throw new Error(`unknown conversion rule ${r.kind}`);
}

function retention(r: Raw): RetentionRule {
  if (r.kind === "sol-balance") return { kind: r.kind, minLamports: BigInt(r.minLamports) };
  if (r.kind === "token-balance") return { kind: r.kind, mint: address(r.mint), minAmount: BigInt(r.minAmount) };
  if (r.kind === "program-activity") {
    const min = Number(r.minTransactions ?? 1);
    if (!(min >= 1)) throw new Error("program-activity needs minTransactions of at least 1");
    return { kind: r.kind, programId: address(r.programId), minTransactions: min };
  }
  throw new Error(`unknown retention rule ${r.kind}`);
}

export function parseCampaigns(raw: Record<string, Raw>): CampaignConfig[] {
  return Object.entries(raw).map(([key, c]) => {
    const window = Number(c.attributionWindowSecs ?? 7 * 86_400);
    const max = Number(c.sybil?.maxWalletsPerFunder ?? 3);
    if (!(window > 0) || !(max >= 1)) throw new Error(`campaign ${key}: bad window or sybil limit`);
    return {
      campaign: address(key),
      name: String(c.name ?? key),
      conversion: conversion(c.conversion),
      retention: retention(c.retention),
      attributionWindowSecs: window,
      sybil: { maxWalletsPerFunder: max, ignoreFunders: ((c.sybil?.ignoreFunders ?? []) as string[]).map((a) => address(a)) },
    };
  });
}
