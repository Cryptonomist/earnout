/* The attribution pieces that live off-chain: the reference cipher and the
 * Action Identity memo. The memo tests run both ways against the official
 * @solana/actions package, since the point of following the spec is that
 * anybody's indexer reads our tags. */

import { expect } from "chai";
import { randomBytes } from "node:crypto";
import {
  address,
  generateKeyPair,
  getAddressDecoder,
  getAddressEncoder,
  getAddressFromPublicKey,
} from "@solana/kit";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createActionIdentifierMemo, validateActionIdentifierMemo } from "@solana/actions";
import { issueReference, openReference, referenceKeys } from "../sdk/reference.ts";
import {
  decodeTagToken,
  encodeTagToken,
  identifierMemo,
  parseIdentifierMemos,
  signReference,
  verifiedReferences,
} from "../sdk/identity.ts";

const CAMPAIGN_A = address("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
const CAMPAIGN_B = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

describe("references", () => {
  const master = randomBytes(32);
  const keysA = referenceKeys(master, CAMPAIGN_A);
  const keysB = referenceKeys(master, CAMPAIGN_B);

  it("opens to the channel and time it was issued with", () => {
    const ref = issueReference(keysA, 7, 1_800_000_123);
    expect(openReference(keysA, ref)).to.deep.equal({ channel: 7, issuedAt: 1_800_000_123 });
  });

  it("never repeats, even for the same channel and second", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(issueReference(keysA, 1, 1_800_000_000));
    expect(seen.size).to.equal(500);
  });

  it("does not open under another campaign's keys", () => {
    const ref = issueReference(keysA, 3, 1_800_000_000);
    expect(openReference(keysB, ref)).to.equal(null);
  });

  it("does not open under another master secret", () => {
    const ref = issueReference(keysA, 3, 1_800_000_000);
    expect(openReference(referenceKeys(randomBytes(32), CAMPAIGN_A), ref)).to.equal(null);
  });

  it("rejects a reference with any byte changed", () => {
    const ref = issueReference(keysA, 3, 1_800_000_000);
    for (const at of [0, 15, 16, 31]) {
      const tampered = new Uint8Array(getAddressEncoder().encode(ref));
      tampered[at] ^= 1;
      expect(openReference(keysA, getAddressDecoder().decode(tampered)), `byte ${at}`).to.equal(null);
    }
  });

  it("rejects random addresses", () => {
    for (let i = 0; i < 50; i++) {
      expect(openReference(keysA, getAddressDecoder().decode(randomBytes(32)))).to.equal(null);
    }
  });

  it("refuses a short master secret", () => {
    expect(() => referenceKeys(randomBytes(16), CAMPAIGN_A)).to.throw("at least 32 bytes");
  });
});

describe("identity memo", () => {
  it("is read by @solana/actions", async () => {
    const identity = await generateKeyPair();
    const identityAddress = await getAddressFromPublicKey(identity.publicKey);
    const reference = address(Keypair.generate().publicKey.toBase58());
    const memo = identifierMemo(identityAddress, reference, await signReference(identity, reference));

    const result = validateActionIdentifierMemo(new PublicKey(identityAddress), memo);
    expect(result).to.deep.equal({ verified: true, reference });
  });

  it("reads what @solana/actions writes, with the memo program's length prefix", async () => {
    const identity = Keypair.generate();
    const reference = Keypair.generate().publicKey;
    const memo = createActionIdentifierMemo(identity, reference);
    const rpcMemo = `[${memo.length}] ${memo}`;

    const found = await verifiedReferences(address(identity.publicKey.toBase58()), rpcMemo);
    expect(found).to.deep.equal([reference.toBase58()]);
  });

  it("finds ours among other memos", async () => {
    const identity = await generateKeyPair();
    const identityAddress = await getAddressFromPublicKey(identity.publicKey);
    const reference = address(Keypair.generate().publicKey.toBase58());
    const memo = identifierMemo(identityAddress, reference, await signReference(identity, reference));

    const found = await verifiedReferences(identityAddress, `[5] hello; [${memo.length}] ${memo}`);
    expect(found).to.deep.equal([reference]);
  });

  it("ignores a memo signed by a different identity", async () => {
    const real = await generateKeyPair();
    const forger = await generateKeyPair();
    const realAddress = await getAddressFromPublicKey(real.publicKey);
    const reference = address(Keypair.generate().publicKey.toBase58());
    // Claims the real identity, signed with the forger's key.
    const memo = identifierMemo(realAddress, reference, await signReference(forger, reference));

    expect(parseIdentifierMemos(memo)).to.have.length(1);
    expect(await verifiedReferences(realAddress, memo)).to.deep.equal([]);
  });

  it("ignores a signature moved onto another reference", async () => {
    const identity = await generateKeyPair();
    const identityAddress = await getAddressFromPublicKey(identity.publicKey);
    const signed = address(Keypair.generate().publicKey.toBase58());
    const other = address(Keypair.generate().publicKey.toBase58());
    const memo = identifierMemo(identityAddress, other, await signReference(identity, signed));

    expect(await verifiedReferences(identityAddress, memo)).to.deep.equal([]);
  });

  it("skips malformed memos without throwing", () => {
    for (const m of ["", "solana-action:a:b", "other:1:2:3", "solana-action:x:y:z", null, undefined]) {
      expect(parseIdentifierMemos(m as any)).to.deep.equal([]);
    }
  });
});

describe("tag token", () => {
  it("round-trips a reference and signature", async () => {
    const identity = await generateKeyPair();
    const reference = address(Keypair.generate().publicKey.toBase58());
    const signature = await signReference(identity, reference);
    const token = encodeTagToken(reference, signature);

    const back = decodeTagToken(token);
    expect(back?.reference).to.equal(reference);
    expect(Buffer.from(back!.signature).equals(Buffer.from(signature))).to.equal(true);
  });

  it("rejects anything else", () => {
    for (const t of ["", "abc", "a.b.c", `${CAMPAIGN_A}.`, `${CAMPAIGN_A}.3yZe7d`]) {
      expect(decodeTagToken(t), t).to.equal(null);
    }
  });
});
