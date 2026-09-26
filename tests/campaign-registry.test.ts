/* What earns a row in the registry: a confirmed transaction the advertiser
 * paid for, carrying the right memo. Everything else is refused with a
 * status and a sentence, and nothing is written twice. */

import { expect } from "chai";
import { address, generateKeyPairSigner, type Address } from "@solana/kit";
import type { Campaign } from "../sdk/program.ts";
import type { ParsedTx } from "../settler/parse.ts";
import { linkMemo, rulesHash, rulesMemo, validateRules, type Rules } from "../src/lib/rules.ts";
import { registerCampaign, registerLink, type CampaignRow, type LinkRow, type RegistryDeps } from "../src/server/campaign-registry.ts";

const newAddress = async () => (await generateKeyPairSigner()).address;
const SIG = "5".repeat(88);
const OTHER_SIG = "6".repeat(88);

function tx(p: { feePayer: Address; memos?: string[]; failed?: boolean }): ParsedTx {
  return {
    signature: SIG,
    slot: 1n,
    blockTime: 1_800_000_000,
    feePayer: p.feePayer,
    failed: p.failed ?? false,
    tags: [],
    memos: p.memos ?? [],
    solMoves: [],
    programs: new Set(),
  };
}

describe("campaign registry", () => {
  let identity: Address, advertiser: Address, stranger: Address, campaign: Address, other: Address, treasury: Address;
  let rules: Rules;
  let hash: string;
  let onChain: Campaign;

  let txs: Map<string, ParsedTx>;
  let chain: Map<string, Campaign>;
  let campaigns: Map<string, CampaignRow>;
  let links: Map<string, LinkRow>;
  let deps: RegistryDeps;

  before(async () => {
    [identity, advertiser, stranger, campaign, other, treasury] = await Promise.all(Array.from({ length: 6 }, newAddress));
    rules = validateRules({
      name: "Stonk Wars",
      description: "",
      destination: "https://stonkwars.fun/new",
      conversion: { kind: "sol-transfer", to: treasury, minLamports: "10000000" },
      retention: { kind: "sol-balance", minLamports: "5000000" },
    });
    hash = await rulesHash(rules);
  });

  beforeEach(async () => {
    onChain = {
      advertiser,
      seed: 1n,
      mint: await newAddress(),
      settler: await newAddress(),
      identity,
      payout: 5_000_000n,
      retentionSecs: 600,
      createdAt: 1_800_000_000n,
      endsAt: 1_800_100_000n,
      settleDeadline: 1_800_200_000n,
      funded: 0n,
      committed: 0n,
      claimed: 0n,
      refunded: 0n,
      channels: 2,
      bump: 255,
    };
    txs = new Map([[SIG, tx({ feePayer: advertiser, memos: [rulesMemo(hash)] })]]);
    chain = new Map([[campaign, onChain]]);
    campaigns = new Map();
    links = new Map();
    deps = {
      cluster: "devnet",
      identity,
      fetchTransaction: async (s) => txs.get(s) ?? null,
      fetchCampaign: async (a) => chain.get(a) ?? null,
      fileSlugs: new Set(["demo-alice"]),
      findCampaign: async (a) => {
        const row = campaigns.get(a);
        return row ? { rules_hash: row.rules_hash } : null;
      },
      findLink: async (slug) => {
        const row = links.get(slug);
        return row ? { campaign: row.campaign, channel: row.channel } : null;
      },
      findChannelLink: async (c, ch) => [...links.values()].find((l) => l.campaign === c && l.channel === ch)?.slug ?? null,
      insertCampaign: async (row) => void campaigns.set(row.campaign, row),
      insertLink: async (row) => void links.set(row.slug, row),
    };
  });

  const create = (patch: Record<string, unknown> = {}) => registerCampaign({ signature: SIG, campaign, rules, ...patch }, deps);

  describe("a campaign", () => {
    it("is recorded from the transaction that created it, once", async () => {
      const r = await create();
      expect(r.ok && r.created).to.equal(true);
      const row = campaigns.get(campaign)!;
      expect(row).to.include({ campaign, cluster: "devnet", advertiser, name: "Stonk Wars", destination: "https://stonkwars.fun/new", rules_hash: hash, rules_tx: SIG });
      expect(row.description).to.equal(null);
      expect(row.rules).to.deep.equal(rules);

      const again = await create();
      expect(again.ok && !again.created).to.equal(true);
      expect(campaigns.size).to.equal(1);
    });

    it("refuses different rules for a registered campaign, even when a later memo commits to them", async () => {
      await create();
      const renamed = { ...rules, name: "Renamed" };
      txs.set(SIG, tx({ feePayer: advertiser, memos: [rulesMemo(await rulesHash(renamed))] }));
      const r = await create({ rules: renamed });
      expect(r).to.deep.include({ ok: false, status: 409 });
      expect(campaigns.get(campaign)!.rules_hash).to.equal(hash);
    });

    it("needs the memo to commit to exactly these rules", async () => {
      txs.set(SIG, tx({ feePayer: advertiser, memos: ["hello"] }));
      expect(await create()).to.deep.include({ ok: false, status: 400 });
      const wrong = await rulesHash(validateRules({ ...rules, name: "Other" }));
      txs.set(SIG, tx({ feePayer: advertiser, memos: [rulesMemo(wrong)] }));
      expect(await create()).to.deep.include({ ok: false, status: 400 });
      expect(campaigns.size).to.equal(0);
    });

    it("refuses anyone but the advertiser", async () => {
      txs.set(SIG, tx({ feePayer: stranger, memos: [rulesMemo(hash)] }));
      expect(await create()).to.deep.include({ ok: false, status: 403 });
    });

    it("waits for the chain, and refuses a failed transaction", async () => {
      txs.clear();
      expect(await create()).to.deep.include({ ok: false, status: 404 });
      txs.set(SIG, tx({ feePayer: advertiser, memos: [rulesMemo(hash)], failed: true }));
      expect(await create()).to.deep.include({ ok: false, status: 400 });
      txs.set(SIG, tx({ feePayer: advertiser, memos: [rulesMemo(hash)] }));
      chain.clear();
      expect(await create()).to.deep.include({ ok: false, status: 404 });
    });

    it("refuses a campaign under another identity", async () => {
      chain.set(campaign, { ...onChain, identity: stranger });
      const r = await create();
      expect(r).to.deep.include({ ok: false, status: 400 });
      expect(!r.ok && r.error).to.match(/identity/);
    });

    it("refuses bad input before touching anything", async () => {
      expect(await create({ signature: "short" })).to.deep.include({ ok: false, status: 400 });
      expect(await create({ campaign: "nope" })).to.deep.include({ ok: false, status: 400 });
      const r = await create({ rules: { ...rules, destination: "http://x" } });
      expect(r).to.deep.include({ ok: false, status: 400 });
      expect(!r.ok && r.error).to.match(/https/);
    });
  });

  describe("a link", () => {
    beforeEach(async () => {
      await create();
    });

    const name = (memos: string[], feePayer = advertiser) => {
      txs.set(OTHER_SIG, { ...tx({ feePayer, memos }), signature: OTHER_SIG });
      return registerLink({ signature: OTHER_SIG }, deps);
    };

    it("is recorded from the advertiser's memo, once", async () => {
      const r = await name([linkMemo(campaign, 1, "stonk-wars-alice")]);
      expect(r.ok && r.created).to.equal(true);
      expect(links.get("stonk-wars-alice")).to.deep.equal({ slug: "stonk-wars-alice", campaign, channel: 1, link_tx: OTHER_SIG });
      const again = await name([linkMemo(campaign, 1, "stonk-wars-alice")]);
      expect(again.ok && !again.created).to.equal(true);
    });

    it("needs exactly one link memo", async () => {
      expect(await name([])).to.deep.include({ ok: false, status: 400 });
      expect(await name([linkMemo(campaign, 0, "a"), linkMemo(campaign, 1, "b")])).to.deep.include({ ok: false, status: 400 });
    });

    it("refuses a channel that does not exist yet", async () => {
      const r = await name([linkMemo(campaign, 2, "stonk-wars-carol")]);
      expect(r).to.deep.include({ ok: false, status: 400 });
      expect(!r.ok && r.error).to.match(/no channel 2/);
    });

    it("refuses a slug the file or another channel owns", async () => {
      expect(await name([linkMemo(campaign, 0, "demo-alice")])).to.deep.include({ ok: false, status: 409 });
      await name([linkMemo(campaign, 0, "taken")]);
      expect(await name([linkMemo(campaign, 1, "taken")])).to.deep.include({ ok: false, status: 409 });
      const second = await name([linkMemo(campaign, 0, "another-for-zero")]);
      expect(second).to.deep.include({ ok: false, status: 409 });
      expect(!second.ok && second.error).to.match(/already has the link \/r\/taken/);
    });

    it("refuses anyone but the advertiser, and an unregistered campaign", async () => {
      expect(await name([linkMemo(campaign, 0, "x")], stranger)).to.deep.include({ ok: false, status: 403 });
      chain.set(other, { ...onChain });
      const r = await name([linkMemo(other, 0, "y")]);
      expect(r).to.deep.include({ ok: false, status: 400 });
      expect(!r.ok && r.error).to.match(/Register the campaign/);
    });
  });
});

// Keep the type import honest: a Campaign has exactly these fields.
void address;
