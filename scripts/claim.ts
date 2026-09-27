/* A channel's payee claims what settlements have committed to it.
 *
 *   npx tsx scripts/claim.ts --slug demo-alice --signer ~/.config/solana/earnout-demo-alice.json
 *
 * The signer must be the channel's payee and pays for its own token
 * account the first time. The slug must be in registry/<cluster>.json; an
 * influencer on a hub campaign claims from their page on the site. */

import { parseArgs } from "node:util";
import { address, getBase64Encoder } from "@solana/kit";
import { ataAddress, channelAddress, claimIx, decodeChannel } from "../sdk/program.ts";
import { chainFromEnv, explorerTx, fetchCampaign, linkFromRegistry, loadKeypair } from "./lib.ts";

const { values } = parseArgs({ options: { slug: { type: "string" }, signer: { type: "string" } } });

async function main() {
  if (!values.slug || !values.signer) throw new Error("Give --slug and --signer");
  const link = linkFromRegistry(values.slug);
  const chain = chainFromEnv();
  const payee = await loadKeypair(values.signer);
  const campaign = address(link.campaign);
  const channel = await channelAddress(campaign, link.channel);

  const c = await fetchCampaign(chain.rpc, campaign);
  const { value } = await chain.rpc.getAccountInfo(channel, { encoding: "base64" }).send();
  if (!value) throw new Error(`No channel account at ${channel}`);
  const ch = decodeChannel(getBase64Encoder().encode(value.data[0]) as Uint8Array);
  if (ch.payee !== payee.address) throw new Error(`${values.slug} pays ${ch.payee}, not this signer`);
  console.log(`${values.slug}: earned ${ch.earned}, claimed ${ch.claimed} (base units)`);

  const signature = await chain.send([await claimIx({ payee, campaign, channel, mint: c.mint })], payee, {
    priority: false,
  });
  const balance = await chain.rpc.getTokenAccountBalance(await ataAddress(payee.address, c.mint)).send();
  console.log(`claimed; ${values.slug}'s wallet now holds ${balance.value.uiAmountString} of the campaign token`);
  console.log(explorerTx(signature));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
