/* The demo's devnet faucet: 0.02 SOL, enough for the 0.01 deposit, its fee,
 * and the 0.005 the demo campaign asks a wallet to keep. It exists so a
 * judge with an empty devnet wallet can try the demo without a captcha.
 *
 * Limits, all cheap and all best effort (this is devnet SOL):
 *   - only to wallets holding less than 0.015 SOL;
 *   - once per wallet, checked on chain: a wallet that shares a transaction
 *     with the faucet's recent history has had its grant;
 *   - three grants per IP address per hour, per server instance.
 *
 * Every wallet it funds shares one funder, so the demo campaign lists the
 * faucet in `sybil.ignoreFunders`, or the settler would call them all a
 * cluster. That is also why a real campaign would never run one. */

import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isAddress,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Signature,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

export const GRANT = 20_000_000n;
export const ENOUGH = 15_000_000n;
const PER_IP_PER_HOUR = 3;

export type FaucetResult =
  | { ok: true; signature: string }
  | { ok: false; reason: "bad address" | "has enough" | "already granted" | "rate limited" | "faucet empty" | "unavailable"; message: string };

export type FaucetDeps = {
  balance(wallet: Address): Promise<bigint>;
  /** Recent signatures touching the wallet. */
  walletSignatures(wallet: Address): Promise<string[]>;
  /** Recent signatures of the faucet itself. */
  faucetSignatures(): Promise<string[]>;
  faucetBalance(): Promise<bigint>;
  send(wallet: Address): Promise<string>;
};

/** Grants per IP, as timestamps in ms. One map per server instance. */
export type Limiter = Map<string, number[]>;

export async function grant(wallet: string, ip: string, deps: FaucetDeps, limiter: Limiter, now = Date.now()): Promise<FaucetResult> {
  if (!isAddress(wallet)) return { ok: false, reason: "bad address", message: "That is not a Solana address." };
  const w = address(wallet);

  const recent = (limiter.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    return { ok: false, reason: "rate limited", message: "This connection has had its devnet SOL for the hour. Try again later." };
  }

  if ((await deps.balance(w)) >= ENOUGH) {
    return { ok: false, reason: "has enough", message: "This wallet already has enough devnet SOL for the demo." };
  }
  const [mine, faucets] = await Promise.all([deps.walletSignatures(w), deps.faucetSignatures()]);
  const granted = new Set(faucets);
  if (mine.some((s) => granted.has(s))) {
    return { ok: false, reason: "already granted", message: "This wallet has already had devnet SOL from Earnout." };
  }
  if ((await deps.faucetBalance()) < GRANT + 10_000n) {
    return { ok: false, reason: "faucet empty", message: "The demo faucet is empty for now. Use the Solana faucet instead." };
  }

  limiter.set(ip, [...recent, now]);
  return { ok: true, signature: await deps.send(w) };
}

/** The real thing: FAUCET_KEYPAIR, talking to RPC_URL. Null if unset. */
export async function liveDeps(rpcUrl: string, keypairJson: string | undefined): Promise<FaucetDeps | null> {
  if (!keypairJson) return null;
  const faucet = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(keypairJson) as number[]));
  const rpc = createSolanaRpc(rpcUrl);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    balance: async (w) => (await rpc.getBalance(w, { commitment: "confirmed" }).send()).value,
    faucetBalance: async () => (await rpc.getBalance(faucet.address, { commitment: "confirmed" }).send()).value,
    walletSignatures: async (w) =>
      (await rpc.getSignaturesForAddress(w, { limit: 100, commitment: "confirmed" }).send()).map((s) => s.signature),
    faucetSignatures: async () =>
      (await rpc.getSignaturesForAddress(faucet.address, { limit: 1000, commitment: "confirmed" }).send()).map((s) => s.signature),
    send: async (w) => {
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const signed = await signTransactionMessageWithSigners(
        pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(faucet, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
          (m) => appendTransactionMessageInstructions([getTransferSolInstruction({ source: faucet, destination: w, amount: lamports(GRANT) })], m),
        ),
      );
      const signature = getSignatureFromTransaction(signed);
      await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" }).send();
      for (let i = 0; i < 20; i++) {
        const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
        if (value[0]?.err) throw new Error("The faucet transfer failed on chain");
        if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return signature;
        await sleep(1_000);
      }
      return signature;
    },
  };
}
