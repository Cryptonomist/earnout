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

/** The two instructions a partner appends to a user's conversion
 * transaction: the tag, then the identifier memo. */
export function tagInstructions(p: {
  campaign: Address;
  identity: Address;
  reference: Address;
  signature: Uint8Array;
}): Instruction[] {
  return [
    tagIx({ campaign: p.campaign, identity: p.identity, reference: p.reference }),
    memoIx(identifierMemo(p.identity, p.reference, p.signature)),
  ];
}

/* A tag token is how a signed reference travels from our link to a partner's
 * page: `<reference>.<signature>`, both base58, short enough for a URL. */

export function encodeTagToken(reference: Address, signature: Uint8Array): string {
  return `${reference}.${toB58(signature)}`;
}

export function decodeTagToken(token: string): { reference: Address; signature: Uint8Array } | null {
  const [ref, sig, ...rest] = token.split(".");
  if (!ref || !sig || rest.length) return null;
  try {
    const signature = fromB58(sig);
    if (signature.length !== 64) return null;
    return { reference: address(ref), signature };
  } catch {
    return null;
  }
}
