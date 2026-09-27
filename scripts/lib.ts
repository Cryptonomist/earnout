/* What every script needs and none should carry itself: the RPC and the
 * cluster from the environment, keypairs from files, one way to send a
 * transaction, the campaign read every script starts with, the registry
 * file, and the link click a simulated visitor makes. Node only (it reads
 * files); the browser SDK is sdk/ and stays free of this. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64Encoder,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { TAG_PARAM } from "../sdk/client.ts";
import { decodeTagToken, type Tag } from "../sdk/identity.ts";
import { decodeCampaign, type Campaign } from "../sdk/program.ts";
import type { Rpc } from "../sdk/read.ts";
import { isRateLimited, withRetry } from "../settler/chain.ts";
import { SLUG } from "../src/lib/rules.ts";
import type { LinkEntry } from "../src/server/links.ts";

export const CLUSTER = process.env.EARNOUT_CLUSTER ?? "devnet";
export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;
export const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A keypair as solana-keygen writes it: a JSON array of 64 bytes. */
export const loadKeypair = (file: string) =>
  createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));

/** A file in the Solana CLI's config directory; the deploy wallet by default. */
export const solanaConfig = (name = "id.json") => path.join(os.homedir(), ".config/solana", name);

export type Chain = {
  rpc: Rpc;
  /** Sign, send and confirm one transaction; returns its signature. The
   * blockhash fetch and a rate-limited send are retried. A send that timed
   * out is not, since it may have landed and would go out twice. A priority
   * fee is added unless `priority` is false. */
  send(ixs: Instruction[], payer: KeyPairSigner, opts?: { priority?: boolean }): Promise<string>;
};

export function chainFromEnv(): Chain {
  const rpc = createSolanaRpc(RPC_URL);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
  });
  return {
    rpc,
    async send(ixs, payer, { priority = true } = {}) {
      const { value: blockhash } = await withRetry(() => rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
      const tx = await signTransactionMessageWithSigners(
        pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(payer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
          (m) =>
            appendTransactionMessageInstructions(
              priority ? [getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ...ixs] : ixs,
              m,
            ),
        ),
      );
      assertIsTransactionWithBlockhashLifetime(tx);
      await withRetry(() => sendAndConfirm(tx, { commitment: "confirmed" }), 4, isRateLimited);
      return getSignatureFromTransaction(tx);
    },
  };
}

/** The campaign account, decoded; throws if there is none. */
export async function fetchCampaign(rpc: Rpc, campaign: Address): Promise<Campaign> {
  const { value } = await withRetry(() =>
    rpc.getAccountInfo(campaign, { encoding: "base64", commitment: "confirmed" }).send(),
  );
  if (!value) throw new Error(`No campaign at ${campaign}`);
  return decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array);
}

// ── the registry file ────────────────────────────────────────────────────────

/** A campaign's settler rules as registry/<cluster>.json holds them; the
 * settler checks the shape (settler/config.ts), the scripts only read the
 * deposit rule. */
export type RegistryCampaign = {
  name: string;
  conversion: { kind: string; to?: string; minLamports?: string; programId?: string };
  [rule: string]: unknown;
};

export type RegistryFile = { campaigns: Record<string, RegistryCampaign>; links: Record<string, LinkEntry> };

export const registryPath = (cluster = CLUSTER) => path.resolve("registry", `${cluster}.json`);

export function readRegistry(cluster = CLUSTER): RegistryFile {
  return JSON.parse(fs.readFileSync(registryPath(cluster), "utf8")) as RegistryFile;
}

export function writeRegistry(file: RegistryFile, cluster = CLUSTER): void {
  fs.writeFileSync(registryPath(cluster), JSON.stringify(file, null, 2) + "\n");
}

/** The link entry behind a slug, or an error naming the slug. */
export function linkFromRegistry(slug: string, cluster = CLUSTER): LinkEntry {
  const link = readRegistry(cluster).links[slug];
  if (!link) throw new Error(`No link /r/${slug} in registry/${cluster}.json`);
  return link;
}

/** Click a live link the way a visitor would (a real reference from the
 * real link service) and keep the tag it hands out. */
export async function clickLink(base: string, slug: string): Promise<Tag> {
  if (!SLUG.test(slug)) throw new Error(`Bad slug: ${slug}`);
  const res = await fetch(`${base}/r/${slug}/go`, { redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) throw new Error(`/r/${slug} answered ${res.status}`);
  const tag = decodeTagToken(new URL(location).searchParams.get(TAG_PARAM) ?? "");
  if (!tag) throw new Error(`/r/${slug} redirected without a tag; is the link service configured?`);
  return tag;
}
