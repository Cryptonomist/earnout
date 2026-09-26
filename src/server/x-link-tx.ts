/* The link transaction the server builds and half-signs.
 *
 * This is the voucher saying "X told me this account belongs to whoever is
 * holding this browser". It is worth nothing on its own: the program also
 * demands the wallet's signature, which only the wallet can add, and which
 * the browser adds next. So the server can never write a name onto a
 * wallet, and a wallet can never write a name the server did not vouch for.
 *
 * Pure, so a test can build one, complete it with a wallet, and send it to
 * LiteSVM. */

import {
  appendTransactionMessageInstructions,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type KeyPairSigner,
} from "@solana/kit";
import { linkXIx } from "../../sdk/program";

export type Lifetime = Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;

export async function buildLinkTransaction(p: {
  identity: KeyPairSigner;
  wallet: Address;
  xId: bigint;
  handle: string;
  lifetime: Lifetime;
}): Promise<string> {
  // The wallet pays and signs, later, in the browser.
  const wallet = createNoopSigner(p.wallet);
  const ix = await linkXIx({ wallet, voucher: p.identity, xId: p.xId, handle: p.handle });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(wallet, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(p.lifetime, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );
  return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message));
}
