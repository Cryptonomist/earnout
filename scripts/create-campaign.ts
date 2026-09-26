/* Create a campaign on devnet with the Earnout identity, add its channels,
 * fund it, and register a link slug for each channel.
 *
 *   npx tsx --env-file=.env.local scripts/create-campaign.ts \
 *     --payout 5 --fund 500 --retention 600 --ends-in-days 60 \
 *     --destination /demo --channel demo-alice --channel demo-bob
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
 *                        an X account at earnout.dev/creators
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  address,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
} from "@solana-program/token";
import * as eo from "../sdk/index.ts";
import { fetchXLink } from "../sdk/read.ts";
import { loadSecrets, type LinkEntry } from "../src/server/links.ts";

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

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
});
const REGISTRY = path.resolve("registry/devnet.json");
const DECIMALS = 6;
const unit = (s: string) => BigInt(Math.round(Number(s) * 10 ** DECIMALS));

async function send(label: string, ixs: Instruction[], payer: KeyPairSigner) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ...ixs], m),
    ),
  );
  await sendAndConfirm(tx as any, { commitment: "confirmed" });
  console.log(`  ${label.padEnd(18)} https://explorer.solana.com/tx/${getSignatureFromTransaction(tx)}?cluster=devnet`);
}

async function main() {
  const slugs = values.channel as string[];
  if (!slugs.length) throw new Error("Give at least one --channel <slug>");
  const file = JSON.parse(fs.readFileSync(REGISTRY, "utf8")) as {
    campaigns: Record<string, unknown>;
    links: Record<string, LinkEntry>;
  };
  const registry = file.links;
  for (const s of slugs) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) throw new Error(`Bad slug: ${s}`);
    if (Object.hasOwn(registry, s) && !values["replace-slugs"]) throw new Error(`Slug already registered: ${s} (use --replace-slugs)`);
  }

  const { identityAddress } = await loadSecrets();
  const wallet = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
  );
  const walletAta = async (mint: Address) => eo.ataAddress(wallet.address, mint);

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
          lamports: await rpc.getMinimumBalanceForRentExemption(82n).send(),
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

  const payees = values.payee as string[];
  if (payees.length !== slugs.length) throw new Error("Give one --payee per --channel: every channel is a verified person");
  const channels: Instruction[] = [];
  for (let i = 0; i < slugs.length; i++) {
    const payee = address(payees[i]);
    const link = await fetchXLink(rpc, identityAddress, payee);
    if (!link || !link.current) throw new Error(`${payee} has not linked an X account under ${identityAddress}; they sign in at earnout.dev/creators first`);
    console.log(`  ${slugs[i]} is @${link.handle}`);
    channels.push(await eo.addChannelIx({ advertiser: wallet, campaign, identity: identityAddress, index: i, payee, xId: link.xId }));
  }
  await send(`${slugs.length} channel(s)`, channels, wallet);

  slugs.forEach((slug, channel) => {
    registry[slug] = { campaign, channel, destination: values.destination!, label: slug };
  });
  file.campaigns[campaign] = {
    name: slugs[0],
    conversion: { kind: "sol-transfer", to: wallet.address, minLamports: "10000000" },
    retention: { kind: "sol-balance", minLamports: "5000000" },
    attributionWindowSecs: 7 * 86_400,
    sybil: { maxWalletsPerFunder: 3 },
  };
  fs.writeFileSync(REGISTRY, JSON.stringify(file, null, 2) + "\n");

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
