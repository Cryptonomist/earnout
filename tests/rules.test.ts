/* The rules an advertiser commits to: what passes, what is refused with a
 * sentence, that the hash does not care about key order, and the memo
 * formats the registry reads back. */

import { expect } from "chai";
import { generateKeyPairSigner } from "@solana/kit";
import { fromBaseUnits, toBaseUnits } from "../src/lib/money.ts";
import {
  canonicalRules,
  linkMemo,
  parseLinkMemo,
  parseRulesMemo,
  rulesHash,
  rulesMemo,
  SLUG,
  slugFor,
  validateRules,
  validDestination,
} from "../src/lib/rules.ts";

const newAddress = async () => (await generateKeyPairSigner()).address;

describe("rules", () => {
  let treasury: string, program: string, faucet: string;
  let demo: Record<string, unknown>;

  before(async () => {
    [treasury, program, faucet] = await Promise.all([newAddress(), newAddress(), newAddress()]);
    demo = {
      name: "  Demo   partner ",
      description: "A pretend DeFi app.",
      destination: "/demo",
      conversion: { kind: "sol-transfer", to: treasury, minLamports: "10000000" },
      retention: { kind: "sol-balance", minLamports: "5000000" },
      attributionWindowSecs: 604800,
      sybil: { maxWalletsPerFunder: 3, ignoreFunders: [faucet, faucet] },
    };
  });

  it("accepts the demo campaign's rules and normalises them", () => {
    const r = validateRules(demo);
    expect(r.name).to.equal("Demo partner");
    expect(r.sybil.ignoreFunders).to.deep.equal([faucet]);
    expect(r.conversion).to.deep.equal({ kind: "sol-transfer", to: treasury, minLamports: "10000000" });
  });

  it("is idempotent: validating the result changes nothing", () => {
    const once = validateRules(demo);
    expect(validateRules(once)).to.deep.equal(once);
    expect(canonicalRules(validateRules(once))).to.equal(canonicalRules(once));
  });

  it("accepts every rule kind, with numbers as strings or numbers", () => {
    const r = validateRules({
      ...demo,
      destination: "https://stonkwars.fun/new",
      conversion: { kind: "program", programId: program },
      retention: { kind: "program-activity", programId: program, minTransactions: "2" },
      attributionWindowSecs: "86400",
    });
    expect(r.retention).to.deep.equal({ kind: "program-activity", programId: program, minTransactions: 2 });
    expect(r.attributionWindowSecs).to.equal(86400);
    const t = validateRules({ ...demo, retention: { kind: "token-balance", mint: program, minAmount: 5 } });
    expect(t.retention).to.deep.equal({ kind: "token-balance", mint: program, minAmount: "5" });
  });

  it("refuses what an advertiser has to fix, with a sentence", () => {
    const bad = (patch: Record<string, unknown>, message: string | RegExp) => expect(() => validateRules({ ...demo, ...patch })).to.throw(message);
    bad({ name: "" }, "name must be 1 to 48");
    bad({ name: "x".repeat(49) }, "name must be 1 to 48");
    bad({ description: "x".repeat(401) }, "at most 400");
    bad({ destination: "http://insecure.example" }, "must use https");
    bad({ destination: "example.com" }, "https URL");
    bad({ destination: "https://user:pw@example.com/" }, "username or password");
    bad({ destination: "//evil.example" }, "characters a link cannot carry");
    bad({ conversion: { kind: "sol-transfer", to: "nope", minLamports: "1" } }, "not a Solana address");
    bad({ conversion: { kind: "sol-transfer", to: treasury, minLamports: "0" } }, "above zero");
    bad({ conversion: { kind: "sol-transfer", to: treasury, minLamports: "1.5" } }, "whole number of base units");
    bad({ conversion: { kind: "airdrop" } }, "what counts as a conversion");
    bad({ retention: { kind: "program-activity", programId: program, minTransactions: 0 } }, "from 1 to 1000");
    bad({ retention: { kind: "nothing" } }, "what counts as staying");
    bad({ attributionWindowSecs: 60 }, "from 600 to");
    bad({ sybil: { maxWalletsPerFunder: 0 } }, "from 1 to 100");
    bad({ sybil: { ignoreFunders: ["nope"] } }, "not a Solana address");
    expect(() => validateRules(null)).to.throw("must be an object");
  });

  it("normalises https destinations and keeps paths", () => {
    expect(validDestination("https://stonkwars.fun")).to.equal("https://stonkwars.fun/");
    expect(validDestination("https://app.example.com/deposit?ref=x")).to.equal("https://app.example.com/deposit?ref=x");
    expect(validDestination("/demo?utm=x")).to.equal("/demo?utm=x");
  });

  it("hashes the same rules to the same hash whatever the key order", async () => {
    const a = validateRules(demo);
    const shuffled = validateRules({
      sybil: { ignoreFunders: [faucet], maxWalletsPerFunder: 3 },
      attributionWindowSecs: 604800,
      retention: { minLamports: "5000000", kind: "sol-balance" },
      conversion: { minLamports: "10000000", to: treasury, kind: "sol-transfer" },
      destination: "/demo",
      description: "A pretend DeFi app.",
      name: "Demo partner",
    });
    expect(canonicalRules(shuffled)).to.equal(canonicalRules(a));
    const h = await rulesHash(a);
    expect(h).to.match(/^[0-9a-f]{64}$/);
    expect(await rulesHash(shuffled)).to.equal(h);
    expect(await rulesHash(validateRules({ ...demo, name: "Other" }))).to.not.equal(h);
  });

  it("round-trips the memos and refuses lookalikes", async () => {
    const h = await rulesHash(validateRules(demo));
    expect(parseRulesMemo(rulesMemo(h))).to.equal(h);
    expect(parseRulesMemo(` ${rulesMemo(h)} `)).to.equal(h);
    expect(parseRulesMemo(rulesMemo(h.toUpperCase()))).to.equal(null);
    expect(parseRulesMemo(rulesMemo(h.slice(1)))).to.equal(null);
    expect(parseRulesMemo("solana-action:x:y:z")).to.equal(null);

    const memo = linkMemo(treasury, 2, "stonk-wars-cryptonomist");
    expect(parseLinkMemo(memo)).to.deep.equal({ campaign: treasury, index: 2, slug: "stonk-wars-cryptonomist" });
    expect(parseLinkMemo(linkMemo("notanaddress", 0, "x"))).to.equal(null);
    expect(parseLinkMemo(linkMemo(treasury, 0, "Bad_Slug"))).to.equal(null);
    expect(parseLinkMemo(`${memo}:extra`)).to.equal(null);
  });

  it("makes a slug from a campaign name and a handle", () => {
    expect(slugFor("Stonk Wars", "CRYPT0NOMIST")).to.equal("stonk-wars-crypt0nomist");
    expect(slugFor("  My demo campaign!! ", "alice_x")).to.equal("my-demo-campaign-alice-x");
    expect(slugFor("***", "bob")).to.equal("bob");
    const long = slugFor("a".repeat(80), "b".repeat(15));
    expect(long.length).to.be.at.most(64);
    expect(long).to.match(SLUG);
  });
});

describe("amounts", () => {
  it("reads token amounts into base units and back", () => {
    expect(toBaseUnits("12.5", 6)).to.equal(12_500_000n);
    expect(toBaseUnits("100", 6)).to.equal(100_000_000n);
    expect(toBaseUnits(" 0.000001 ", 6)).to.equal(1n);
    expect(toBaseUnits("0.0000001", 6)).to.equal(null);
    expect(toBaseUnits("0", 6)).to.equal(null);
    expect(toBaseUnits("-1", 6)).to.equal(null);
    expect(toBaseUnits("1e3", 6)).to.equal(null);
    expect(fromBaseUnits(12_500_000n, 6)).to.equal("12.5");
    expect(fromBaseUnits(5n, 6)).to.equal("0.000005");
    expect(fromBaseUnits(100_000_000n, 6)).to.equal("100");
  });
});
