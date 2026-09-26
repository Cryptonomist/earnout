/* The settler's view of both registries: the file's campaigns and slugs,
 * plus the database's, but only rows whose rules still hash to what the
 * advertiser committed to on chain. */

import { expect } from "chai";
import { generateKeyPairSigner } from "@solana/kit";
import { rulesHash, validateRules } from "../src/lib/rules.ts";
import { mergeRegistry } from "../settler/registry.ts";

const newAddress = async () => (await generateKeyPairSigner()).address;

describe("settler registry", () => {
  it("merges the file with trustworthy rows and skips the rest", async () => {
    const [fileCampaign, dbCampaign, tampered, treasury] = await Promise.all(Array.from({ length: 4 }, newAddress));
    const rules = validateRules({
      name: "Hub campaign",
      destination: "https://app.example.com/",
      conversion: { kind: "program", programId: treasury },
      retention: { kind: "program-activity", programId: treasury, minTransactions: 1 },
    });
    const warnings: string[] = [];
    const reg = await mergeRegistry(
      {
        campaigns: {
          [fileCampaign]: {
            name: "Pilot",
            conversion: { kind: "sol-transfer", to: treasury, minLamports: "10000000" },
            retention: { kind: "sol-balance", minLamports: "5000000" },
          },
        },
        links: { "demo-alice": { campaign: fileCampaign, channel: 0 } },
      },
      {
        campaigns: [
          { campaign: dbCampaign, rules, rules_hash: await rulesHash(rules) },
          { campaign: tampered, rules: { ...rules, name: "Changed after the fact" }, rules_hash: await rulesHash(rules) },
          { campaign: fileCampaign, rules, rules_hash: await rulesHash(rules) },
        ],
        links: [
          { slug: "demo-alice", campaign: fileCampaign, channel: 0 },
          { slug: "hub-bob", campaign: dbCampaign, channel: 0 },
          { slug: "orphan", campaign: tampered, channel: 0 },
        ],
      },
      (s) => warnings.push(s),
    );

    expect(reg.campaigns.map((c) => c.campaign)).to.deep.equal([fileCampaign, dbCampaign]);
    expect(reg.campaigns[0].name).to.equal("Pilot");
    expect(reg.campaigns[1]).to.deep.include({ name: "Hub campaign" });
    expect(reg.campaigns[1].retention).to.deep.include({ kind: "program-activity", minTransactions: 1 });
    expect([...reg.slugs.entries()]).to.deep.equal([
      [`${fileCampaign}:0`, "demo-alice"],
      [`${dbCampaign}:0`, "hub-bob"],
    ]);
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.include(tampered).and.include("hash");
  });
});
