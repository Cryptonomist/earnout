/* Signing in with X, the parts that run on our side: the sealed cookie that
 * carries a profile from X's callback to the link, and the half-signed link
 * transaction the server builds, completed by a wallet and accepted by the
 * program in LiteSVM. */

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import {
  address,
  generateKeyPairSigner,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
  signTransaction,
  type Blockhash,
} from "@solana/kit";
import { cleanAvatar, isXId, openProfile, sealProfile } from "../src/server/x-seal.ts";
import { buildLinkTransaction } from "../src/server/x-link-tx.ts";
import { decodeXLink, xlinkAddress } from "../sdk/program.ts";

const SECRET = "client-secret-for-tests";
const NOW = 1_800_000_000_000;

describe("sealed X profile", () => {
  const profile = { xId: "44196397", handle: "elon_alt", avatar: "https://pbs.twimg.com/profile_images/1/x_normal.jpg" };

  it("opens what it sealed, until it expires", () => {
    const token = sealProfile(SECRET, profile, 900, NOW);
    expect(openProfile(SECRET, token, NOW)).to.deep.equal(profile);
    expect(openProfile(SECRET, token, NOW + 899_000)).to.deep.equal(profile);
    expect(openProfile(SECRET, token, NOW + 901_000)).to.equal(null);
  });

  it("refuses a different secret, a changed body, or a changed signature", () => {
    const token = sealProfile(SECRET, profile, 900, NOW);
    expect(openProfile("other", token, NOW)).to.equal(null);
    const [body, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ ...profile, handle: "someone_else", exp: NOW / 1000 + 900 })).toString("base64url");
    expect(openProfile(SECRET, `${other}.${sig}`, NOW)).to.equal(null);
    expect(openProfile(SECRET, `${body}.${sig.slice(0, -1)}A`, NOW)).to.equal(null);
    for (const t of ["", "x", "a.b", undefined]) expect(openProfile(SECRET, t, NOW)).to.equal(null);
  });

  it("refuses a profile the program would not take, even sealed", () => {
    for (const bad of [
      { ...profile, handle: "way_too_long_for_x_1" },
      { ...profile, handle: "no spaces" },
      { ...profile, xId: "0" },
      { ...profile, xId: "abc" },
      { ...profile, xId: "99999999999999999999999" },
    ]) {
      expect(openProfile(SECRET, sealProfile(SECRET, bad, 900, NOW), NOW), JSON.stringify(bad)).to.equal(null);
    }
  });

  it("keeps only avatars from X's own image host", () => {
    expect(cleanAvatar("https://pbs.twimg.com/profile_images/1/x_normal.jpg")).to.equal("https://pbs.twimg.com/profile_images/1/x_normal.jpg");
    expect(cleanAvatar("http://pbs.twimg.com/a.jpg")).to.equal(null);
    expect(cleanAvatar("https://evil.example/pbs.twimg.com/a.jpg")).to.equal(null);
    expect(cleanAvatar("javascript:alert(1)")).to.equal(null);
    expect(cleanAvatar(null)).to.equal(null);
    expect(isXId("18446744073709551615")).to.equal(true);
    expect(isXId("18446744073709551616")).to.equal(false);
  });
});

describe("the half-signed link transaction", () => {
  let svm: LiteSVM;
  beforeEach(() => {
    svm = new LiteSVM();
    const idl = JSON.parse(fs.readFileSync(path.resolve("target/idl/earnout.json"), "utf8"));
    svm.addProgramFromFile(address(idl.address), path.resolve("target/deploy/earnout.so"));
  });

  const lifetime = () => ({ blockhash: svm.latestBlockhash() as Blockhash, lastValidBlockHeight: 1_000_000n });

  it("is completed by the wallet and accepted by the program", async () => {
    const identity = await generateKeyPairSigner();
    const wallet = await generateKeyPairSigner();
    svm.airdrop(wallet.address, lamports(1_000_000_000n));

    const half = await buildLinkTransaction({ identity, wallet: wallet.address, xId: 44196397n, handle: "elon_alt", lifetime: lifetime() });
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(half));
    expect(tx.signatures[identity.address]).to.not.equal(null); // the voucher signed
    expect(tx.signatures[wallet.address]).to.equal(null); // the wallet has not

    const signed = await signTransaction([wallet.keyPair], tx);
    const res = svm.sendTransaction(signed as any);
    if (res instanceof FailedTransactionMetadata) throw new Error(res.meta().prettyLogs());

    const link = decodeXLink(Uint8Array.from((svm.getAccount(await xlinkAddress(identity.address, wallet.address)) as any).data));
    expect(link).to.include({ voucher: identity.address, wallet: wallet.address, xId: 44196397n, handle: "elon_alt" });
  });

  it("is worthless to anyone but that wallet", async () => {
    const identity = await generateKeyPairSigner();
    const wallet = await generateKeyPairSigner();
    const thief = await generateKeyPairSigner();
    svm.airdrop(thief.address, lamports(1_000_000_000n));

    const half = await buildLinkTransaction({ identity, wallet: wallet.address, xId: 7n, handle: "victim", lifetime: lifetime() });
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(half));
    // The wrong key cannot even be put in the wallet's slot.
    let refused = false;
    await signTransaction([thief.keyPair], tx).catch(() => (refused = true));
    expect(refused).to.equal(true);
    // And without the wallet's signature the transaction does not land.
    let landed = true;
    try {
      landed = !(svm.sendTransaction(tx as any) instanceof FailedTransactionMetadata);
    } catch {
      landed = false;
    }
    expect(landed).to.equal(false);
  });
});
