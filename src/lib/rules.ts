/* A campaign's rules, as the advertiser writes them in the hub and the
 * settler reads them back.
 *
 * The program holds the money and the dates. What counts as a conversion,
 * and what "stayed" means, depend on the partner's product, so they live off
 * chain in the registry (settler/config.ts reads this same shape). To keep
 * them honest, the advertiser commits to them on chain: the transaction that
 * creates the campaign carries a memo with the hash of the canonical form
 * below, and the site records the rules only when that memo matches. Anyone
 * can recompute the hash from the published rules and check it against the
 * transaction. Rules are final; there is no update, because rules that can
 * change after KOLs start sending people are not rules.
 *
 * Pure and small, so the browser hashes exactly what the server checks. */

import { isAddress } from "@solana/kit";

export type ConversionRule =
  /** The converting wallet sent at least this much SOL to `to`. */
  | { kind: "sol-transfer"; to: string; minLamports: string }
  /** The transaction invoked this program. */
  | { kind: "program"; programId: string };

export type RetentionRule =
  /** The wallet still holds at least this much SOL when the window closes. */
  | { kind: "sol-balance"; minLamports: string }
  /** The wallet still holds at least this much of a token. */
  | { kind: "token-balance"; mint: string; minAmount: string }
  /** The wallet used this program again, at least this many times. */
  | { kind: "program-activity"; programId: string; minTransactions: number };

export type Rules = {
  /** Printed on every disclosure page and receipt. */
  name: string;
  description: string;
  /** Where the campaign's links send people: an https URL, or a path on this site. */
  destination: string;
  conversion: ConversionRule;
  retention: RetentionRule;
  /** How long after a click a conversion still counts. */
  attributionWindowSecs: number;
  sybil: {
    /** More converting wallets than this from one quiet funder is a cluster. */
    maxWalletsPerFunder: number;
    /** Funders never counted as a cluster: a faucet the campaign itself runs. */
    ignoreFunders: string[];
  };
};

export const LIMITS = {
  name: 48,
  description: 400,
  attributionWindowSecs: { min: 600, max: 90 * 86_400 },
  maxWalletsPerFunder: { min: 1, max: 100 },
  ignoreFunders: 20,
  minTransactions: { min: 1, max: 1_000 },
} as const;

export class RulesError extends Error {}

function fail(message: string): never {
  throw new RulesError(message);
}

const text = (v: unknown, what: string): string => (typeof v === "string" ? v : fail(`${what} must be text`));

const solanaAddress = (v: unknown, what: string): string => {
  const s = text(v, what).trim();
  return isAddress(s) ? s : fail(`${what} is not a Solana address`);
};

/** Base units as a decimal string; a bigint does not survive JSON. */
const baseUnits = (v: unknown, what: string): string => {
  const s = String(v ?? "").trim();
  return /^[0-9]{1,20}$/.test(s) && BigInt(s) > 0n ? BigInt(s).toString() : fail(`${what} must be a whole number of base units above zero`);
};

const whole = (v: unknown, what: string, min: number, max: number): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fail(`${what} must be a whole number from ${min} to ${max}`);
};

/** An https URL with nothing in it that could carry a credential, or a
 * path on this site (the demo partner lives at /demo). */
export function validDestination(raw: string): string {
  const d = raw.trim();
  if (d.startsWith("/")) {
    if (d.startsWith("//") || /[\s\\<>"']/.test(d)) fail("The destination path has characters a link cannot carry");
    return d;
  }
  let url: URL;
  try {
    url = new URL(d);
  } catch {
    return fail("The destination must be an https URL, like https://app.example.com/deposit");
  }
  if (url.protocol !== "https:") fail("The destination must use https");
  if (url.username || url.password) fail("The destination must not carry a username or password");
  return url.toString();
}

function conversion(raw: unknown): ConversionRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.kind === "sol-transfer") {
    return { kind: "sol-transfer", to: solanaAddress(r.to, "The deposit address"), minLamports: baseUnits(r.minLamports, "The deposit size") };
  }
  if (r.kind === "program") return { kind: "program", programId: solanaAddress(r.programId, "The program id") };
  return fail("Pick what counts as a conversion");
}

function retention(raw: unknown): RetentionRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.kind === "sol-balance") return { kind: "sol-balance", minLamports: baseUnits(r.minLamports, "The SOL a wallet must keep") };
  if (r.kind === "token-balance") {
    return { kind: "token-balance", mint: solanaAddress(r.mint, "The token mint"), minAmount: baseUnits(r.minAmount, "The token amount a wallet must keep") };
  }
  if (r.kind === "program-activity") {
    return {
      kind: "program-activity",
      programId: solanaAddress(r.programId, "The program id"),
      minTransactions: whole(r.minTransactions ?? 1, "The number of return visits", LIMITS.minTransactions.min, LIMITS.minTransactions.max),
    };
  }
  return fail("Pick what counts as staying");
}

/** Checks and normalises a rules object. Idempotent: validating the result
 * again returns an identical object, so the browser and the server hash the
 * same bytes. Throws a RulesError with a sentence a person can act on. */
export function validateRules(raw: unknown): Rules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Rules must be an object");
  const r = raw as Record<string, unknown>;

  const name = text(r.name ?? "", "The name").trim().replace(/\s+/g, " ");
  if (!name || name.length > LIMITS.name) fail(`The name must be 1 to ${LIMITS.name} characters`);
  const description = text(r.description ?? "", "The description").trim().replace(/\s+/g, " ");
  if (description.length > LIMITS.description) fail(`The description must be at most ${LIMITS.description} characters`);
  const destination = validDestination(text(r.destination ?? "", "The destination"));

  const sybil = (r.sybil ?? {}) as Record<string, unknown>;
  const funders = Array.isArray(sybil.ignoreFunders) ? sybil.ignoreFunders : [];
  if (funders.length > LIMITS.ignoreFunders) fail(`List at most ${LIMITS.ignoreFunders} funders to ignore`);
  const ignoreFunders = [...new Set(funders.map((f) => solanaAddress(f, "An ignored funder")))].sort();

  return {
    name,
    description,
    destination,
    conversion: conversion(r.conversion),
    retention: retention(r.retention),
    attributionWindowSecs: whole(r.attributionWindowSecs ?? 7 * 86_400, "The attribution window, in seconds", LIMITS.attributionWindowSecs.min, LIMITS.attributionWindowSecs.max),
    sybil: {
      maxWalletsPerFunder: whole(sybil.maxWalletsPerFunder ?? 3, "The wallets-per-funder limit", LIMITS.maxWalletsPerFunder.min, LIMITS.maxWalletsPerFunder.max),
      ignoreFunders,
    },
  };
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** The bytes that are hashed: keys sorted at every level, no whitespace. */
export function canonicalRules(rules: Rules): string {
  return JSON.stringify(sorted(rules));
}

export async function rulesHash(rules: Rules): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRules(rules)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── what goes in the memos ───────────────────────────────────────────────────

export const RULES_MEMO_PREFIX = "earnout:rules:v1:";
export const LINK_MEMO_PREFIX = "earnout:link:v1:";
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const rulesMemo = (hash: string) => `${RULES_MEMO_PREFIX}${hash}`;

export function parseRulesMemo(memo: string): string | null {
  const m = /^earnout:rules:v1:([0-9a-f]{64})$/.exec(memo.trim());
  return m ? m[1] : null;
}

export const linkMemo = (campaign: string, index: number, slug: string) => `${LINK_MEMO_PREFIX}${campaign}:${index}:${slug}`;

export function parseLinkMemo(memo: string): { campaign: string; index: number; slug: string } | null {
  const m = /^earnout:link:v1:([1-9A-HJ-NP-Za-km-z]{32,44}):([0-9]{1,6}):([a-z0-9][a-z0-9-]{0,63})$/.exec(memo.trim());
  if (!m || !isAddress(m[1])) return null;
  return { campaign: m[1], index: Number(m[2]), slug: m[3] };
}

/** A link slug for a KOL on a campaign: "stonk-wars-cryptonomist". */
export function slugFor(campaignName: string, handle: string): string {
  const part = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const slug = [part(campaignName), part(handle)]
    .filter(Boolean)
    .join("-")
    .slice(0, 64)
    .replace(/-+$/, "");
  return SLUG.test(slug) ? slug : part(handle) || "channel";
}

// ── in words ─────────────────────────────────────────────────────────────────

const shortAddr = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
const solText = (lamports: string) => `${(Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`;

export function describeConversion(c: ConversionRule): string {
  return c.kind === "sol-transfer"
    ? `sends at least ${solText(c.minLamports)} to ${shortAddr(c.to)}`
    : `makes a transaction with program ${shortAddr(c.programId)}`;
}

export function describeRetention(r: RetentionRule): string {
  if (r.kind === "sol-balance") return `still holds at least ${solText(r.minLamports)}`;
  if (r.kind === "token-balance") return `still holds at least ${r.minAmount} base units of ${shortAddr(r.mint)}`;
  return `has used program ${shortAddr(r.programId)} at least ${r.minTransactions} more time${r.minTransactions === 1 ? "" : "s"}`;
}
