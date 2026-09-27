/* Links out to the Solana explorer, and the short form of an address, for
 * the whole site: the cluster is decided here and nowhere else. The site
 * runs on devnet for the World's Fair; a mainnet deployment changes one
 * line. */

export const CLUSTER = "devnet";

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;

/** The first and last four characters: enough to recognise, not to type. */
export const shortAddress = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
