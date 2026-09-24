/* The earnout program, against the real binary, in LiteSVM, driven through
 * the same SDK the app uses.
 *
 * Every test gets a fresh SVM with the clock at NOW, so a test that warps
 * past a deadline cannot leak into the next. Mints and the advertiser's
 * starting balance are written straight into accounts; everything after
 * that goes through real instructions.
 *
 * USDC is a classic SPL mint; a Token-2022 mint covers the other path. */

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { expect } from "chai";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPair,
  generateKeyPairSigner,
  getAddressCodec,
  getAddressFromPublicKey,
  lamports,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import * as eo from "../sdk/index.ts";
import { issueReference, openReference, referenceKeys } from "../sdk/reference.ts";

const NOW = 1_800_000_000;
const DAY = 86_400;
const USDC = 1_000_000n;
const SOL = 1_000_000_000n;

const codec = getAddressCodec();

describe("earnout program - LiteSVM", () => {
  let svm: LiteSVM;
  let advertiser: KeyPairSigner;
  let settler: KeyPairSigner;
  let alice: KeyPairSigner;
  let bob: KeyPairSigner;
  let stranger: KeyPairSigner;
  let identity: CryptoKeyPair;
  let identityAddress: Address;
  let mint: Address;
  let mint22: Address;
  let seedCounter = 1n;

  // ── svm plumbing ──────────────────────────────────────────────────────────

  function put(addr: Address, data: Uint8Array, owner: Address, lamportsAmount = 3_000_000n) {
    svm.setAccount({
      address: addr,
      lamports: lamports(lamportsAmount),
      data,
      programAddress: owner,
      executable: false,
      space: BigInt(data.length),
    } as any);
  }

  function data(addr: Address): Uint8Array {
    const acc = svm.getAccount(addr) as any;
    if (!acc || ("exists" in acc && !acc.exists)) throw new Error(`Missing account ${addr}`);
    return Uint8Array.from(acc.data);
  }

  function exists(addr: Address): boolean {
    const acc = svm.getAccount(addr) as any;
    return !!acc && !("exists" in acc && !acc.exists);
  }

  const tokenAmount = (addr: Address) => new DataView(data(addr).buffer).getBigUint64(64, true);
  const campaignOf = (addr: Address) => eo.decodeCampaign(data(addr));
  const channelOf = (addr: Address) => eo.decodeChannel(data(addr));

  function setClock(ts: number) {
    const clock = svm.getClock();
    clock.unixTimestamp = BigInt(ts);
    svm.setClock(clock);
  }

  function encodeMint(decimals: number, authority: Address): Uint8Array {
    const d = new Uint8Array(82);
    const v = new DataView(d.buffer);
    v.setUint32(0, 1, true);
    d.set(codec.encode(authority), 4);
    d[44] = decimals;
    d[45] = 1;
    return d;
  }

  function encodeTokenAccount(mintAddr: Address, owner: Address, amount: bigint): Uint8Array {
    const d = new Uint8Array(165);
    d.set(codec.encode(mintAddr), 0);
    d.set(codec.encode(owner), 32);
    new DataView(d.buffer).setBigUint64(64, amount, true);
    d[108] = 1;
    return d;
  }

  async function buildTx(instructions: Instruction[], feePayer: KeyPairSigner) {
    const msg = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageFeePayerSigner(feePayer, createTransactionMessage({ version: 0 })),
    );
    return signTransactionMessageWithSigners(svm.setTransactionMessageLifetimeUsingLatestBlockhash(msg) as any);
  }

  async function send(instructions: Instruction[], feePayer: KeyPairSigner) {
    const res = svm.sendTransaction((await buildTx(instructions, feePayer)) as any);
    if (res instanceof FailedTransactionMetadata) throw new Error(res.meta().prettyLogs());
    svm.expireBlockhash();
    return res;
  }

  async function fails(instructions: Instruction[], feePayer: KeyPairSigner, includes: string) {
    const res = svm.simulateTransaction((await buildTx(instructions, feePayer)) as any);
    expect(res, `expected a failure containing "${includes}"`).to.be.instanceOf(FailedTransactionMetadata);
    const logs = (res as FailedTransactionMetadata).meta().prettyLogs();
    expect(logs, logs).to.include(includes);
  }

  // ── fixtures ──────────────────────────────────────────────────────────────

  beforeEach(async () => {
    svm = new LiteSVM();
    const idl = JSON.parse(fs.readFileSync(path.resolve("target/idl/earnout.json"), "utf8"));
    svm.addProgramFromFile(address(idl.address), path.resolve("target/deploy/earnout.so"));
    setClock(NOW);

    [advertiser, settler, alice, bob, stranger] = await Promise.all(
      Array.from({ length: 5 }, () => generateKeyPairSigner()),
    );
    for (const s of [advertiser, settler, alice, bob, stranger]) svm.airdrop(s.address, lamports(10n * SOL));

    identity = await generateKeyPair();
    identityAddress = await getAddressFromPublicKey(identity.publicKey);

    mint = (await generateKeyPairSigner()).address;
    mint22 = (await generateKeyPairSigner()).address;
    put(mint, encodeMint(6, advertiser.address), eo.TOKEN_PROGRAM);
    put(mint22, encodeMint(6, advertiser.address), eo.TOKEN_2022_PROGRAM);
    for (const [m, program] of [
      [mint, eo.TOKEN_PROGRAM],
      [mint22, eo.TOKEN_2022_PROGRAM],
    ] as const) {
      put(await eo.ataAddress(advertiser.address, m, program), encodeTokenAccount(m, advertiser.address, 10_000n * USDC), program);
    }
  });

  type Opts = {
    payout?: bigint;
    retention?: number;
    endsIn?: number;
    grace?: number;
    tokenProgram?: Address;
  };

  function terms(o: Opts = {}) {
    const tokenProgram = o.tokenProgram ?? eo.TOKEN_PROGRAM;
    const retention = o.retention ?? 3 * DAY;
    const endsAt = BigInt(NOW + (o.endsIn ?? 7 * DAY));
    return {
      advertiser,
      mint: tokenProgram === eo.TOKEN_2022_PROGRAM ? mint22 : mint,
      tokenProgram,
      seed: seedCounter++,
      payout: o.payout ?? 5n * USDC,
      retentionSecs: retention,
      endsAt,
      settleDeadline: endsAt + BigInt(retention) + BigInt(o.grace ?? 3_600),
      settler: settler.address,
      identity: identityAddress,
    };
  }

  async function newCampaign(o: Opts = {}) {
    const t = terms(o);
    await send([await eo.createCampaignIx(t)], advertiser);
    const campaign = await eo.campaignAddress(advertiser.address, t.seed);
    const vault = await eo.ataAddress(campaign, t.mint, t.tokenProgram);
    return { ...t, campaign, vault };
  }

  type C = Awaited<ReturnType<typeof newCampaign>>;

  async function fund(c: C, amount: bigint) {
    const source = await eo.ataAddress(advertiser.address, c.mint, c.tokenProgram);
    await send(
      [await eo.fundIx({ funder: advertiser, campaign: c.campaign, mint: c.mint, source, amount, tokenProgram: c.tokenProgram })],
      advertiser,
    );
  }

  async function addChannel(c: C, payee: Address): Promise<Address> {
    const index = campaignOf(c.campaign).channels;
    await send([await eo.addChannelIx({ advertiser, campaign: c.campaign, index, payee })], advertiser);
    return eo.channelAddress(c.campaign, index);
  }

  const settleIx = (c: C, channel: Address, batch: number, conversions: number, by = settler) =>
    eo.settleIx({ settler: by, campaign: c.campaign, channel, batch, conversions, evidence: new Uint8Array(32).fill(batch + 1) });

  const claimIx = (c: C, channel: Address, payee: KeyPairSigner) =>
    eo.claimIx({ payee, campaign: c.campaign, channel, mint: c.mint, tokenProgram: c.tokenProgram });

  const refundIx = (c: C) => eo.refundIx({ advertiser, campaign: c.campaign, mint: c.mint, tokenProgram: c.tokenProgram });

  // ── campaigns ─────────────────────────────────────────────────────────────

  it("creates a campaign with its terms and an empty vault", async () => {
    const c = await newCampaign();
    const k = campaignOf(c.campaign);
    expect(k.advertiser).to.equal(advertiser.address);
    expect(k.settler).to.equal(settler.address);
    expect(k.identity).to.equal(identityAddress);
    expect(k.payout).to.equal(5n * USDC);
    expect(k.retentionSecs).to.equal(3 * DAY);
    expect(k.createdAt).to.equal(BigInt(NOW));
    expect(k.settleDeadline).to.equal(c.settleDeadline);
    expect([k.funded, k.committed, k.claimed, k.refunded, k.channels]).to.deep.equal([0n, 0n, 0n, 0n, 0]);
    expect(tokenAmount(c.vault)).to.equal(0n);
  });

  it("refuses terms that could not be honoured", async () => {
    const cases: [Opts, string][] = [
      [{ payout: 0n }, "ZeroPayout"],
      [{ retention: 181 * DAY }, "RetentionTooLong"],
      [{ endsIn: 0 }, "EndsInPast"],
      [{ grace: 3_599 }, "DeadlineTooSoon"],
    ];
    for (const [o, err] of cases) {
      await fails([await eo.createCampaignIx(terms(o))], advertiser, err);
    }
  });

  // ── the money paths ───────────────────────────────────────────────────────

  it("funds, settles and pays a channel", async () => {
    const c = await newCampaign();
    await fund(c, 100n * USDC);
    const a = await addChannel(c, alice.address);
    const b = await addChannel(c, bob.address);
    expect(channelOf(b).index).to.equal(1);

    await send([settleIx(c, a, 0, 3)], settler);
    expect(campaignOf(c.campaign).committed).to.equal(15n * USDC);
    const ch = channelOf(a);
    expect([ch.batches, ch.conversions, ch.earned, ch.claimed]).to.deep.equal([1, 3n, 15n * USDC, 0n]);
    expect(Array.from(ch.evidence)).to.deep.equal(Array(32).fill(1));

    await send([await claimIx(c, a, alice)], alice);
    expect(tokenAmount(await eo.ataAddress(alice.address, c.mint))).to.equal(15n * USDC);
    expect(tokenAmount(c.vault)).to.equal(85n * USDC);
    expect(channelOf(a).claimed).to.equal(15n * USDC);
    expect(campaignOf(c.campaign).claimed).to.equal(15n * USDC);
  });

  it("records each batch exactly once, in order", async () => {
    const c = await newCampaign();
    await fund(c, 100n * USDC);
    const a = await addChannel(c, alice.address);
    await fails([settleIx(c, a, 1, 1)], settler, "WrongBatch");
    await send([settleIx(c, a, 0, 1)], settler);
    await fails([settleIx(c, a, 0, 1)], settler, "WrongBatch");
    await send([settleIx(c, a, 1, 2)], settler);
    expect(channelOf(a).conversions).to.equal(3n);
    await fails([settleIx(c, a, 2, 0)], settler, "NoConversions");
  });

  it("lets only the settler settle", async () => {
    const c = await newCampaign();
    await fund(c, 100n * USDC);
    const a = await addChannel(c, alice.address);
    for (const who of [stranger, advertiser, alice]) {
      await fails([settleIx(c, a, 0, 1, who)], who, "ConstraintHasOne");
    }
  });

  it("will not settle a channel from another campaign", async () => {
    const c1 = await newCampaign();
    const c2 = await newCampaign();
    await fund(c1, 100n * USDC);
    const onC2 = await addChannel(c2, alice.address);
    await fails([settleIx(c1, onC2, 0, 1)], settler, "ConstraintSeeds");
  });

  it("never commits more than was funded", async () => {
    const c = await newCampaign();
    await fund(c, 10n * USDC);
    const a = await addChannel(c, alice.address);
    await fails([settleIx(c, a, 0, 3)], settler, "OverBudget");
    await send([settleIx(c, a, 0, 2)], settler);
    await fails([settleIx(c, a, 1, 1)], settler, "OverBudget");
    await fund(c, 5n * USDC);
    await send([settleIx(c, a, 1, 1)], settler);
    expect(campaignOf(c.campaign).committed).to.equal(15n * USDC);
  });

  it("pays only the payee, and only what is owed", async () => {
    const c = await newCampaign();
    await fund(c, 100n * USDC);
    const a = await addChannel(c, alice.address);
    const b = await addChannel(c, bob.address);
    await send([settleIx(c, a, 0, 2)], settler);

    await fails([await claimIx(c, a, bob)], bob, "ConstraintHasOne");
    await fails([await claimIx(c, b, bob)], bob, "NothingToClaim");
    await send([await claimIx(c, a, alice)], alice);
    await fails([await claimIx(c, a, alice)], alice, "NothingToClaim");

    await send([settleIx(c, a, 1, 1)], settler);
    await send([await claimIx(c, a, alice)], alice);
    expect(tokenAmount(await eo.ataAddress(alice.address, c.mint))).to.equal(15n * USDC);
  });

  it("lets a payee move to a new wallet, earnings and all", async () => {
    const c = await newCampaign();
    await fund(c, 100n * USDC);
    const a = await addChannel(c, alice.address);
    await send([settleIx(c, a, 0, 2)], settler);

    await fails([eo.setPayeeIx({ payee: bob, channel: a, newPayee: bob.address })], bob, "ConstraintHasOne");
    await send([eo.setPayeeIx({ payee: alice, channel: a, newPayee: bob.address })], alice);
    await fails([await claimIx(c, a, alice)], alice, "ConstraintHasOne");
    await send([await claimIx(c, a, bob)], bob);
    expect(tokenAmount(await eo.ataAddress(bob.address, c.mint))).to.equal(10n * USDC);
  });

  it("refunds only what was never committed, and only after the deadline", async () => {
    const c = await newCampaign();
    await fund(c, 100n * USDC);
    const a = await addChannel(c, alice.address);
    await send([settleIx(c, a, 0, 3)], settler);
    const advertiserAta = await eo.ataAddress(advertiser.address, c.mint);
    const before = tokenAmount(advertiserAta);

    await fails([await refundIx(c)], advertiser, "TooEarlyToRefund");
    setClock(Number(c.settleDeadline));
    await fails([await refundIx(c)], advertiser, "TooEarlyToRefund");

    setClock(Number(c.settleDeadline) + 1);
    await fails([settleIx(c, a, 1, 1)], settler, "SettlementClosed");
    await send([await refundIx(c)], advertiser);
    expect(tokenAmount(advertiserAta) - before).to.equal(85n * USDC);
    await fails([await refundIx(c)], advertiser, "NothingToRefund");
    await fails([await eo.refundIx({ advertiser: stranger, campaign: c.campaign, mint: c.mint })], stranger, "ConstraintSeeds");

    // What a channel earned is still there after the refund.
    await send([await claimIx(c, a, alice)], alice);
    expect(tokenAmount(c.vault)).to.equal(0n);
    const k = campaignOf(c.campaign);
    expect(k.funded).to.equal(k.claimed + k.refunded);
  });

  it("takes no channels once the campaign ends, and no money after the deadline", async () => {
    const c = await newCampaign();
    await fund(c, 10n * USDC);
    setClock(Number(c.endsAt));
    await fails([await eo.addChannelIx({ advertiser, campaign: c.campaign, index: 0, payee: alice.address })], advertiser, "CampaignEnded");
    await fund(c, 1n * USDC); // a top-up after the end is still allowed
    setClock(Number(c.settleDeadline) + 1);
    const source = await eo.ataAddress(advertiser.address, c.mint);
    await fails([await eo.fundIx({ funder: advertiser, campaign: c.campaign, mint: c.mint, source, amount: 1n })], advertiser, "SettlementClosed");
  });

  it("lets only the advertiser add channels", async () => {
    const c = await newCampaign();
    await fails(
      [await eo.addChannelIx({ advertiser: stranger, campaign: c.campaign, index: 0, payee: stranger.address })],
      stranger,
      "ConstraintSeeds",
    );
  });

  it("works the same with a Token-2022 mint", async () => {
    const c = await newCampaign({ tokenProgram: eo.TOKEN_2022_PROGRAM });
    await fund(c, 50n * USDC);
    const a = await addChannel(c, alice.address);
    await send([settleIx(c, a, 0, 4)], settler);
    await send([await claimIx(c, a, alice)], alice);
    expect(tokenAmount(await eo.ataAddress(alice.address, c.mint, eo.TOKEN_2022_PROGRAM))).to.equal(20n * USDC);
    setClock(Number(c.settleDeadline) + 1);
    await send([await refundIx(c)], advertiser);
    expect(tokenAmount(c.vault)).to.equal(0n);
  });

  // ── the tag ───────────────────────────────────────────────────────────────

  function systemTransfer(from: KeyPairSigner, to: Address, amount: bigint): Instruction {
    const d = new Uint8Array(12);
    const v = new DataView(d.buffer);
    v.setUint32(0, 2, true);
    v.setBigUint64(4, amount, true);
    return {
      programAddress: eo.SYSTEM_PROGRAM,
      accounts: [
        { address: from.address, role: AccountRole.WRITABLE_SIGNER, signer: from },
        { address: to, role: AccountRole.WRITABLE },
      ],
      data: d,
    } as Instruction;
  }

  it("rides along in someone else's transaction, and the settler can read it", async () => {
    const c = await newCampaign();
    const keys = referenceKeys(randomBytes(32), c.campaign);
    const reference = issueReference(keys, 4, NOW);
    const signature = await eo.signReference(identity, reference);
    const user = stranger;

    // A user's purchase: here a plain SOL transfer, plus our two instructions.
    const tag = eo.tagInstructions({ campaign: c.campaign, identity: identityAddress, reference, signature });
    const res = await send([systemTransfer(user, advertiser.address, 1_000_000n), ...tag], user);
    const logs = res.logs().join("\n");
    expect(logs).to.include(eo.PROGRAM_ADDRESS);
    expect(logs).to.include(eo.MEMO_PROGRAM);

    // What an indexer does with the memo it gets back from RPC.
    const memo = eo.identifierMemo(identityAddress, reference, signature);
    const [found] = await eo.verifiedReferences(identityAddress, `[${memo.length}] ${memo}`);
    expect(found).to.equal(reference);
    expect(openReference(keys, found)).to.deep.equal({ channel: 4, issuedAt: NOW });
  });

  it("does not fail when the campaign is gone or was never real", async () => {
    const reference = (await generateKeyPairSigner()).address;
    const bogusCampaign = (await generateKeyPairSigner()).address;
    const signature = await eo.signReference(identity, reference);
    expect(exists(bogusCampaign)).to.equal(false);
    const tag = eo.tagInstructions({ campaign: bogusCampaign, identity: identityAddress, reference, signature });
    await send([systemTransfer(stranger, alice.address, 1n), ...tag], stranger);
  });
});
