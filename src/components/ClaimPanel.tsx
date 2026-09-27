"use client";

/* An influencer claims what settlements have committed to their channel. Only
 * the channel's payee can; the program checks, and so does this page, so
 * nobody signs a transaction that is bound to fail. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import { address } from "@solana/kit";
import { claimIx } from "../../sdk/program";
import { describeError, rpc, sendInstructions } from "@/lib/browser-rpc";
import { explorerTx, shortAddress } from "@/lib/explorer";
import { CHAIN, ChooseWallet, useBalances, useDevnetWallet, WalletStrip } from "./Wallet";

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
    return (
      <p className="mt-4 leading-7 text-muted">
        Nothing to claim right now. New settlements show up here within a minute.
      </p>
    );
  }
  return connected ? (
    <Claim {...p} wallet={connected.wallet} account={connected.account} />
  ) : (
    <ChooseWallet wallets={wallets} />
  );
}

type State =
  { kind: "idle" | "signing" | "confirming" } | { kind: "done"; tx: string } | { kind: "error"; message: string };

function Claim(p: Props & { wallet: UiWallet; account: UiWalletAccount }) {
  const signer = useWalletAccountTransactionSigner(p.account, CHAIN);
  const router = useRouter();
  const { lamports } = useBalances(p.account.address);
  const [state, setState] = useState<State>({ kind: "idle" });

  const isPayee = p.account.address === p.payee;

  async function claim() {
    try {
      setState({ kind: "signing" });
      const ix = await claimIx({
        payee: signer,
        campaign: address(p.campaign),
        channel: address(p.channel),
        mint: address(p.mint),
      });
      const tx = await sendInstructions(rpc(), signer, [ix], () => setState({ kind: "confirming" }));
      setState({ kind: "done", tx });
      router.refresh();
    } catch (e) {
      setState({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="mt-5">
      <WalletStrip wallet={p.wallet} account={p.account} lamports={lamports} />

      {!isPayee ? (
        <p className="mt-4 leading-7">
          This wallet is not the influencer&apos;s payout wallet. Connect{" "}
          <span className="font-mono">{shortAddress(p.payee)}</span> to claim.
        </p>
      ) : state.kind === "done" ? (
        <p className="mt-4 leading-7">
          <span className="text-paid" aria-hidden="true">
            ✓{" "}
          </span>
          Claimed {p.amountText}.{" "}
          <a href={explorerTx(state.tx)} className="underline underline-offset-2">
            View the transaction
          </a>
          .
        </p>
      ) : (
        <>
          {lamports !== null && lamports < MIN_LAMPORTS && (
            <p className="mt-4 text-sm leading-6">
              The first claim opens a token account, which needs about 0.003 devnet SOL.{" "}
              <a
                href="https://faucet.solana.com"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
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
            {state.kind === "signing"
              ? "Approve in your wallet..."
              : state.kind === "confirming"
                ? "Confirming on devnet..."
                : `Claim ${p.amountText}`}
          </button>
          {state.kind === "error" && <p className="mt-3 text-sm leading-6 text-unpaid">{state.message}</p>}
        </>
      )}
    </div>
  );
}
