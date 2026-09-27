/* A small, realistic crowd through the demo campaign's real links, so the
 * dashboard shows what the settler is for and not just that it works.
 *
 *   npx tsx scripts/simulate.ts [--base https://earnout.dev]
 *
 * The crowd:
 *   demo-alice  4 people who deposit and stay
 *               2 who deposit, then take their SOL back out before the
 *                 window closes (the settler should mark them gone)
 *   demo-bob    1 person who deposits and stays
 *               4 wallets that all deposit, funded by one fresh wallet (a
 *                 farm; the settler should flag the cluster)
 *
 * Everyone clicks the live link first (a real reference from the real link
 * service), then deposits 0.01 SOL with the tag, exactly as /demo does.
 * People are funded by the demo faucet, the way a judge would be; the farm
 * by its own new wallet, which the deploy wallet funds. Every key here is
 * made for the run and thrown away. Costs about 0.25 devnet SOL.
 *
 * Nothing is settled here: the scheduled settler does that once the
 * campaign's retention window has passed. */

import { parseArgs } from "node:util";
import { address, generateKeyPairSigner, lamports, type Address, type KeyPairSigner } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { tagInstructions } from "../sdk/index.ts";
import { chainFromEnv, clickLink, loadKeypair, readRegistry, short, sleep, solanaConfig } from "./lib.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "https://earnout.dev" } } });

const chain = chainFromEnv();
const SOL = 1_000_000_000n;
const plain = { priority: false };

const transfer = (from: KeyPairSigner, to: Address, amount: bigint) =>
  getTransferSolInstruction({ source: from, destination: to, amount: lamports(amount) });

async function send(label: string, ...args: Parameters<typeof chain.send>) {
  const signature = await chain.send(...args);
  console.log(`  ${label.padEnd(34)} ${short(signature)}`);
  return signature;
}

type Person = { slug: string; kind: "stays" | "leaves" | "farm"; key: KeyPairSigner };

async function main() {
  // The demo campaign is whichever one demo-alice's link points at.
  const registry = readRegistry();
  const link = registry.links["demo-alice"];
  if (!link) throw new Error("No demo-alice link in registry/devnet.json");
  const campaign = registry.campaigns[link.campaign];
  if (campaign.conversion.kind !== "sol-transfer" || !campaign.conversion.to)
    throw new Error("The demo campaign must pay for a SOL deposit");
  const treasury = address(campaign.conversion.to);
  const deposit = BigInt(campaign.conversion.minLamports ?? "0");

  const deployWallet = await loadKeypair(solanaConfig());
  const faucet = await loadKeypair(solanaConfig("earnout-faucet-devnet.json"));
  const farmer = await generateKeyPairSigner();

  const people: Person[] = [];
  const add = async (slug: string, kind: Person["kind"], n: number) => {
    for (let i = 0; i < n; i++) people.push({ slug, kind, key: await generateKeyPairSigner() });
  };
  await add("demo-alice", "stays", 4);
  await add("demo-alice", "leaves", 2);
  await add("demo-bob", "stays", 1);
  await add("demo-bob", "farm", 4);

  console.log(`Campaign ${link.campaign}, via ${values.base}`);
  console.log(`Treasury ${short(treasury)}, deposit ${Number(deposit) / 1e9} SOL\n`);

  // Funding: people from the faucet, the farm from one new wallet.
  const grant = SOL / 50n; // 0.02
  const crowd = people.filter((p) => p.kind !== "farm");
  const farm = people.filter((p) => p.kind === "farm");
  await send(
    "faucet funds 7 people",
    crowd.map((p) => transfer(faucet, p.key.address, grant)),
    faucet,
    plain,
  );
  await send(
    "deploy wallet funds the farmer",
    [transfer(deployWallet, farmer.address, SOL / 10n)],
    deployWallet,
    plain,
  );
  await send(
    "farmer funds 4 wallets",
    farm.map((p) => transfer(farmer, p.key.address, grant)),
    farmer,
    plain,
  );

  // Everyone clicks, then deposits with the tag.
  for (const p of people) {
    const tag = await clickLink(values.base!, p.slug);
    const ixs = [transfer(p.key, treasury, deposit), ...tagInstructions(tag)];
    await send(`${p.slug} ${p.kind.padEnd(6)} ${short(p.key.address)} deposits`, ixs, p.key, plain);
    await sleep(400);
  }

  // The leavers take their money back out before the window closes.
  for (const p of people.filter((p) => p.kind === "leaves")) {
    await send(
      `${p.slug} leaver ${short(p.key.address)} withdraws`,
      [transfer(p.key, faucet.address, grant - deposit - 1_000_000n)],
      p.key,
      plain,
    );
  }

  console.log(`\nDone. The settler judges these once the ${campaign.name} window (10 minutes) has passed.`);
  console.log(`Watch ${values.base}/dashboard/${link.campaign}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
