/* Move a channel's payout to another wallet. The current payee signs, and
 * the new wallet must already be linked to the channel's own X account
 * (link X from the new wallet at earnout.dev/creators first).
 *
 *   npx tsx scripts/set-payee.ts --slug demo-alice --payee <address> [--signer <keyfile>]
 *
 * The signer defaults to the deploy wallet. */

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
} from "@solana/kit";
import { channelAddress, decodeCampaign, setPayeeIx } from "../sdk/program.ts";
import { fetchChannelIdentity, fetchXLink } from "../sdk/read.ts";

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
  const campaign = address(link.campaign);
  const channel = await channelAddress(campaign, link.channel);
  const newPayee = address(values.payee);

  const { value } = await rpc.getAccountInfo(campaign, { encoding: "base64" }).send();
  if (!value) throw new Error(`No campaign at ${campaign}`);
  const c = decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array);
  const identity = await fetchChannelIdentity(rpc, channel);
  if (!identity) throw new Error(`${values.slug} was created before X verification; its payee cannot move`);
  const newLink = await fetchXLink(rpc, c.identity, newPayee);
  if (!newLink || !newLink.current) throw new Error(`${newPayee} is not linked to an X account under this campaign`);
  if (newLink.xId !== identity.xId) throw new Error(`${newPayee} is @${newLink.handle}; this channel is @${identity.handle}`);

  const ix = await setPayeeIx({ payee: signer, campaign, identity: c.identity, channel, newPayee, newPayeeXId: newLink.xId });
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    ),
  );
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws")) })(
    tx as any,
    { commitment: "confirmed" },
  );
  console.log(`${values.slug} (@${identity.handle}) now pays ${newPayee}`);
  console.log(`https://explorer.solana.com/tx/${getSignatureFromTransaction(tx)}?cluster=${cluster}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
