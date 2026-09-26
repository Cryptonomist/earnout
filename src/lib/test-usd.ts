import { address } from "@solana/kit";

/* The devnet test token every campaign made from the hub pays in, standing
 * in for USDC: six decimals, minted by the demo faucet key on request
 * (api/faucet/usd), and the same token the demo campaign already pays its
 * channels in, so a KOL sees one balance. */
export const TEST_USD = {
  mint: address("22TBBqgwrmE1Um7Rq1h3tsWWFyaEa9sZuS4Yj5qqBMG6"),
  decimals: 6,
  symbol: "tUSD",
  /** What the faucet hands out, in base units: $1,000.00. */
  grant: 1_000_000_000n,
} as const;
