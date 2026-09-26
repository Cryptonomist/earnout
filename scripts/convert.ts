/* A few people come through one live link and convert, the way a visitor
 * would: click the link (a real reference from the real link service), then
 * make the campaign's deposit with the tag on it. For seeding a campaign
 * made from the hub, or a video.
 *
 *   npx tsx --env-file=.env.local scripts/convert.ts --slug hub-test-crypt0nomist [--stay 2] [--leave 1]
 *
 * Every wallet is made for the run and funded by the demo faucet key (the
 * campaign lists it as a funder to ignore, so the cluster check leaves
 * these alone). Leavers take their SOL back out at once, so they fail the
 * stay check. The campaign's deposit rule is read from the registry:
 * Supabase for a hub campaign, registry/devnet.json for a pilot. Nothing is
 * settled here; the scheduled settler does that after the stay period. */

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
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/server/db.ts";

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    stay: { type: "string", default: "1" },
    leave: { type: "string", default: "0" },
    base: { type: "string", default: "https://earnout.dev" },
  },
});

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
});
const GRANT = 20_000_000n; // 0.02 SOL each: the deposit, fees, and the 0.005 to keep
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
    console.log(`  ${label.padEnd(36)} ${short(sig)}`);
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

type Deposit = { campaign: string; name: string; treasury: Address; lamports: bigint };

/** What the campaign behind a slug pays for: a SOL deposit of at least so
 * much to its treasury. Hub campaigns are in Supabase, pilots in the file. */
async function depositRule(slug: string): Promise<Deposit> {
  const rule = (campaign: string, name: string, conversion: { kind: string; to?: string; minLamports?: string }): Deposit => {
    if (conversion.kind !== "sol-transfer" || !conversion.to) throw new Error(`${name} pays for program use, not a deposit; this script only deposits`);
    return { campaign, name, treasury: address(conversion.to), lamports: BigInt(conversion.minLamports ?? "0") };
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/links?slug=eq.${slug}&select=campaign,campaigns(name,rules)`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
  });
  const rows = res.ok ? ((await res.json()) as { campaign: string; campaigns: { name: string; rules: { conversion: never } } }[]) : [];
  if (rows[0]) return rule(rows[0].campaign, rows[0].campaigns.name, rows[0].campaigns.rules.conversion);

  const file = JSON.parse(fs.readFileSync(path.resolve("registry/devnet.json"), "utf8"));
  const link = file.links?.[slug];
  if (!link) throw new Error(`No link /r/${slug} in Supabase or registry/devnet.json`);
  const c = file.campaigns[link.campaign];
  return rule(link.campaign, c.name, c.conversion);
}

async function main() {
  if (!values.slug) throw new Error("Give --slug <slug>");
  const stay = Number(values.stay);
  const leave = Number(values.leave);
  if (!(stay >= 0 && leave >= 0 && stay + leave > 0)) throw new Error("--stay and --leave must be counts, at least one of them above zero");

  const d = await depositRule(values.slug);
  const faucet = await keyFrom(home("earnout-faucet-devnet.json"));
  const people = await Promise.all(Array.from({ length: stay + leave }, async (_, i) => ({ kind: i < stay ? "stays" : "leaves", key: await generateKeyPairSigner() })));

  console.log(`${d.name} (${d.campaign}) via ${values.base}/r/${values.slug}`);
  console.log(`Deposit ${Number(d.lamports) / 1e9} SOL to ${short(d.treasury)}; ${stay} stay, ${leave} leave\n`);

  await send(`faucet funds ${people.length} wallet(s)`, people.map((p) => transfer(faucet, p.key.address, GRANT)), faucet);
  for (const p of people) {
    const tag = await click(values.slug);
    await send(`${p.kind.padEnd(6)} ${short(p.key.address)} deposits`, [transfer(p.key, d.treasury, d.lamports), ...tagInstructions(tag)], p.key);
    await sleep(400);
  }
  for (const p of people.filter((p) => p.kind === "leaves")) {
    await send(`leaver ${short(p.key.address)} withdraws`, [transfer(p.key, faucet.address, GRANT - d.lamports - 1_000_000n)], p.key);
  }

  console.log(`\nDone. The settler judges these after the stay period. Watch ${values.base}/dashboard/${d.campaign}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
