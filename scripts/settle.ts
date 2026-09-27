/* Run the settler over every campaign in the registry, or one.
 *
 *   npx tsx --env-file=.env.local scripts/settle.ts             one pass
 *   npx tsx --env-file=.env.local scripts/settle.ts --dry-run   decide, send nothing, save nothing
 *   npx tsx --env-file=.env.local scripts/settle.ts --watch 60  a pass every 60 seconds
 *   ... --campaign <address>                                    just that campaign
 *
 * Each pass: fold in batches that landed, read new tagged transactions and
 * screen them, check wallets whose retention window has closed, then settle
 * each channel's qualified conversions as its next batch, and publish the
 * dashboard's report. The ledger (which wallet came through which channel,
 * exactly what the chain is kept from knowing) lives in the earnout
 * Supabase project's private `ledgers` table when SUPABASE_URL and
 * SUPABASE_SECRET_KEY are set, else in var/settler/<cluster>/ (gitignored).
 *
 * The settler key is SETTLER_KEYPAIR_JSON, SETTLER_KEYPAIR (a keyfile), or
 * the deploy wallet at ~/.config/solana/id.json. It must be the campaign's
 * settler. */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { address, createKeyPairSignerFromBytes, getBase64Encoder, type Address, type KeyPairSigner } from "@solana/kit";
import { settleIx } from "../sdk/program.ts";
import { referenceKeys } from "../sdk/reference.ts";
import { loadReferenceSecret } from "../src/server/links.ts";
import type { CampaignConfig } from "../settler/config.ts";
import { loadRegistry } from "../settler/registry.ts";
import {
  admit,
  applyRetention,
  due,
  planBatches,
  receipts,
  reconcile,
  screen,
  type Batch,
  type CampaignView,
  type ConvRecord,
  type RetentionFacts,
} from "../settler/core.ts";
import {
  factsCache,
  fetchParsed,
  firstUse,
  loadCampaignView,
  refusedByProgram,
  retentionFacts,
  signaturesSince,
  withRetry,
} from "../settler/chain.ts";
import { storeFromEnv } from "../settler/store.ts";
import { buildReport } from "../src/lib/report.ts";
import { chainFromEnv, CLUSTER, explorerTx, short, solanaConfig } from "./lib.ts";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    watch: { type: "string" },
  },
});

const DRY = values["dry-run"]!;
const STATE = path.resolve("var/settler", CLUSTER);
const chain = chainFromEnv();
const { rpc } = chain;
const log = (s = "") => console.log(s);

// ── state ────────────────────────────────────────────────────────────────────

/* The ledger lives in Supabase when SUPABASE_URL and SUPABASE_SECRET_KEY are
 * set, otherwise in var/settler; see settler/store.ts. A dry run reads it
 * and writes nothing. */
const store = storeFromEnv(CLUSTER, STATE);

// ── one campaign ─────────────────────────────────────────────────────────────

async function mintDecimals(mint: Address): Promise<number> {
  const { value } = await withRetry(() => rpc.getAccountInfo(mint, { encoding: "base64" }).send());
  return value ? (getBase64Encoder().encode(value.data[0]) as Uint8Array)[44] : 0;
}

function sendBatch(settler: KeyPairSigner, v: CampaignView, b: Batch): Promise<string> {
  const ix = settleIx({
    settler,
    campaign: v.address,
    channel: v.channels[b.channel].address,
    batch: b.batch,
    conversions: b.signatures.length,
    evidence: Uint8Array.from(Buffer.from(b.evidence, "hex")),
  });
  return chain.send([ix], settler);
}

async function runCampaign(
  cfg: CampaignConfig,
  settler: KeyPairSigner,
  secret: Uint8Array,
  slugs: Map<string, string>,
) {
  const loaded = await store.load(cfg.campaign);
  const ledger = loaded.ledger;
  let version = loaded.version;
  const saveLedger = async () => {
    if (!DRY) version = await store.save(ledger, version);
  };
  const v = await loadCampaignView(rpc, cfg.campaign);
  const keys = referenceKeys(secret, cfg.campaign);
  const decimals = await mintDecimals(v.mint);
  const amount = (n: bigint) => (Number(n) / 10 ** decimals).toFixed(2);
  const who = (channel: number) => slugs.get(`${cfg.campaign}:${channel}`) ?? `channel ${channel}`;

  log(`\n${cfg.name}  ${cfg.campaign}`);
  log(
    `  pays ${amount(v.payout)} per user who stays ${Math.round(v.retentionSecs / 60)} min; ${amount(v.funded - v.committed)} of ${amount(v.funded)} uncommitted`,
  );

  reconcile(ledger, v);

  // New tagged transactions, oldest first. The cursor moves past them all
  // at the end, so a transaction the RPC would not give up even after the
  // retries is logged and left behind rather than blocking the campaign.
  const { signatures, newest } = await signaturesSince(rpc, cfg.campaign, ledger.cursor);
  for (const sig of signatures) {
    if (ledger.records[sig]) continue;
    const tx = await fetchParsed(rpc, sig);
    if (!tx) {
      log(`  skipped ${short(sig)}: the RPC never returned it; look it up by hand if it was a conversion`);
      continue;
    }
    const rec = await screen(tx, v, cfg, keys, (ref) => firstUse(rpc, ref));
    if (!rec) continue;
    admit(ledger, rec);
    const r: ConvRecord = ledger.records[sig];
    const where = r.channel === null ? "?" : who(r.channel);
    log(`  found  ${short(sig)}  ${short(r.wallet)} via ${where}: ${r.status}${r.reason ? `, ${r.reason}` : ""}`);
  }
  ledger.cursor = newest;
  await saveLedger();

  // Wallets whose window has closed. One wallet the RPC will not answer
  // for stays waiting until the next pass; it does not hold up the rest.
  const now = Math.floor(Date.now() / 1000);
  const facts: Record<string, RetentionFacts> = {};
  const cache = factsCache();
  for (const r of Object.values(ledger.records)) {
    if (!due(r, v, now)) continue;
    try {
      facts[r.signature] = await retentionFacts(rpc, r, cfg, r.blockTime + v.retentionSecs, cache);
    } catch (e) {
      log(`  could not check ${short(r.wallet)} this pass: ${(e as Error).message}`);
    }
  }
  applyRetention(ledger, facts, v, cfg);
  for (const sig of Object.keys(facts)) {
    const r = ledger.records[sig];
    log(
      `  window closed for ${short(r.wallet)}: ${r.status}${r.reason ? `, ${r.reason}` : ""}${r.funder ? ` (funded by ${short(r.funder)})` : ""}`,
    );
  }
  await saveLedger();

  // Settle.
  const plans = planBatches(ledger, v);
  if (plans.length && now > v.settleDeadline) {
    log("  the settle deadline has passed; nothing more can be settled");
  } else if (plans.length && settler.address !== v.settler) {
    log(`  this key (${short(settler.address)}) is not the campaign's settler (${short(v.settler)}); not sending`);
  } else {
    for (const b of plans) {
      log(
        `  settle ${who(b.channel)} batch ${b.batch}: ${b.signatures.length} conversion(s), ${amount(BigInt(b.signatures.length) * v.payout)}, evidence ${b.evidence.slice(0, 12)}...`,
      );
      if (DRY) continue;
      ledger.pending[b.channel] = b;
      await saveLedger();
      try {
        b.tx = await sendBatch(settler, v, b);
        for (const s of b.signatures) Object.assign(ledger.records[s], { status: "settled", batch: b.batch });
        ledger.batches.push(b);
        delete ledger.pending[b.channel];
        v.channels[b.channel].batches += 1;
        v.committed += BigInt(b.signatures.length) * v.payout;
        log(`    ${explorerTx(b.tx)}`);
      } catch (e) {
        // Refused by the program (over budget after a refund, say) means the
        // batch was rejected whole: drop it and replan next pass. Anything
        // else may have landed; keep it pending for the chain to say.
        if (refusedByProgram(e)) delete ledger.pending[b.channel];
        log(`    not settled: ${(e as Error).message}`);
      }
      await saveLedger();
    }
  }

  // Receipts.
  for (const r of receipts(ledger, v)) {
    if (!r.tagged) continue;
    log(
      `  receipt ${who(r.channel)}: tagged ${r.tagged}, waiting ${r.waiting}, gone ${r.gone}, flagged ${r.flagged}, other ${r.otherRejected}, qualified ${r.qualified}, settled ${r.settled}, paid ${amount(r.paid)}`,
    );
  }

  // The dashboard's copy: counts and settlement links, no wallets.
  if (!DRY) await store.publish(buildReport(ledger, v, { cluster: CLUSTER, name: cfg.name, slugs }));
}

// ── main ─────────────────────────────────────────────────────────────────────

/* The settler key: SETTLER_KEYPAIR_JSON (the key itself, as the scheduled
 * runner passes it from a secret), else SETTLER_KEYPAIR (a keyfile path),
 * else the deploy wallet. */
function settlerKeyJson(): string {
  if (process.env.SETTLER_KEYPAIR_JSON) return process.env.SETTLER_KEYPAIR_JSON;
  return fs.readFileSync(process.env.SETTLER_KEYPAIR ?? solanaConfig(), "utf8");
}

async function pass() {
  const referenceSecret = loadReferenceSecret();
  const settler = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(settlerKeyJson())));
  // The repo's registry file and the dashboard's rows, together.
  const registry = await loadRegistry(CLUSTER);
  const campaigns = registry.campaigns.filter((c) => !values.campaign || c.campaign === address(values.campaign));
  if (!campaigns.length) throw new Error("No matching campaign in the registry");
  for (const c of campaigns) await runCampaign(c, settler, referenceSecret, registry.slugs);
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
