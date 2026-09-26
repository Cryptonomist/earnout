/* The settler's decisions, with the chain faked: every way a tagged
 * transaction can fail to count, the retention and cluster checks, budget
 * caps, and that a batch is paid exactly once. */

import { expect } from "chai";
import { createHash, randomBytes } from "node:crypto";
import {
  address,
  generateKeyPair,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getBase58Decoder,
  getBase58Encoder,
  type Address,
} from "@solana/kit";
import { IX, PROGRAM_ADDRESS } from "../sdk/generated.ts";
import { identifierMemo, MEMO_PROGRAM, signReference } from "../sdk/identity.ts";
import { SYSTEM_PROGRAM } from "../sdk/program.ts";
import { issueReference, referenceKeys } from "../sdk/reference.ts";
import { parseCampaigns, type CampaignConfig } from "../settler/config.ts";
import {
  admit,
  applyRetention,
  due,
  emptyLedger,
  planBatches,
  receipts,
  reconcile,
  screen,
  type CampaignView,
  type ConvRecord,
  type Ledger,
} from "../settler/core.ts";
import { evidenceHex, evidenceRoot } from "../settler/evidence.ts";
import { buildReport } from "../src/lib/report.ts";
import { parseTransaction, type ParsedTx, type RawTx } from "../settler/parse.ts";

const T0 = 1_800_000_000;
const b58 = { enc: getBase58Decoder(), dec: getBase58Encoder() };
const randomSig = () => b58.enc.decode(randomBytes(64));
const newAddress = async () => (await generateKeyPairSigner()).address;

describe("settler", () => {
  let identity: CryptoKeyPair;
  let IDENTITY: Address;
  let CAMPAIGN: Address, TREASURY: Address, ADVERTISER: Address, ALICE: Address, BOB: Address;
  let keys: ReturnType<typeof referenceKeys>;
  let view: CampaignView;
  let cfg: CampaignConfig;

  before(async () => {
    identity = await generateKeyPair();
    IDENTITY = await getAddressFromPublicKey(identity.publicKey);
    [CAMPAIGN, TREASURY, ADVERTISER, ALICE, BOB] = await Promise.all(Array.from({ length: 5 }, newAddress));
    keys = referenceKeys(randomBytes(32), CAMPAIGN);
    [cfg] = parseCampaigns({
      [CAMPAIGN]: {
        name: "test",
        conversion: { kind: "sol-transfer", to: TREASURY, minLamports: "10000000" },
        retention: { kind: "sol-balance", minLamports: "5000000" },
        attributionWindowSecs: 7 * 86_400,
        sybil: { maxWalletsPerFunder: 3 },
      },
    });
  });

  beforeEach(async () => {
    view = {
      address: CAMPAIGN,
      mint: await newAddress(),
      advertiser: ADVERTISER,
      settler: ADVERTISER,
      identity: IDENTITY,
      payout: 5_000_000n,
      retentionSecs: 600,
      createdAt: T0 - 1_000,
      endsAt: T0 + 10 * 86_400,
      settleDeadline: T0 + 11 * 86_400,
      funded: 500_000_000n,
      committed: 0n,
      channels: [
        { index: 0, address: await newAddress(), payee: ALICE, batches: 0 },
        { index: 1, address: await newAddress(), payee: BOB, batches: 0 },
      ],
    };
  });

  /** A tagged deposit, correct unless told otherwise. */
  async function tagged(o: {
    channel?: number;
    issuedAt?: number;
    blockTime?: number;
    wallet?: Address;
    tagIdentity?: Address;
    signer?: CryptoKeyPair;
    reference?: Address;
    lamports?: bigint;
    to?: Address;
  } = {}): Promise<ParsedTx> {
    const wallet = o.wallet ?? (await newAddress());
    const reference = o.reference ?? issueReference(keys, o.channel ?? 0, o.issuedAt ?? T0);
    const signature = await signReference(o.signer ?? identity, reference);
    return {
      signature: randomSig(),
      slot: 1n,
      blockTime: o.blockTime ?? T0 + 60,
      feePayer: wallet,
      failed: false,
      tags: [{ campaign: CAMPAIGN, identity: o.tagIdentity ?? IDENTITY, reference }],
      memos: [identifierMemo(o.tagIdentity ?? IDENTITY, reference, signature)],
      solMoves: [{ from: wallet, to: o.to ?? TREASURY, lamports: o.lamports ?? 10_000_000n, kind: "transfer" }],
      programs: new Set([SYSTEM_PROGRAM]),
    };
  }

  const firstUseIsSelf = (tx: ParsedTx) => async () => tx.signature;
  const check = async (tx: ParsedTx, firstUse = firstUseIsSelf(tx)) => screen(tx, view, cfg, keys, firstUse);

  // ── screening ───────────────────────────────────────────────────────────

  describe("screening", () => {
    it("accepts a good conversion and reads its channel", async () => {
      const tx = await tagged({ channel: 1 });
      const r = await check(tx);
      expect(r).to.include({ status: "waiting", channel: 1, issuedAt: T0, wallet: tx.feePayer });
    });

    it("ignores transactions with no tag for this campaign, and failed ones", async () => {
      const other = await tagged();
      other.tags[0].campaign = await newAddress();
      expect(await check(other)).to.equal(null);
      const failed = await tagged();
      failed.failed = true;
      expect(await check(failed)).to.equal(null);
    });

    const cases: [string, () => Promise<ParsedTx>, string][] = [];
    before(() => {
      cases.push(
        ["another identity in the tag", async () => tagged({ tagIdentity: address("11111111111111111111111111111112") }), "wrong identity"],
        ["a memo signed by someone else", async () => tagged({ signer: await generateKeyPair() }), "memo not signed"],
        ["a reference we did not issue", async () => tagged({ reference: await newAddress() }), "reference not ours"],
        ["a channel the campaign does not have", async () => tagged({ channel: 2 }), "unknown channel"],
        ["a conversion before the campaign", async () => tagged({ blockTime: T0 - 2_000, issuedAt: T0 - 2_000 }), "outside campaign"],
        ["a conversion after it ended", async () => tagged({ blockTime: T0 + 10 * 86_400, issuedAt: T0 + 10 * 86_400 - 60 }), "outside campaign"],
        ["a click older than the window", async () => tagged({ blockTime: T0 + 7 * 86_400 + 1 }), "click expired"],
        ["a deposit that is too small", async () => tagged({ lamports: 9_999_999n }), "no qualifying action"],
        ["a deposit to somewhere else", async () => tagged({ to: ADVERTISER }), "no qualifying action"],
        ["a channel's own payee converting", async () => tagged({ wallet: ALICE }), "self-referral"],
        ["the advertiser converting", async () => tagged({ wallet: ADVERTISER }), "self-referral"],
      );
    });

    it("refuses every way a tag can be wrong", async () => {
      for (const [what, make, reason] of cases) {
        const r = await check(await make());
        expect(r, what).to.include({ status: "rejected", reason });
      }
    });

    it("refuses a reference that was used first elsewhere", async () => {
      const tx = await tagged();
      expect(await check(tx, async () => randomSig())).to.include({ status: "rejected", reason: "reference reused" });
    });
  });

  // ── ledger ──────────────────────────────────────────────────────────────

  async function ledgerWith(...txs: ParsedTx[]): Promise<Ledger> {
    const ledger = emptyLedger(CAMPAIGN);
    for (const tx of txs) {
      const r = await check(tx);
      if (r) admit(ledger, r);
    }
    return ledger;
  }

  it("counts one conversion per wallet: the first", async () => {
    const wallet = await newAddress();
    const a = await tagged({ wallet, channel: 0, blockTime: T0 + 60 });
    const b = await tagged({ wallet, channel: 1, blockTime: T0 + 120 });
    const ledger = await ledgerWith(a, b);
    expect(ledger.records[a.signature].status).to.equal("waiting");
    expect(ledger.records[b.signature]).to.include({ status: "rejected", reason: "wallet already converted" });
  });

  it("waits out the retention window before deciding", async () => {
    const tx = await tagged({ blockTime: T0 });
    const ledger = await ledgerWith(tx);
    const r = ledger.records[tx.signature];
    expect(due(r, view, T0 + 599)).to.equal(false);
    expect(due(r, view, T0 + 600)).to.equal(true);
  });

  it("qualifies wallets that stayed and refuses those that left", async () => {
    const [stay, leave] = [await tagged(), await tagged()];
    const ledger = await ledgerWith(stay, leave);
    applyRetention(
      ledger,
      {
        [stay.signature]: { stayed: true, funder: null, funderBusy: false },
        [leave.signature]: { stayed: false, funder: null, funderBusy: false },
      },
      view,
      cfg,
    );
    expect(ledger.records[stay.signature].status).to.equal("qualified");
    expect(ledger.records[leave.signature]).to.include({ status: "rejected", reason: "left before retention" });
  });

  it("refuses wallets funded by a channel's payee", async () => {
    const tx = await tagged({ channel: 1 });
    const ledger = await ledgerWith(tx);
    applyRetention(ledger, { [tx.signature]: { stayed: true, funder: ALICE, funderBusy: false } }, view, cfg);
    expect(ledger.records[tx.signature]).to.include({ status: "rejected", reason: "funded by a channel" });
  });

  it("flags a cluster from one quiet funder, but not from a busy one", async () => {
    const farm = await newAddress();
    const faucet = await newAddress();
    const farmed = await Promise.all(Array.from({ length: 4 }, () => tagged()));
    const fauceted = await Promise.all(Array.from({ length: 4 }, () => tagged()));
    const ledger = await ledgerWith(...farmed, ...fauceted);
    const facts = Object.fromEntries([
      ...farmed.map((t) => [t.signature, { stayed: true, funder: farm, funderBusy: false }]),
      ...fauceted.map((t) => [t.signature, { stayed: true, funder: faucet, funderBusy: true }]),
    ]);
    applyRetention(ledger, facts, view, cfg);
    for (const t of farmed) expect(ledger.records[t.signature]).to.include({ status: "rejected", reason: "wallet cluster" });
    for (const t of fauceted) expect(ledger.records[t.signature].status).to.equal("qualified");
  });

  it("allows up to the limit from one funder", async () => {
    const funder = await newAddress();
    const txs = await Promise.all(Array.from({ length: 3 }, () => tagged()));
    const ledger = await ledgerWith(...txs);
    applyRetention(ledger, Object.fromEntries(txs.map((t) => [t.signature, { stayed: true, funder, funderBusy: false }])), view, cfg);
    for (const t of txs) expect(ledger.records[t.signature].status).to.equal("qualified");
  });

  // ── settling ────────────────────────────────────────────────────────────

  async function qualifiedLedger(channels: number[]): Promise<{ ledger: Ledger; txs: ParsedTx[] }> {
    const txs: ParsedTx[] = [];
    for (let i = 0; i < channels.length; i++) txs.push(await tagged({ channel: channels[i], blockTime: T0 + 60 + i }));
    const ledger = await ledgerWith(...txs);
    applyRetention(ledger, Object.fromEntries(txs.map((t) => [t.signature, { stayed: true, funder: null, funderBusy: false }])), view, cfg);
    return { ledger, txs };
  }

  it("plans one batch per channel at the channel's next batch number", async () => {
    view.channels[1].batches = 4;
    const { ledger, txs } = await qualifiedLedger([0, 1, 0]);
    const plans = planBatches(ledger, view);
    expect(plans.map((p) => [p.channel, p.batch, p.signatures.length])).to.deep.equal([
      [0, 0, 2],
      [1, 4, 1],
    ]);
    expect(plans[0].signatures).to.deep.equal([txs[0].signature, txs[2].signature]);
    expect(plans[0].evidence).to.equal(evidenceHex(plans[0].signatures));
  });

  it("stops at the budget, oldest conversions first", async () => {
    view.funded = 15_000_000n;
    view.committed = 5_000_000n; // room for two
    const { ledger, txs } = await qualifiedLedger([1, 0, 1]);
    const plans = planBatches(ledger, view);
    expect(plans.flatMap((p) => p.signatures).sort()).to.deep.equal([txs[0].signature, txs[1].signature].sort());
  });

  it("pays each batch exactly once, across a crash", async () => {
    const { ledger, txs } = await qualifiedLedger([0, 0]);
    const [plan] = planBatches(ledger, view);
    ledger.pending[plan.channel] = plan; // written, then the process died

    // Not on chain yet: the same batch goes again, and nothing new is added.
    const again = planBatches(ledger, view);
    expect(again).to.deep.equal([plan]);

    // It landed: the chain's batch count moved past it.
    view.channels[0].batches = 1;
    view.committed = 10_000_000n;
    reconcile(ledger, view);
    expect(ledger.pending).to.deep.equal({});
    for (const t of txs) expect(ledger.records[t.signature]).to.include({ status: "settled", batch: 0 });
    expect(planBatches(ledger, view)).to.deep.equal([]);
  });

  it("writes the landing page's receipt", async () => {
    const { ledger, txs } = await qualifiedLedger([0, 0, 0]);
    const gone = await tagged({ channel: 0 });
    const cluster = await tagged({ channel: 0 });
    admit(ledger, (await check(gone)) as ConvRecord);
    admit(ledger, (await check(cluster)) as ConvRecord);
    applyRetention(
      ledger,
      {
        [gone.signature]: { stayed: false, funder: null, funderBusy: false },
        [cluster.signature]: { stayed: true, funder: BOB, funderBusy: false },
      },
      view,
      cfg,
    );
    ledger.records[txs[0].signature].status = "settled";
    const [r] = receipts(ledger, view);
    expect(r).to.deep.equal({
      channel: 0,
      tagged: 5,
      waiting: 0,
      gone: 1,
      flagged: 1,
      otherRejected: 0,
      qualified: 2,
      settled: 1,
      paid: 5_000_000n,
    });
  });

  it("publishes counts and settlement links, never a wallet or a conversion", async () => {
    const { ledger, txs } = await qualifiedLedger([0, 1, 0]);
    ledger.batches.push({ channel: 0, batch: 0, signatures: [txs[0].signature], evidence: "ab".repeat(32), tx: "settleTx" });
    const report = buildReport(ledger, view, { cluster: "devnet", name: "test", slugs: new Map([[`${CAMPAIGN}:0`, "alice-link"]]) });
    const text = JSON.stringify(report);
    for (const t of txs) {
      expect(text).to.not.include(t.feePayer);
      expect(text).to.not.include(t.signature);
    }
    expect(report.channels[0]).to.include({ slug: "alice-link", tagged: 2, qualified: 2 });
    expect(report.channels[1]).to.include({ slug: null, tagged: 1 });
    expect(report.batches).to.deep.equal([{ channel: 0, batch: 0, conversions: 1, evidence: "ab".repeat(32), tx: "settleTx" }]);
  });

  // ── evidence ────────────────────────────────────────────────────────────

  it("roots evidence the same whatever order the signatures come in", () => {
    const sigs = Array.from({ length: 5 }, randomSig);
    expect(evidenceHex(sigs)).to.equal(evidenceHex([...sigs].reverse()));
    expect(evidenceHex(sigs)).to.not.equal(evidenceHex(sigs.slice(1)));
    const one = randomSig();
    const leaf = createHash("sha256").update(b58.dec.encode(one) as Uint8Array).digest();
    expect(Buffer.from(evidenceRoot([one])).equals(leaf)).to.equal(true);
    expect(() => evidenceRoot([])).to.throw();
  });

  // ── parsing ─────────────────────────────────────────────────────────────

  it("reads tags, memos, transfers and programs from a raw transaction", async () => {
    const [payer, treasury, reference, partner] = await Promise.all(Array.from({ length: 4 }, newAddress));
    const transfer = (lamports: bigint) => {
      const d = new Uint8Array(12);
      new DataView(d.buffer).setUint32(0, 2, true);
      new DataView(d.buffer).setBigUint64(4, lamports, true);
      return b58.enc.decode(d);
    };
    const memo = "solana-action:a:b:c";
    const raw: RawTx = {
      slot: 7n,
      blockTime: BigInt(T0),
      meta: {
        err: null,
        loadedAddresses: { writable: [], readonly: [partner] },
        innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 2, accounts: [0, 1], data: transfer(3n) }] }],
      },
      transaction: {
        signatures: ["sig1"],
        message: {
          accountKeys: [payer, treasury, SYSTEM_PROGRAM, reference, IDENTITY, CAMPAIGN, PROGRAM_ADDRESS, MEMO_PROGRAM],
          instructions: [
            { programIdIndex: 8, accounts: [], data: b58.enc.decode(new Uint8Array([1])) },
            { programIdIndex: 2, accounts: [0, 1], data: transfer(10_000_000n) },
            { programIdIndex: 6, accounts: [5, 4, 3], data: b58.enc.decode(IX.tag) },
            { programIdIndex: 7, accounts: [], data: b58.enc.decode(new TextEncoder().encode(memo)) },
          ],
        },
      },
    };
    const tx = parseTransaction(raw);
    expect(tx).to.include({ signature: "sig1", blockTime: T0, feePayer: payer, failed: false });
    expect(tx.tags).to.deep.equal([{ campaign: CAMPAIGN, identity: IDENTITY, reference }]);
    expect(tx.memos).to.deep.equal([memo]);
    expect(tx.solMoves).to.deep.equal([
      { from: payer, to: treasury, lamports: 10_000_000n, kind: "transfer" },
      { from: payer, to: treasury, lamports: 3n, kind: "transfer" },
    ]);
    expect([...tx.programs].sort()).to.deep.equal([partner, SYSTEM_PROGRAM, PROGRAM_ADDRESS, MEMO_PROGRAM].sort());
  });
});
