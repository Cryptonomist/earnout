/* Action Identity, as the Solana Actions spec defines it, and the tag that
 * carries it.
 *
 * The identity keypair signs the raw 32 bytes of a reference. The memo is
 *
 *   solana-action:<identity>:<reference>:<signature>
 *
 * all base58, sent through SPL Memo v2 with no accounts (the memo program
 * would demand a signature from any account it is given). The identity and
 * the reference ride as read-only keys on a different instruction, which for
 * Earnout is the program's `tag`. This matches @solana/actions byte for byte;
 * tests/sdk.test.ts checks our memos against its validator.
 *
 * Everything here runs in a browser as well as on the server, except
 * signing, which needs the identity's private key and so belongs on the
 * server that issues links. */

import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getPublicKeyFromAddress,
  signBytes,
  verifySignature,
  type Address,
  type Instruction,
  type SignatureBytes,
} from "@solana/kit";
import { tagIx } from "./program.ts";

export const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const PROTOCOL = "solana-action";

const toB58 = (b: Uint8Array) => getBase58Decoder().decode(b);
const fromB58 = (s: string) => getBase58Encoder().encode(s) as Uint8Array;
const refBytes = (reference: Address) => getAddressEncoder().encode(reference) as Uint8Array;

export async function signReference(identity: CryptoKeyPair, reference: Address): Promise<SignatureBytes> {
  return signBytes(identity.privateKey, refBytes(reference));
}

export function identifierMemo(identity: Address, reference: Address, signature: Uint8Array): string {
  return [PROTOCOL, identity, reference, toB58(signature)].join(":");
}

export type Identifier = { identity: Address; reference: Address; signature: Uint8Array };

/** Parse one memo, or a `;`-separated list as RPC returns them, possibly
 * with the memo program's `[len] ` prefix. Returns every identifier found;
 * signatures are not checked here. */
export function parseIdentifierMemos(memos: string | null | undefined): Identifier[] {
  if (!memos) return [];
  const out: Identifier[] = [];
  for (let memo of memos.split(";")) {
    memo = memo.trim().replace(/^\[\d+\]\s*/, "");
    const parts = memo.split(":");
    if (parts.length !== 4 || parts[0] !== PROTOCOL) continue;
    try {
      const signature = fromB58(parts[3]);
      if (signature.length !== 64) continue;
      out.push({ identity: address(parts[1]), reference: address(parts[2]), signature });
    } catch {
      continue;
    }
  }
  return out;
}

/** The references in `memos` that `identity` really signed. */
export async function verifiedReferences(identity: Address, memos: string | null | undefined): Promise<Address[]> {
  const key = await getPublicKeyFromAddress(identity);
  const found: Address[] = [];
  for (const id of parseIdentifierMemos(memos)) {
    if (id.identity !== identity) continue;
    if (await verifySignature(key, id.signature as SignatureBytes, refBytes(id.reference))) {
      found.push(id.reference);
    }
  }
  return found;
}

export function memoIx(memo: string): Instruction {
  return { programAddress: MEMO_PROGRAM, accounts: [], data: new TextEncoder().encode(memo) } as Instruction;
}

/** Everything needed to tag one transaction for one campaign. */
export type Tag = { campaign: Address; identity: Address; reference: Address; signature: Uint8Array };

/** The two instructions a partner appends to a user's conversion
 * transaction: the tag, then the identifier memo. */
export function tagInstructions(t: Tag): Instruction[] {
  return [
    tagIx({ campaign: t.campaign, identity: t.identity, reference: t.reference }),
    memoIx(identifierMemo(t.identity, t.reference, t.signature)),
  ];
}

/** Whether the tag's signature is the identity's, over the reference. A
 * partner can check this before appending a tag it found in a URL. */
export async function verifyTag(t: Tag): Promise<boolean> {
  try {
    const key = await getPublicKeyFromAddress(t.identity);
    return await verifySignature(key, t.signature as SignatureBytes, refBytes(t.reference));
  } catch {
    return false;
  }
}

/* A tag token is how a signed reference travels from an Earnout link to a
 * partner's page, in the `eo` query parameter:
 *
 *   e1.<campaign>.<identity>.<reference>.<signature>
 *
 * all base58. It carries everything `tagInstructions` needs, so a partner
 * needs no configuration and no RPC call to tag a transaction. The version
 * prefix leaves room to change the format without guessing. */

const TOKEN_VERSION = "e1";

export function encodeTagToken(t: Tag): string {
  return [TOKEN_VERSION, t.campaign, t.identity, t.reference, toB58(t.signature)].join(".");
}

export function decodeTagToken(token: string): Tag | null {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return null;
  try {
    const signature = fromB58(parts[4]);
    if (signature.length !== 64) return null;
    return { campaign: address(parts[1]), identity: address(parts[2]), reference: address(parts[3]), signature };
  } catch {
    return null;
  }
}
