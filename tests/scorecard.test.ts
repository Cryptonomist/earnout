/* A creator's record, grouped by X account, from channel facts. */

import { expect } from "chai";
import { buildScorecards, findScorecard, type ChannelFacts } from "../src/lib/scorecard.ts";

const base: ChannelFacts = {
  campaign: "camp1",
  campaignName: "Campaign one",
  slug: "alice",
  index: 0,
  xId: "1001",
  handle: "alice",
  payee: "walletA",
  decimals: 6,
  payout: 5_000_000n,
  stayed: 4n,
  earned: 20_000_000n,
  claimed: 20_000_000n,
  reported: true,
  tagged: 6,
  waiting: 0,
  qualified: 0,
  gone: 2,
  flagged: 0,
  otherRejected: 0,
};

describe("scorecards", () => {
  it("groups channels by X account across campaigns and wallets, and follows the person", () => {
    const facts: ChannelFacts[] = [
      base,
      { ...base, campaign: "camp2", campaignName: "Campaign two", slug: "alice-2", payee: "walletB", stayed: 1n, earned: 5_000_000n, claimed: 0n, tagged: 3, gone: 0, flagged: 2, handle: "alice_new" },
      { ...base, campaign: "camp2", slug: "bob", index: 1, xId: "2002", handle: "bob", payee: "walletC", stayed: 0n, earned: 0n, claimed: 0n, tagged: 4, gone: 0, flagged: 4 },
    ];
    const cards = buildScorecards(facts);
    expect(cards.map((c) => c.handle)).to.deep.equal(["alice_new", "bob"]);

    const alice = cards[0];
    expect(alice).to.include({ xId: "1001", campaigns: 2, tagged: 9, stayed: 5, gone: 2, flagged: 2, otherRejected: 0, pending: 0 });
    expect(alice.payees).to.deep.equal(["walletB", "walletA"]);
    expect(alice.stayRate).to.be.closeTo(5 / 9, 1e-9);
    expect(alice.flagRate).to.be.closeTo(2 / 9, 1e-9);
    expect(alice.earned).to.equal(25_000_000n);
    expect(alice.claimed).to.equal(20_000_000n);

    const bob = cards[1];
    expect(bob.stayRate).to.equal(0);
    expect(bob.flagRate).to.equal(1);
  });

  it("has no rate until a window has closed, and no total across different tokens", () => {
    const [fresh] = buildScorecards([{ ...base, stayed: 0n, earned: 0n, claimed: 0n, tagged: 3, waiting: 3, gone: 0, reported: true }]);
    expect(fresh.stayRate).to.equal(null);
    expect(fresh.pending).to.equal(3);
    const [mixed] = buildScorecards([base, { ...base, campaign: "camp2", decimals: 9 }]);
    expect(mixed.earned).to.equal(null);
    expect(mixed.decimals).to.equal(null);
  });

  it("finds a card by handle in any case, with or without the @, or by X id", () => {
    const cards = buildScorecards([base]);
    expect(findScorecard(cards, "ALICE")?.xId).to.equal("1001");
    expect(findScorecard(cards, "@alice")?.xId).to.equal("1001");
    expect(findScorecard(cards, "1001")?.handle).to.equal("alice");
    expect(findScorecard(cards, "nobody")).to.equal(null);
  });

  it("carries no user wallet", () => {
    const text = JSON.stringify(buildScorecards([base]), (_, v) => (typeof v === "bigint" ? String(v) : v));
    expect(text).to.not.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  });
});
