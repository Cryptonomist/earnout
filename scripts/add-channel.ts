/* Add a verified channel to a campaign and give it a link.
 *
 *   npx tsx --env-file=.env.local scripts/add-channel.ts \
 *     --campaign <address> --slug <slug> --payee <wallet> [--destination /demo]
 *
 * The payee must already have linked their X account at earnout.dev/influencers
 * (under this campaign's identity); the channel is created for that account
 * and the slug registered in registry/<cluster>.json. The deploy wallet must
 * be the campaign's advertiser. */

import { parseArgs } from "node:util";
import { address } from "@solana/kit";
import { addChannelIx } from "../sdk/program.ts";
import { fetchXLink } from "../sdk/read.ts";
import { SLUG } from "../src/lib/rules.ts";
import {
  chainFromEnv,
  CLUSTER,
  explorerTx,
  fetchCampaign,
  loadKeypair,
  readRegistry,
  solanaConfig,
  writeRegistry,
} from "./lib.ts";

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
  if (!SLUG.test(slug)) throw new Error(`Bad slug: ${slug}`);
  const file = readRegistry();
  if (Object.hasOwn(file.links, slug)) throw new Error(`Slug already registered: ${slug}`);

  const chain = chainFromEnv();
  const wallet = await loadKeypair(solanaConfig());
  const campaign = address(values.campaign);
  const payee = address(values.payee);

  const c = await fetchCampaign(chain.rpc, campaign);
  if (c.advertiser !== wallet.address) throw new Error(`The campaign's advertiser is ${c.advertiser}, not this wallet`);

  const link = await fetchXLink(chain.rpc, c.identity, payee);
  if (!link)
    throw new Error(
      `${payee} has not linked an X account under ${c.identity}. They sign in at earnout.dev/influencers first.`,
    );
  if (!link.current) throw new Error(`@${link.handle} has since moved to another wallet; use that one`);
  console.log(`${slug} will be @${link.handle} (X id ${link.xId}), paid to ${payee}`);

  const ix = await addChannelIx({
    advertiser: wallet,
    campaign,
    identity: c.identity,
    index: c.channels,
    payee,
    xId: link.xId,
  });
  console.log(explorerTx(await chain.send([ix], wallet)));

  file.links[slug] = { campaign, channel: c.channels, destination: values.destination!, label: slug };
  writeRegistry(file);
  console.log(
    `Registered /r/${slug} as channel ${c.channels}. Commit registry/${CLUSTER}.json and push so the site serves it.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
