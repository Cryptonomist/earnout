/* A channel's payee claims what settlements have committed to it.
 *
 *   npx tsx scripts/claim.ts --slug demo-alice --signer ~/.config/solana/earnout-demo-alice.json
 *
 * The signer must be the channel's payee and pays for its own token
 * account the first time. */

import fs from "node:fs";
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
} from "@solana/kit";
import { ataAddress, channelAddress, claimIx, decodeCampaign, decodeChannel } from "../sdk/program.ts";

const { values } = parseArgs({ options: { slug: { type: "string" }, signer: { type: "string" } } });

async function main() {
  if (!values.slug || !values.signer) throw new Error("Give --slug and --signer");
  const cluster = process.env.EARNOUT_CLUSTER ?? "devnet";
  const link = JSON.parse(fs.readFileSync(path.resolve("registry", `${cluster}.json`), "utf8")).links?.[values.slug];
  if (!link) throw new Error(`No link ${values.slug}`);

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(rpcUrl);
  const payee = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(values.signer, "utf8"))));
  const campaign = address(link.campaign);
  const channel = await channelAddress(campaign, link.channel);
  const read = async (a: typeof campaign) =>
    getBase64Encoder().encode((await rpc.getAccountInfo(a, { encoding: "base64" }).send()).value!.data[0]) as Uint8Array;
  const c = decodeCampaign(await read(campaign));
  const ch = decodeChannel(await read(channel));
  if (ch.payee !== payee.address) throw new Error(`${values.slug} pays ${ch.payee}, not this signer`);
  console.log(`${values.slug}: earned ${ch.earned}, claimed ${ch.claimed} (base units)`);

  const ix = await claimIx({ payee, campaign, channel, mint: c.mint });
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const signed = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payee, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    ),
  );
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws")) })(
    signed as any,
    { commitment: "confirmed" },
  );
  const { value } = await rpc.getTokenAccountBalance(await ataAddress(payee.address, c.mint)).send();
  console.log(`claimed; ${values.slug}'s wallet now holds ${value.uiAmountString} of the campaign token`);
  console.log(`https://explorer.solana.com/tx/${getSignatureFromTransaction(signed)}?cluster=${cluster}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
