/* The file store keeps the database store's rule: a ledger saved at a
 * version nobody else has moved, or not at all. */

import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyLedger } from "../settler/core.ts";
import { fileStore } from "../settler/store.ts";

describe("settler file store", () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "earnout-store-"));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a save whose version another run has moved past", async () => {
    const store = fileStore(dir);
    const campaign = "CampaignAddress111111111111111111111111111";
    expect(await store.load(campaign)).to.deep.equal({ ledger: emptyLedger(campaign), version: 0 });

    // Two passes read the same state.
    const a = await store.load(campaign);
    const b = await store.load(campaign);
    a.ledger.cursor = "seenByA";
    b.ledger.cursor = "seenByB";

    expect(await store.save(a.ledger, a.version)).to.equal(1);
    let refused = "";
    await store.save(b.ledger, b.version).catch((e: Error) => (refused = e.message));
    expect(refused).to.include("changed since it was read");

    // The next pass starts from the winner.
    const c = await store.load(campaign);
    expect(c.version).to.equal(1);
    expect(c.ledger.cursor).to.equal("seenByA");
    expect(await store.save(c.ledger, c.version)).to.equal(2);
  });
});
