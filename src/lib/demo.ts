import { address, lamports } from "@solana/kit";

/* The demo partner: a pretend DeFi app on devnet whose "deposit" is a small
 * SOL transfer into its treasury. The treasury is the demo campaign's
 * advertiser, so the money goes back to whoever pays the channels. */
export const DEMO = {
  chain: "solana:devnet" as const,
  treasury: address("HoYb6BCszJUY89WhKt2itTpxtLHMJKuoEwXwQPdbhtVu"),
  deposit: lamports(10_000_000n), // 0.01 SOL
  /** A deposit plus a comfortable fee. */
  minBalance: 10_100_000n,
  faucet: "https://faucet.solana.com",
  retentionMinutes: 10,
  payout: "5.00",
};

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
