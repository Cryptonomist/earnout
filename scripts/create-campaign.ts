/* Create a campaign on devnet with the Earnout identity, add its channels,
 * fund it, and register a link slug for each channel.
 *
 *   npx tsx --env-file=.env.local scripts/create-campaign.ts \
 *     --payout 5 --fund 500 --retention 600 --ends-in-days 60 \
 *     --destination /demo --channel alice --payee <alice's linked wallet>
 *
 * Options:
 *   --mint <address>     the payout token; without it, a fresh 6-decimal test
 *                        token is made and 10,000 minted to the wallet
 *   --payout <units>     per qualified conversion, in whole tokens
 *   --fund <units>       the starting budget, in whole tokens
 *   --retention <secs>   how long a wallet must stay
 *   --ends-in-days <n>   when conversions stop counting
 *   --destination <url>  where every channel's link sends people
 *   --channel <slug>     one per channel, in order
 *   --payee <address>    one per channel, in the same order. Every channel is a
 *                        verified person: each payee must already have linked
 *                        an X account at earnout.dev/influencers
 *   --settler <address>  the key that may settle; defaults to the wallet. Give
 *                        a dedicated key if the settler will run anywhere but
 *                        this machine.
 *   --replace-slugs      repoint slugs that already exist to the new campaign
 *                        (the old campaign stays on chain; retire it from the
 *                        registry's campaigns by hand)
 *
 * The identity comes from EARNOUT_IDENTITY_KEYPAIR, so the link service can
 * sign for this campaign. The deploy wallet (~/.config/solana/id.json) pays,
 * advertises and settles. Slugs are appended to registry/devnet.json, with
 * a default settler rule for the campaign: a deposit of at least 0.01 SOL to
 * the wallet, and at least 0.005 SOL still held when the window closes. Edit
 * the rule there for a real partner. */

import { parseArgs } from "node:util";
import { address, generateKeyPairSigner, type Address, type Instruction } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
} from "@solana-program/token";
import * as eo from "../sdk/index.ts";
import { fetchXLink } from "../sdk/read.ts";
import { SLUG } from "../src/lib/rules.ts";
import { loadSecrets } from "../src/server/links.ts";
import { chainFromEnv, explorerTx, loadKeypair, readRegistry, solanaConfig, writeRegistry } from "./lib.ts";

const { values } = parseArgs({
  options: {
    mint: { type: "string" },
    payout: { type: "string", default: "5" },
    fund: { type: "string", default: "500" },
    retention: { type: "string", default: "600" },
    "ends-in-days": { type: "string", default: "60" },
    destination: { type: "string", default: "/demo" },
    channel: { type: "string", multiple: true, default: [] },
    payee: { type: "string", multiple: true, default: [] },
    settler: { type: "string" },
    "replace-slugs": { type: "boolean", default: false },
  },
});

const chain = chainFromEnv();
const DECIMALS = 6;
const unit = (s: string) => BigInt(Math.round(Number(s) * 10 ** DECIMALS));

async function send(label: string, ...args: Parameters<typeof chain.send>) {
  console.log(`  ${label.padEnd(18)} ${explorerTx(await chain.send(...args))}`);
}

async function main() {
  const slugs = values.channel as string[];
  const payees = values.payee as string[];
  if (!slugs.length) throw new Error("Give at least one --channel <slug>");
  if (payees.length !== slugs.length)
    throw new Error("Give one --payee per --channel: every channel is a verified person");
  const file = readRegistry();
  for (const s of slugs) {
    if (!SLUG.test(s)) throw new Error(`Bad slug: ${s}`);
    if (Object.hasOwn(file.links, s) && !values["replace-slugs"])
      throw new Error(`Slug already registered: ${s} (use --replace-slugs)`);
  }

  const { identityAddress } = await loadSecrets();
  const wallet = await loadKeypair(solanaConfig());
  const walletAta = (mint: Address) => eo.ataAddress(wallet.address, mint);

  // Every payee is checked before anything is sent, so a wrong one costs nothing.
  const links = await Promise.all(payees.map((p) => fetchXLink(chain.rpc, identityAddress, address(p))));
  const xIds = links.map((link, i) => {
    if (!link || !link.current) {
      throw new Error(
        `${payees[i]} has not linked an X account under ${identityAddress}; they sign in at earnout.dev/influencers first`,
      );
    }
    console.log(`  ${slugs[i]} is @${link.handle}`);
    return link.xId;
  });

  let mint: Address;
  if (values.mint) {
    mint = address(values.mint);
  } else {
    const m = await generateKeyPairSigner();
    mint = m.address;
    await send(
      "test token",
      [
        getCreateAccountInstruction({
          payer: wallet,
          newAccount: m,
          lamports: await chain.rpc.getMinimumBalanceForRentExemption(82n).send(),
          space: 82,
          programAddress: eo.TOKEN_PROGRAM,
        }),
        getInitializeMint2Instruction({ mint, decimals: DECIMALS, mintAuthority: wallet.address }),
        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: wallet, owner: wallet.address, mint }),
        getMintToInstruction({ mint, token: await walletAta(mint), mintAuthority: wallet, amount: unit("10000") }),
      ],
      wallet,
    );
  }

  const seed = BigInt(Date.now());
  const retention = Number(values.retention);
  const endsAt = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(values["ends-in-days"]) * 86_400));
  const campaign = await eo.campaignAddress(wallet.address, seed);

  await send(
    "campaign",
    [
      await eo.createCampaignIx({
        advertiser: wallet,
        mint,
        seed,
        payout: unit(values.payout!),
        retentionSecs: retention,
        endsAt,
        settleDeadline: endsAt + BigInt(retention) + 86_400n,
        settler: values.settler ? address(values.settler) : wallet.address,
        identity: identityAddress,
      }),
      await eo.fundIx({ funder: wallet, campaign, mint, source: await walletAta(mint), amount: unit(values.fund!) }),
    ],
    wallet,
  );

  const channels: Instruction[] = await Promise.all(
    xIds.map((xId, i) =>
      eo.addChannelIx({
        advertiser: wallet,
        campaign,
        identity: identityAddress,
        index: i,
        payee: address(payees[i]),
        xId,
      }),
    ),
  );
  await send(`${slugs.length} channel(s)`, channels, wallet);

  slugs.forEach((slug, channel) => {
    file.links[slug] = { campaign, channel, destination: values.destination!, label: slug };
  });
  file.campaigns[campaign] = {
    name: slugs[0],
    conversion: { kind: "sol-transfer", to: wallet.address, minLamports: "10000000" },
    retention: { kind: "sol-balance", minLamports: "5000000" },
    attributionWindowSecs: 7 * 86_400,
    sybil: { maxWalletsPerFunder: 3 },
  };
  writeRegistry(file);

  console.log(`\nCampaign  ${campaign}`);
  console.log(`Mint      ${mint}`);
  console.log(`Identity  ${identityAddress}`);
  console.log(`Settler   ${values.settler ?? wallet.address}`);
  console.log(`Ends      ${new Date(Number(endsAt) * 1000).toISOString()}`);
  for (const s of slugs) console.log(`Link      /r/${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
