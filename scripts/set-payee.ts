/* Move a channel's payout to another wallet. The current payee signs, and
 * the new wallet must already be linked to the channel's own X account
 * (link X from the new wallet at earnout.dev/influencers first).
 *
 *   npx tsx scripts/set-payee.ts --slug demo-alice --payee <address> [--signer <keyfile>]
 *
 * The signer defaults to the deploy wallet. */

import { parseArgs } from "node:util";
import { address } from "@solana/kit";
import { channelAddress, setPayeeIx } from "../sdk/program.ts";
import { fetchChannelIdentity, fetchXLink } from "../sdk/read.ts";
import { chainFromEnv, explorerTx, fetchCampaign, linkFromRegistry, loadKeypair, solanaConfig } from "./lib.ts";

const { values } = parseArgs({
  options: { slug: { type: "string" }, payee: { type: "string" }, signer: { type: "string" } },
});

async function main() {
  if (!values.slug || !values.payee) throw new Error("Give --slug and --payee");
  const link = linkFromRegistry(values.slug);
  const chain = chainFromEnv();
  const signer = await loadKeypair(values.signer ?? solanaConfig());
  const campaign = address(link.campaign);
  const channel = await channelAddress(campaign, link.channel);
  const newPayee = address(values.payee);

  const c = await fetchCampaign(chain.rpc, campaign);
  const identity = await fetchChannelIdentity(chain.rpc, channel);
  if (!identity) throw new Error(`${values.slug} was created before X verification; its payee cannot move`);
  const newLink = await fetchXLink(chain.rpc, c.identity, newPayee);
  if (!newLink || !newLink.current) throw new Error(`${newPayee} is not linked to an X account under this campaign`);
  if (newLink.xId !== identity.xId)
    throw new Error(`${newPayee} is @${newLink.handle}; this channel is @${identity.handle}`);

  const ix = await setPayeeIx({
    payee: signer,
    campaign,
    identity: c.identity,
    channel,
    newPayee,
    newPayeeXId: newLink.xId,
  });
  const signature = await chain.send([ix], signer, { priority: false });
  console.log(`${values.slug} (@${identity.handle}) now pays ${newPayee}`);
  console.log(explorerTx(signature));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
