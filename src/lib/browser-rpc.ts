/* Browser-side chain access, all through /api/rpc so no key reaches a page,
 * and the small helpers every wallet flow on the site needs. */

import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import { ataAddress } from "../../sdk/program";

export const rpc = () => createSolanaRpc(new URL("/api/rpc", location.origin).toString());
export type BrowserRpc = ReturnType<typeof rpc>;

/** Build, sign and send one transaction of `ixs`, paid by `signer`, and
 * wait for it. `onSent` gets the signature as soon as the wallet has signed. */
export async function sendInstructions(
  client: BrowserRpc,
  signer: TransactionSigner,
  ixs: Instruction[],
  onSent?: (signature: string) => void,
): Promise<string> {
  const { value: blockhash } = await client.getLatestBlockhash({ commitment: "confirmed" }).send();
  const signed = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    ),
  );
  const signature = getSignatureFromTransaction(signed);
  onSent?.(signature);
  await client.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  await confirmSignature(client, signature);
  return signature;
}

/** A wallet's balance of a token, in base units; 0 when it has no account. */
export async function tokenBalance(client: BrowserRpc, owner: Address, mint: Address): Promise<bigint> {
  try {
    const { value } = await client.getTokenAccountBalance(await ataAddress(owner, mint), { commitment: "confirmed" }).send();
    return BigInt(value.amount);
  } catch {
    return 0n;
  }
}

/** A mint's decimals, or null if there is no mint at that address. */
export async function mintDecimals(client: BrowserRpc, mint: Address): Promise<number | null> {
  try {
    const { value } = await client.getAccountInfo(mint, { encoding: "base64", commitment: "confirmed" }).send();
    if (!value) return null;
    const data = getBase64Encoder().encode(value.data[0]) as Uint8Array;
    return data.length >= 45 ? data[44] : null;
  } catch {
    return null;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const shortAddress = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
export const sol = (lamports: bigint) => (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Poll until confirmed, for about a minute. */
export async function confirmSignature(client: BrowserRpc, signature: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const { value } = await client.getSignatureStatuses([signature as Signature]).send();
    const status = value[0];
    if (status?.err) throw new Error("The transaction failed on chain.");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await sleep(1_500);
  }
  throw new Error("Not confirmed after a minute. It may still land; check the explorer.");
}

/** A sentence a person can act on, from whatever a wallet or RPC threw.
 * Kit errors keep the useful part (the server's message, the program logs)
 * in `context`, not the message, so that is read too. */
export function describeError(e: unknown): string {
  const err = e as { message?: string; cause?: unknown; context?: Record<string, unknown> };
  const context = err?.context ? JSON.stringify(err.context) : "";
  const text = `${err?.message ?? String(e)} ${String(err?.cause ?? "")} ${context}`;
  if (/reject|denied|declin|cancel/i.test(text)) return "You declined in your wallet. Nothing was sent.";
  if (/AccountNotFound|debit an account|insufficient (funds|lamports)|InsufficientFunds|-32002/i.test(text)) {
    return "This wallet does not have enough devnet SOL for the rent and fee.";
  }
  if (/blockhash/i.test(text)) return "That took too long and the transaction expired. Try again.";
  if (/429|too many/i.test(text)) return "Devnet is rate-limiting right now. Wait a few seconds and try again.";
  // Anchor logs its own sentence for a program error; that beats a hex code.
  const program = /Error Message: ([^."\n\\]+)/.exec(text);
  if (program) return `${program[1].trim()}.`;
  return err?.message ?? "Something went wrong. Try again.";
}
