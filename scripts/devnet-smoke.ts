/* One whole campaign against the deployed program, on devnet, end to end:
 *
 *   a throwaway 6-decimal token (stands in for USDC), a campaign paying
 *   5.00 per user, 100.00 funded, one channel, one real user transaction
 *   carrying a tag, the settler finding it by its reference and opening it
 *   to the channel, a one-conversion settlement, and the channel's claim.
 *
 * The deploy wallet plays advertiser and settler. The channel's payee and
 * the user are fresh keys it funds with a little SOL. Costs roughly 0.02
 * SOL in rent and fees.
 *
 *   npx tsx scripts/devnet-smoke.ts
 *   RPC_URL=https://... npx tsx scripts/devnet-smoke.ts   (a faster RPC) */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPair,
  generateKeyPairSigner,
  getAddressFromPublicKey,
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
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
} from "@solana-program/token";
import * as eo from "../sdk/index.ts";
import { issueReference, openReference, referenceKeys } from "../sdk/reference.ts";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = RPC_URL.replace(/^http/, "ws");
const KEYPAIR = process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
const UNIT = 1_000_000n;

const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL) });

async function send(label: string, ixs: Instruction[], payer: KeyPairSigner): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ...ixs], m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  await sendAndConfirm(tx as any, { commitment: "confirmed" });
  const sig = getSignatureFromTransaction(tx);
  console.log(`  ${label.padEnd(22)} https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  return sig;
}

async function accountData(addr: Address): Promise<Uint8Array> {
  const { value } = await rpc.getAccountInfo(addr, { encoding: "base64" }).send();
  if (!value) throw new Error(`No account at ${addr}`);
  return getBase64Encoder().encode(value.data[0]) as Uint8Array;
}

async function tokenBalance(ata: Address): Promise<bigint> {
  const { value } = await rpc.getTokenAccountBalance(ata).send();
  return BigInt(value.amount);
}

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
}

async function main() {
  const wallet = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const payee = await generateKeyPairSigner();
  const user = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  const identity = await generateKeyPair();
  const identityAddress = await getAddressFromPublicKey(identity.publicKey);

  const program = await rpc.getAccountInfo(eo.PROGRAM_ADDRESS, { encoding: "base64" }).send();
  if (!program.value?.executable) throw new Error(`No program at ${eo.PROGRAM_ADDRESS} on ${RPC_URL}`);
  console.log(`Program ${eo.PROGRAM_ADDRESS} is deployed.`);
  console.log(`Wallet  ${wallet.address}\n`);

  // ── a test token, and SOL for the two fresh keys ──────────────────────────
  const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();
  const walletAta = await eo.ataAddress(wallet.address, mint.address);
  await send(
    "token + funding",
    [
      getCreateAccountInstruction({ payer: wallet, newAccount: mint, lamports: mintRent, space: 82, programAddress: eo.TOKEN_PROGRAM }),
      getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: wallet.address }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: wallet, owner: wallet.address, mint: mint.address }),
      getMintToInstruction({ mint: mint.address, token: walletAta, mintAuthority: wallet, amount: 1_000n * UNIT }),
      getTransferSolInstruction({ source: wallet, destination: payee.address, amount: 10_000_000n }),
      getTransferSolInstruction({ source: wallet, destination: user.address, amount: 10_000_000n }),
    ],
    wallet,
  );

  // ── the campaign ──────────────────────────────────────────────────────────
  const seed = BigInt(Date.now());
  const now = BigInt(Math.floor(Date.now() / 1000));
  const retention = 60;
  const endsAt = now + 600n;
  const campaign = await eo.campaignAddress(wallet.address, seed);
  await send(
    "create campaign",
    [
      await eo.createCampaignIx({
        advertiser: wallet,
        mint: mint.address,
        seed,
        payout: 5n * UNIT,
        retentionSecs: retention,
        endsAt,
        settleDeadline: endsAt + BigInt(retention) + 3_600n,
        settler: wallet.address,
        identity: identityAddress,
      }),
      await eo.fundIx({ funder: wallet, campaign, mint: mint.address, source: walletAta, amount: 100n * UNIT }),
      await eo.addChannelIx({ advertiser: wallet, campaign, index: 0, payee: payee.address }),
    ],
    wallet,
  );
  const channel = await eo.channelAddress(campaign, 0);
  const c = eo.decodeCampaign(await accountData(campaign));
  check(c.funded === 100n * UNIT && c.channels === 1, "campaign funded with 100.00 and one channel");

  // ── a user converts through the channel's link ────────────────────────────
  const keys = referenceKeys(randomBytes(32), campaign);
  const reference = issueReference(keys, 0, Number(now));
  const signature = await eo.signReference(identity, reference);
  const conversion = await send(
    "tagged conversion",
    [
      // Stands in for the user's deposit into the advertiser's product.
      getTransferSolInstruction({ source: user, destination: wallet.address, amount: 1_000_000n }),
      ...eo.tagInstructions({ campaign, identity: identityAddress, reference, signature }),
    ],
    user,
  );

  // ── what the settler does: find it, check it, open it ─────────────────────
  const byRef = await rpc.getSignaturesForAddress(reference, { commitment: "confirmed" }).send();
  check(byRef.length === 1 && byRef[0].signature === conversion, "the reference was used exactly once, by that transaction");
  const [verified] = await eo.verifiedReferences(identityAddress, byRef[0].memo);
  check(verified === reference, "the memo carries a valid Action Identity signature");
  check(openReference(keys, verified)?.channel === 0, "the reference opens to channel 0");
  const byCampaign = await rpc.getSignaturesForAddress(campaign, { commitment: "confirmed" }).send();
  check(byCampaign.some((s) => s.signature === conversion), "the conversion is findable by campaign address");

  // ── settle and claim ──────────────────────────────────────────────────────
  const evidence = createHash("sha256").update(conversion).digest();
  await send("settle 1 conversion", [eo.settleIx({ settler: wallet, campaign, channel, batch: 0, conversions: 1, evidence })], wallet);
  await send("claim", [await eo.claimIx({ payee, campaign, channel, mint: mint.address })], payee);

  const paid = await tokenBalance(await eo.ataAddress(payee.address, mint.address));
  check(paid === 5n * UNIT, "the channel's payee received 5.00");
  const after = eo.decodeCampaign(await accountData(campaign));
  check(after.committed === 5n * UNIT && after.claimed === 5n * UNIT, "the campaign committed and paid out 5.00 of 100.00");

  console.log(`\nCampaign https://explorer.solana.com/address/${campaign}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
