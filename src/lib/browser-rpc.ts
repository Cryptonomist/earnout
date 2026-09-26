/* Browser-side chain access, all through /api/rpc so no key reaches a page,
 * and the small helpers every wallet flow on the site needs. */

import { createSolanaRpc, type Signature } from "@solana/kit";

export const rpc = () => createSolanaRpc(new URL("/api/rpc", location.origin).toString());
export type BrowserRpc = ReturnType<typeof rpc>;

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
  return err?.message ?? "Something went wrong. Try again.";
}
