"use client";

/* A KOL claims what settlements have committed to their channel. Only
 * the channel's payee can; the program checks, and so does this page, so
 * nobody signs a transaction that is bound to fail. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDisconnect, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { claimIx } from "../../sdk/program";
import { confirmSignature, describeError, rpc, shortAddress, sol } from "@/lib/browser-rpc";
import { CHAIN, ChooseWallet, useDevnetWallet } from "./Wallet";

type Props = {
  campaign: string;
  channel: string;
  mint: string;
  payee: string;
  /** Base units, as a string (bigints do not cross into client components). */
  claimable: string;
  amountText: string;
};

/** A new token account costs about 0.002 SOL of rent, plus the fee. */
const MIN_LAMPORTS = 3_000_000n;

export function ClaimPanel(p: Props) {
  const { wallets, connected } = useDevnetWallet();
  if (BigInt(p.claimable) === 0n) {
    return <p className="mt-4 leading-7 text-muted">Nothing to claim right now. New settlements show up here within a minute.</p>;
  }
  return connected ? <Claim {...p} wallet={connected.wallet} account={connected.account} /> : <ChooseWallet wallets={wallets} />;
}

function Claim(p: Props & { wallet: UiWallet; account: UiWalletAccount }) {
  const signer = useWalletAccountTransactionSigner(p.account, CHAIN);
  const [, disconnect] = useDisconnect(p.wallet);
  const router = useRouter();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "signing" | "confirming" } | { kind: "done"; tx: string } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  useEffect(() => {
    rpc()
      .getBalance(address(p.account.address), { commitment: "confirmed" })
      .send()
      .then((r) => setBalance(r.value))
      .catch(() => setBalance(null));
  }, [p.account.address]);

  const isPayee = p.account.address === p.payee;

  async function claim() {
    const client = rpc();
    try {
      setState({ kind: "signing" });
      const ix = await claimIx({ payee: signer, campaign: address(p.campaign), channel: address(p.channel), mint: address(p.mint) });
      const { value: blockhash } = await client.getLatestBlockhash({ commitment: "confirmed" }).send();
      const signed = await signTransactionMessageWithSigners(
        pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
          (m) => appendTransactionMessageInstructions([ix], m),
        ),
      );
      const tx = getSignatureFromTransaction(signed);
      setState({ kind: "confirming" });
      await client.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
      await confirmSignature(client, tx);
      setState({ kind: "done", tx });
      router.refresh();
    } catch (e) {
      setState({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 font-mono text-sm">
        <span>
          {p.wallet.name} {shortAddress(p.account.address)}
        </span>
        <span className="text-muted">
          {balance === null ? "" : `${sol(balance)} devnet SOL`}
          <button onClick={() => void disconnect()} className="ml-4 underline decoration-line underline-offset-2 hover:text-ink">
            disconnect
          </button>
        </span>
      </div>

      {!isPayee ? (
        <p className="mt-4 leading-7">
          This wallet is not the KOL&apos;s payout wallet. Connect <span className="font-mono">{shortAddress(p.payee)}</span> to
          claim.
        </p>
      ) : state.kind === "done" ? (
        <p className="mt-4 leading-7">
          <span className="text-paid" aria-hidden="true">
            ✓{" "}
          </span>
          Claimed {p.amountText}.{" "}
          <a href={`https://explorer.solana.com/tx/${state.tx}?cluster=devnet`} className="underline underline-offset-2">
            View the transaction
          </a>
          .
        </p>
      ) : (
        <>
          {balance !== null && balance < MIN_LAMPORTS && (
            <p className="mt-4 text-sm leading-6">
              The first claim opens a token account, which needs about 0.003 devnet SOL.{" "}
              <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Get some from the Solana faucet
              </a>
              .
            </p>
          )}
          <button
            onClick={() => void claim()}
            disabled={state.kind === "signing" || state.kind === "confirming"}
            className="mt-5 rounded-full bg-ink px-6 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-50"
          >
            {state.kind === "signing" ? "Approve in your wallet..." : state.kind === "confirming" ? "Confirming on devnet..." : `Claim ${p.amountText}`}
          </button>
          {state.kind === "error" && <p className="mt-3 text-sm leading-6 text-unpaid">{state.message}</p>}
        </>
      )}
    </div>
  );
}
