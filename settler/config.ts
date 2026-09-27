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

/** The shape of the JSON before it is checked: anything at all. */
type Raw = Record<string, unknown>;

const obj = (v: unknown, what: string): Raw => {
  if (typeof v !== "object" || v === null) throw new Error(`${what} is missing`);
  return v as Raw;
};

/** A number-like field as text, for `address` and `BigInt` to check. */
const text = (v: unknown, what: string): string => {
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "bigint") throw new Error(`${what} is missing`);
  return String(v);
};

function conversion(r: Raw): ConversionRule {
  if (r.kind === "sol-transfer") {
    return {
      kind: "sol-transfer",
      to: address(text(r.to, "conversion.to")),
      minLamports: BigInt(text(r.minLamports, "conversion.minLamports")),
    };
  }
  if (r.kind === "program") return { kind: "program", programId: address(text(r.programId, "conversion.programId")) };
  throw new Error(`unknown conversion rule ${String(r.kind)}`);
}

function retention(r: Raw): RetentionRule {
  if (r.kind === "sol-balance")
    return { kind: "sol-balance", minLamports: BigInt(text(r.minLamports, "retention.minLamports")) };
  if (r.kind === "token-balance") {
    return {
      kind: "token-balance",
      mint: address(text(r.mint, "retention.mint")),
      minAmount: BigInt(text(r.minAmount, "retention.minAmount")),
    };
  }
  if (r.kind === "program-activity") {
    const min = Number(r.minTransactions ?? 1);
    if (!(min >= 1)) throw new Error("program-activity needs minTransactions of at least 1");
    return {
      kind: "program-activity",
      programId: address(text(r.programId, "retention.programId")),
      minTransactions: min,
    };
  }
  throw new Error(`unknown retention rule ${String(r.kind)}`);
}

export function parseCampaigns(raw: Record<string, Raw>): CampaignConfig[] {
  return Object.entries(raw).map(([key, c]) => {
    const sybil = (c.sybil ?? {}) as Raw;
    const window = Number(c.attributionWindowSecs ?? 7 * 86_400);
    const max = Number(sybil.maxWalletsPerFunder ?? 3);
    if (!(window > 0) || !(max >= 1)) throw new Error(`campaign ${key}: bad window or sybil limit`);
    const ignore = Array.isArray(sybil.ignoreFunders) ? sybil.ignoreFunders : [];
    return {
      campaign: address(key),
      name: String(c.name ?? key),
      conversion: conversion(obj(c.conversion, "conversion")),
      retention: retention(obj(c.retention, "retention")),
      attributionWindowSecs: window,
      sybil: { maxWalletsPerFunder: max, ignoreFunders: ignore.map((a) => address(text(a, "sybil.ignoreFunders"))) },
    };
  });
}
