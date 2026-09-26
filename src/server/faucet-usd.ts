/* Test dollars for the advertiser hub: $1,000.00 of the devnet test token
 * every hub campaign pays in (lib/test-usd.ts), minted to whoever asks by
 * the faucet key, which holds the token's mint authority. Devnet play money,
 * so the limits are the SOL faucet's: none to a wallet that already has
 * enough, three grants per IP address an hour, per server instance. */

import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Signature,
} from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync, getMintToInstruction } from "@solana-program/token";
import { ataAddress } from "../../sdk/program";
import { TEST_USD } from "../lib/test-usd";
import type { FaucetResult, Limiter } from "./faucet";

/** A wallet with this much already has enough to fund a campaign. */
export const USD_ENOUGH = 100_000_000n;
const PER_IP_PER_HOUR = 3;

export type UsdDeps = {
  balance(wallet: Address): Promise<bigint>;
  send(wallet: Address): Promise<string>;
};

export async function grantUsd(wallet: string, ip: string, deps: UsdDeps, limiter: Limiter, now = Date.now()): Promise<FaucetResult> {
  if (!isAddress(wallet)) return { ok: false, reason: "bad address", message: "That is not a Solana address." };
  const w = address(wallet);

  const recent = (limiter.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    return { ok: false, reason: "rate limited", message: "This connection has had its test dollars for the hour. Try again later." };
  }
  if ((await deps.balance(w)) >= USD_ENOUGH) {
    return { ok: false, reason: "has enough", message: "This wallet already has enough test dollars." };
  }
  limiter.set(ip, [...recent, now]);
  return { ok: true, signature: await deps.send(w) };
}

/** The real thing: FAUCET_KEYPAIR minting TEST_USD over RPC_URL. Null if unset. */
export async function liveUsdDeps(rpcUrl: string, keypairJson: string | undefined): Promise<UsdDeps | null> {
  if (!keypairJson) return null;
  const faucet = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(keypairJson) as number[]));
  const rpc = createSolanaRpc(rpcUrl);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    balance: async (w) => {
      try {
        const { value } = await rpc.getTokenAccountBalance(await ataAddress(w, TEST_USD.mint), { commitment: "confirmed" }).send();
        return BigInt(value.amount);
      } catch {
        return 0n; // No token account yet.
      }
    },
    send: async (w) => {
      const token = await ataAddress(w, TEST_USD.mint);
      const ixs = [
        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: faucet, owner: w, mint: TEST_USD.mint }),
        getMintToInstruction({ mint: TEST_USD.mint, token, mintAuthority: faucet, amount: TEST_USD.grant }),
      ];
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const signed = await signTransactionMessageWithSigners(
        pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(faucet, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
          (m) => appendTransactionMessageInstructions(ixs, m),
        ),
      );
      const signature = getSignatureFromTransaction(signed);
      await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" }).send();
      for (let i = 0; i < 20; i++) {
        const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
        if (value[0]?.err) throw new Error("The faucet mint failed on chain");
        if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return signature;
        await sleep(1_000);
      }
      return signature;
    },
  };
}
