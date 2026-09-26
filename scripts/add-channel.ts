/* Add a verified channel to a campaign and give it a link.
 *
 *   npx tsx --env-file=.env.local scripts/add-channel.ts \
 *     --campaign <address> --slug <slug> --payee <wallet> [--destination /demo]
 *
 * The payee must already have linked their X account at earnout.dev/creators
 * (under this campaign's identity); the channel is created for that account
 * and the slug registered in registry/<cluster>.json. The deploy wallet must
 * be the campaign's advertiser. */

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
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { addChannelIx, decodeCampaign } from "../sdk/program.ts";
import { fetchXLink } from "../sdk/read.ts";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
    slug: { type: "string" },
    payee: { type: "string" },
    destination: { type: "string", default: "/demo" },
  },
});

async function main() {
  if (!values.campaign || !values.slug || !values.payee) throw new Error("Give --campaign, --slug and --payee");
  const slug = values.slug;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new Error(`Bad slug: ${slug}`);

  const cluster = process.env.EARNOUT_CLUSTER ?? "devnet";
  const registryPath = path.resolve("registry", `${cluster}.json`);
  const file = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (Object.hasOwn(file.links, slug)) throw new Error(`Slug already registered: ${slug}`);

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(rpcUrl);
  const wallet = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  const campaign = address(values.campaign);
  const payee = address(values.payee);

  const { value } = await rpc.getAccountInfo(campaign, { encoding: "base64" }).send();
  if (!value) throw new Error(`No campaign at ${campaign}`);
  const c = decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array);
  if (c.advertiser !== wallet.address) throw new Error(`The campaign's advertiser is ${c.advertiser}, not this wallet`);

  const link = await fetchXLink(rpc, c.identity, payee);
  if (!link) throw new Error(`${payee} has not linked an X account under ${c.identity}. They sign in at earnout.dev/creators first.`);
  if (!link.current) throw new Error(`@${link.handle} has since moved to another wallet; use that one`);
  console.log(`${slug} will be @${link.handle} (X id ${link.xId}), paid to ${payee}`);

  const ix = await addChannelIx({ advertiser: wallet, campaign, identity: c.identity, index: c.channels, payee, xId: link.xId });
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(wallet, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ix], m),
    ),
  );
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws")) })(
    tx as any,
    { commitment: "confirmed" },
  );
  console.log(`https://explorer.solana.com/tx/${getSignatureFromTransaction(tx)}?cluster=${cluster}`);

  file.links[slug] = { campaign, channel: c.channels, destination: values.destination, label: slug };
  fs.writeFileSync(registryPath, JSON.stringify(file, null, 2) + "\n");
  console.log(`Registered /r/${slug} as channel ${c.channels}. Commit registry/${cluster}.json and push so the site serves it.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
