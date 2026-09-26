/* The demo faucet's rules, with the chain faked. */

import { expect } from "chai";
import { generateKeyPairSigner, type Address } from "@solana/kit";
import { ENOUGH, GRANT, grant, type FaucetDeps, type Limiter } from "../src/server/faucet.ts";

describe("demo faucet", () => {
  let wallet: Address;
  let sent: string[];
  beforeEach(async () => {
    wallet = (await generateKeyPairSigner()).address;
    sent = [];
  });

  const deps = (o: Partial<{ balance: bigint; walletSigs: string[]; faucetSigs: string[]; faucetBalance: bigint }> = {}): FaucetDeps => ({
    balance: async () => o.balance ?? 0n,
    walletSignatures: async () => o.walletSigs ?? [],
    faucetSignatures: async () => o.faucetSigs ?? ["f1", "f2"],
    faucetBalance: async () => o.faucetBalance ?? 2_000_000_000n,
    send: async (w) => {
      sent.push(w);
      return `sig-${sent.length}`;
    },
  });

  it("funds an empty wallet once", async () => {
    const r = await grant(wallet, "1.1.1.1", deps(), new Map());
    expect(r).to.deep.equal({ ok: true, signature: "sig-1" });
    expect(sent).to.deep.equal([wallet]);
  });

  it("refuses bad addresses, wallets with enough, and wallets it already funded", async () => {
    expect(await grant("nope", "ip", deps(), new Map())).to.include({ ok: false, reason: "bad address" });
    expect(await grant(wallet, "ip", deps({ balance: ENOUGH }), new Map())).to.include({ reason: "has enough" });
    expect(await grant(wallet, "ip", deps({ walletSigs: ["x", "f2"] }), new Map())).to.include({ reason: "already granted" });
    expect(await grant(wallet, "ip", deps({ faucetBalance: GRANT }), new Map())).to.include({ reason: "faucet empty" });
    expect(sent).to.deep.equal([]);
  });

  it("allows three grants per IP an hour", async () => {
    const limiter: Limiter = new Map();
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 3; i++) expect((await grant((await generateKeyPairSigner()).address, "ip", deps(), limiter, t0 + i)).ok).to.equal(true);
    expect(await grant(wallet, "ip", deps(), limiter, t0 + 10)).to.include({ reason: "rate limited" });
    expect((await grant(wallet, "other-ip", deps(), limiter, t0 + 10)).ok).to.equal(true);
    expect((await grant((await generateKeyPairSigner()).address, "ip", deps(), limiter, t0 + 3_600_001)).ok).to.equal(true);
  });

  it("does not spend the limit on a refusal", async () => {
    const limiter: Limiter = new Map();
    await grant(wallet, "ip", deps({ balance: ENOUGH }), limiter);
    expect(limiter.get("ip") ?? []).to.deep.equal([]);
  });
});
