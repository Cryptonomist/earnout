/* Run the settler over every campaign in the registry, or one.
 *
 *   npx tsx --env-file=.env.local scripts/settle.ts             one pass
 *   npx tsx --env-file=.env.local scripts/settle.ts --dry-run   decide, send nothing, save nothing
 *   npx tsx --env-file=.env.local scripts/settle.ts --watch 60  a pass every 60 seconds
 *   ... --campaign <address>                                    just that campaign
 *
 * Each pass: fold in batches that landed, read new tagged transactions and
 * screen them, check wallets whose retention window has closed, then settle
 * each channel's qualified conversions as its next batch. State lives in
 * var/settler/<cluster>/<campaign>.json (gitignored): which wallet came
 * through which channel is exactly what the chain is kept from knowing.
 *
 * The settler key is SETTLER_KEYPAIR (a solana-keygen file), or the deploy
 * wallet at ~/.config/solana/id.json. It must be the campaign's settler. */

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
  getBase64Encoder,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { settleIx } from "../sdk/program.ts";
import { referenceKeys } from "../sdk/reference.ts";
import { loadSecrets } from "../src/server/links.ts";
import { loadCampaigns, type CampaignConfig } from "../settler/config.ts";
import {
  admit,
  applyRetention,
  due,
  emptyLedger,
  planBatches,
  receipts,
  reconcile,
  screen,
  type Batch,
  type CampaignView,
  type ConvRecord,
  type Ledger,
  type RetentionFacts,
} from "../settler/core.ts";
import { fetchParsed, firstUse, loadCampaignView, retentionFacts, signaturesSince, withRetry, type Rpc } from "../settler/chain.ts";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    watch: { type: "string" },
  },
});

const CLUSTER = process.env.EARNOUT_CLUSTER ?? "devnet";
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const DRY = values["dry-run"]!;
const STATE = path.resolve("var/settler", CLUSTER);
const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
});
const log = (s = "") => console.log(s);
const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;

// ── ledger files ─────────────────────────────────────────────────────────────

const ledgerPath = (campaign: string) => path.join(STATE, `${campaign}.json`);

function loadLedger(campaign: string): Ledger {
  const p = ledgerPath(campaign);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Ledger) : emptyLedger(campaign);
}

/* Written to a temporary file and renamed, so a crash never leaves half a
 * ledger. Skipped entirely on a dry run. */
function saveLedger(ledger: Ledger) {
  if (DRY) return;
  fs.mkdirSync(STATE, { recursive: true });
  const p = ledgerPath(ledger.campaign);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(ledger, null, 2) + "\n");
  fs.renameSync(`${p}.tmp`, p);
}

// ── one campaign ─────────────────────────────────────────────────────────────

async function mintDecimals(mint: Address): Promise<number> {
  const { value } = await withRetry(() => rpc.getAccountInfo(mint, { encoding: "base64" }).send());
  return value ? (getBase64Encoder().encode(value.data[0]) as Uint8Array)[44] : 0;
}

async function sendBatch(settler: KeyPairSigner, v: CampaignView, b: Batch): Promise<string> {
  const { value: blockhash } = await withRetry(() => rpc.getLatestBlockhash().send());
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(settler, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstructions(
          [
            getSetComputeUnitPriceInstruction({ microLamports: 20_000n }),
            settleIx({
              settler,
              campaign: v.address,
              channel: v.channels[b.channel].address,
              batch: b.batch,
              conversions: b.signatures.length,
              evidence: Uint8Array.from(Buffer.from(b.evidence, "hex")),
            }),
          ],
          m,
        ),
    ),
  );
  await sendAndConfirm(tx as any, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

async function runCampaign(cfg: CampaignConfig, settler: KeyPairSigner, secret: Uint8Array, slugs: Map<string, string>) {
  const ledger = loadLedger(cfg.campaign);
  const v = await loadCampaignView(rpc, cfg.campaign);
  const keys = referenceKeys(secret, cfg.campaign);
  const decimals = await mintDecimals(v.mint);
  const amount = (n: bigint) => (Number(n) / 10 ** decimals).toFixed(2);

  log(`\n${cfg.name}  ${cfg.campaign}`);
  log(`  pays ${amount(v.payout)} per user who stays ${Math.round(v.retentionSecs / 60)} min; ${amount(v.funded - v.committed)} of ${amount(v.funded)} uncommitted`);

  reconcile(ledger, v);

  // New tagged transactions, oldest first.
  const { signatures, newest } = await signaturesSince(rpc, cfg.campaign, ledger.cursor);
  for (const sig of signatures) {
    const known = ledger.records[sig];
    if (known) continue;
    const tx = await fetchParsed(rpc, sig);
    if (!tx) continue;
    const rec = await screen(tx, v, cfg, keys, (ref) => firstUse(rpc, ref));
    if (!rec) continue;
    admit(ledger, rec);
    const r: ConvRecord = ledger.records[sig];
    const where = r.channel === null ? "?" : slugs.get(`${cfg.campaign}:${r.channel}`) ?? `channel ${r.channel}`;
    log(`  found  ${short(sig)}  ${short(r.wallet)} via ${where}: ${r.status}${r.reason ? `, ${r.reason}` : ""}`);
  }
  ledger.cursor = newest;

  // Wallets whose window has closed.
  const now = Math.floor(Date.now() / 1000);
  const facts: Record<string, RetentionFacts> = {};
  for (const r of Object.values(ledger.records)) if (due(r, v, now)) facts[r.signature] = await retentionFacts(rpc, r, cfg);
  applyRetention(ledger, facts, v, cfg);
  for (const sig of Object.keys(facts)) {
    const r = ledger.records[sig];
    log(`  window closed for ${short(r.wallet)}: ${r.status}${r.reason ? `, ${r.reason}` : ""}${r.funder ? ` (funded by ${short(r.funder)})` : ""}`);
  }
  saveLedger(ledger);

  // Settle.
  const plans = planBatches(ledger, v);
  if (plans.length && now > v.settleDeadline) {
    log("  the settle deadline has passed; nothing more can be settled");
  } else if (plans.length && settler.address !== v.settler) {
    log(`  this key (${short(settler.address)}) is not the campaign's settler (${short(v.settler)}); not sending`);
  } else {
    for (const b of plans) {
      const who = slugs.get(`${cfg.campaign}:${b.channel}`) ?? `channel ${b.channel}`;
      log(`  settle ${who} batch ${b.batch}: ${b.signatures.length} conversion(s), ${amount(BigInt(b.signatures.length) * v.payout)}, evidence ${b.evidence.slice(0, 12)}...`);
      if (DRY) continue;
      ledger.pending[b.channel] = b;
      saveLedger(ledger);
      try {
        b.tx = await sendBatch(settler, v, b);
        for (const s of b.signatures) Object.assign(ledger.records[s], { status: "settled", batch: b.batch });
        ledger.batches.push(b);
        delete ledger.pending[b.channel];
        v.channels[b.channel].batches += 1;
        v.committed += BigInt(b.signatures.length) * v.payout;
        log(`    https://explorer.solana.com/tx/${b.tx}?cluster=${CLUSTER}`);
      } catch (e) {
        const text = `${(e as Error).message} ${String((e as { cause?: unknown }).cause ?? "")}`;
        // A program error means the batch was refused whole; replan next run.
        // Anything else may have landed; keep it pending for the chain to say.
        if (/custom program error|Error Code|InstructionError/i.test(text)) delete ledger.pending[b.channel];
        log(`    not settled: ${(e as Error).message}`);
      }
      saveLedger(ledger);
    }
  }

  // Receipts.
  for (const r of receipts(ledger, v)) {
    if (!r.tagged) continue;
    const who = slugs.get(`${cfg.campaign}:${r.channel}`) ?? `channel ${r.channel}`;
    log(`  receipt ${who}: tagged ${r.tagged}, waiting ${r.waiting}, gone ${r.gone}, flagged ${r.flagged}, other ${r.otherRejected}, qualified ${r.qualified}, settled ${r.settled}, paid ${amount(r.paid)}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function pass() {
  const { referenceSecret } = await loadSecrets();
  const keyFile = process.env.SETTLER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  const settler = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8"))));
  const file = JSON.parse(fs.readFileSync(path.resolve("registry", `${CLUSTER}.json`), "utf8"));
  const slugs = new Map<string, string>(
    Object.entries(file.links ?? {}).map(([slug, e]: [string, any]) => [`${e.campaign}:${e.channel}`, slug]),
  );
  const campaigns = loadCampaigns(CLUSTER).filter((c) => !values.campaign || c.campaign === address(values.campaign));
  if (!campaigns.length) throw new Error("No matching campaign in the registry");
  for (const c of campaigns) await runCampaign(c, settler, referenceSecret, slugs);
}

async function main() {
  if (!values.watch) return pass();
  const every = Number(values.watch) * 1000;
  for (;;) {
    await pass().catch((e) => console.error(`pass failed: ${(e as Error).message}`));
    await new Promise((r) => setTimeout(r, every));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
