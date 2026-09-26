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

/** A sentence a person can act on, from whatever a wallet or RPC threw. */
export function describeError(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e);
  if (/reject|denied|declin|cancel/i.test(text)) return "You declined in your wallet. Nothing was sent.";
  if (/insufficient|debit an account/i.test(text)) return "Not enough devnet SOL for this and its fee.";
  if (/blockhash/i.test(text)) return "That took too long and the transaction expired. Try again.";
  if (/429|too many/i.test(text)) return "Devnet is rate-limiting right now. Wait a few seconds and try again.";
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
