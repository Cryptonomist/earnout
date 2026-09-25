/* Move a channel's payout to another wallet. The current payee signs.
 *
 *   npx tsx scripts/set-payee.ts --slug demo-alice --payee <address> [--signer <keyfile>]
 *
 * The signer defaults to the deploy wallet, which create-campaign.ts makes
 * every channel's first payee. */

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
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { channelAddress, setPayeeIx } from "../sdk/program.ts";

const { values } = parseArgs({
  options: { slug: { type: "string" }, payee: { type: "string" }, signer: { type: "string" } },
});

async function main() {
  if (!values.slug || !values.payee) throw new Error("Give --slug and --payee");
  const cluster = process.env.EARNOUT_CLUSTER ?? "devnet";
  const file = JSON.parse(fs.readFileSync(path.resolve("registry", `${cluster}.json`), "utf8"));
  const link = file.links?.[values.slug];
  if (!link) throw new Error(`No link ${values.slug}`);

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(rpcUrl);
  const keyFile = values.signer ?? path.join(os.homedir(), ".config/solana/id.json");
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8"))));
  const channel = await channelAddress(address(link.campaign), link.channel);

  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([setPayeeIx({ payee: signer, channel, newPayee: address(values.payee!) })], m),
    ),
  );
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws")) })(
    tx as any,
    { commitment: "confirmed" },
  );
  console.log(`${values.slug} now pays ${values.payee}`);
  console.log(`https://explorer.solana.com/tx/${getSignatureFromTransaction(tx)}?cluster=${cluster}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
