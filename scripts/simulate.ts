/* A small, realistic crowd through the demo campaign's real links, so the
 * dashboard shows what the settler is for and not just that it works.
 *
 *   npx tsx scripts/simulate.ts [--base https://earnout.dev]
 *
 * The crowd:
 *   demo-alice  4 people who deposit and stay
 *               2 who deposit, then take their SOL back out before the
 *                 window closes (the settler should mark them gone)
 *   demo-bob    1 person who deposits and stays
 *               4 wallets that all deposit, funded by one fresh wallet (a
 *                 farm; the settler should flag the cluster)
 *
 * Everyone clicks the live link first (a real reference from the real link
 * service), then deposits 0.01 SOL with the tag, exactly as /demo does.
 * People are funded by the demo faucet, the way a judge would be; the farm
 * by its own new wallet, which the deploy wallet funds. Every key here is
 * made for the run and thrown away. Costs about 0.25 devnet SOL.
 *
 * Nothing is settled here: the scheduled settler does that once the
 * campaign's retention window has passed. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { decodeTagToken, tagInstructions, TAG_PARAM } from "../sdk/index.ts";
import { withRetry } from "../settler/chain.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "https://earnout.dev" } } });

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
});
const SOL = 1_000_000_000n;
const home = (f: string) => path.join(os.homedir(), ".config/solana", f);
const keyFrom = async (file: string) =>
  createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(label: string, ixs: Instruction[], payer: KeyPairSigner): Promise<string> {
  return withRetry(async () => {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const tx = await signTransactionMessageWithSigners(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(ixs, m),
      ),
    );
    await sendAndConfirm(tx as any, { commitment: "confirmed" });
    const sig = getSignatureFromTransaction(tx);
    console.log(`  ${label.padEnd(34)} ${short(sig)}`);
    return sig;
  });
}

const transfer = (from: KeyPairSigner, to: Address, amount: bigint) =>
  getTransferSolInstruction({ source: from, destination: to, amount: lamports(amount) });

/** Click the live link, as a person would, and keep the token it hands out. */
async function click(slug: string) {
  const res = await fetch(`${values.base}/r/${slug}/go`, { redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) throw new Error(`/r/${slug} answered ${res.status}`);
  const tag = decodeTagToken(new URL(location).searchParams.get(TAG_PARAM) ?? "");
  if (!tag) throw new Error(`/r/${slug} redirected without a tag; is the link service configured?`);
  return tag;
}

type Person = { slug: string; kind: "stays" | "leaves" | "farm"; key: KeyPairSigner };

async function main() {
  const registry = JSON.parse(fs.readFileSync(path.resolve("registry/devnet.json"), "utf8"));
  const [campaignAddress, campaign] = Object.entries(registry.campaigns)[0] as [string, any];
  const treasury = address(campaign.conversion.to);
  const deposit = BigInt(campaign.conversion.minLamports);

  const deployWallet = await keyFrom(home("id.json"));
  const faucet = await keyFrom(home("earnout-faucet-devnet.json"));
  const farmer = await generateKeyPairSigner();

  const people: Person[] = [];
  const add = async (slug: string, kind: Person["kind"], n: number) => {
    for (let i = 0; i < n; i++) people.push({ slug, kind, key: await generateKeyPairSigner() });
  };
  await add("demo-alice", "stays", 4);
  await add("demo-alice", "leaves", 2);
  await add("demo-bob", "stays", 1);
  await add("demo-bob", "farm", 4);

  console.log(`Campaign ${campaignAddress}, via ${values.base}`);
  console.log(`Treasury ${short(treasury)}, deposit ${Number(deposit) / 1e9} SOL\n`);

  // Funding: people from the faucet, the farm from one new wallet.
  const grant = SOL / 50n; // 0.02
  await send("faucet funds 7 people", people.filter((p) => p.kind !== "farm").map((p) => transfer(faucet, p.key.address, grant)), faucet);
  await send("deploy wallet funds the farmer", [transfer(deployWallet, farmer.address, SOL / 10n)], deployWallet);
  await send("farmer funds 4 wallets", people.filter((p) => p.kind === "farm").map((p) => transfer(farmer, p.key.address, grant)), farmer);

  // Everyone clicks, then deposits with the tag.
  for (const p of people) {
    const tag = await click(p.slug);
    await send(`${p.slug} ${p.kind.padEnd(6)} ${short(p.key.address)} deposits`, [transfer(p.key, treasury, deposit), ...tagInstructions(tag)], p.key);
    await sleep(400);
  }

  // The leavers take their money back out before the window closes.
  for (const p of people.filter((p) => p.kind === "leaves")) {
    await send(`${p.slug} leaver ${short(p.key.address)} withdraws`, [transfer(p.key, faucet.address, (grant - deposit) - 1_000_000n)], p.key);
  }

  console.log(`\nDone. The settler judges these once the ${campaign.name} window (10 minutes) has passed.`);
  console.log(`Watch ${values.base}/dashboard/${campaignAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
