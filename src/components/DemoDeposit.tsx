"use client";

/* Connect a wallet and make the demo deposit with the tag on it.
 *
 * The wallet only signs; the page sends through /api/rpc to devnet. Asking
 * the wallet to send would put the transaction on whatever network the
 * wallet is set to, and a Phantom left on mainnet would lose it. */

import { useEffect, useState } from "react";
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
import { getTransferSolInstruction } from "@solana-program/system";
import { tagInstructions, verifiedReferences, type Tag } from "../../sdk/identity";
import { clearTag } from "../../sdk/client";
import { DEMO } from "@/lib/demo";
import { confirmSignature, describeError, rpc, shortAddress, sleep, sol, type BrowserRpc } from "@/lib/browser-rpc";
import { Faucet } from "./Faucet";
import { ChooseWallet, useDevnetWallet } from "./Wallet";

export type DepositResult = {
  signature: string;
  wallet: string;
  memo: string | null;
  foundByReference: boolean;
  signedByIdentity: boolean;
};

export function DemoDeposit({ tag, onDeposited }: { tag: Tag; onDeposited: (r: DepositResult) => void }) {
  const { wallets, connected } = useDevnetWallet({ allowGuest: true });
  return (
    <section className="mt-6 rounded-2xl border border-line p-7">
      <h2 className="text-lg font-semibold tracking-tight">Make the deposit</h2>
      <p className="mt-2 leading-7 text-muted">
        0.01 devnet SOL into the demo app&apos;s treasury. The tag rides along; nothing else about the deposit changes.
      </p>
      {connected ? (
        <Deposit wallet={connected.wallet} account={connected.account} tag={tag} onDeposited={onDeposited} />
      ) : (
        <ChooseWallet wallets={wallets} />
      )}
    </section>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming"; signature: string }
  | { kind: "error"; message: string };

function Deposit({
  wallet,
  account,
  tag,
  onDeposited,
}: {
  wallet: UiWallet;
  account: UiWalletAccount;
  tag: Tag;
  onDeposited: (r: DepositResult) => void;
}) {
  const signer = useWalletAccountTransactionSigner(account, DEMO.chain);
  const [, disconnect] = useDisconnect(wallet);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const refreshBalance = () =>
    rpc()
      .getBalance(address(account.address), { commitment: "confirmed" })
      .send()
      .then((r) => setBalance(r.value))
      .catch(() => setBalance(null));

  useEffect(() => {
    void refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.address]);

  async function deposit() {
    const client = rpc();
    try {
      setPhase({ kind: "signing" });
      const { value: blockhash } = await client.getLatestBlockhash({ commitment: "confirmed" }).send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) =>
          appendTransactionMessageInstructions(
            [getTransferSolInstruction({ source: signer, destination: DEMO.treasury, amount: DEMO.deposit }), ...tagInstructions(tag)],
            m,
          ),
      );
      const signed = await signTransactionMessageWithSigners(message);
      const signature = getSignatureFromTransaction(signed);

      setPhase({ kind: "confirming", signature });
      await client
        .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
        .send();
      await confirmSignature(client, signature);
      clearTag();

      // Look it up the way the settler will: by its reference.
      const hit = await findByReference(client, tag, signature);
      onDeposited({
        signature,
        wallet: account.address,
        memo: hit?.memo ?? null,
        foundByReference: !!hit,
        signedByIdentity: hit ? (await verifiedReferences(tag.identity, hit.memo)).includes(tag.reference) : false,
      });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }

  const tooLow = balance !== null && balance < DEMO.minBalance;
  const busy = phase.kind === "signing" || phase.kind === "confirming";

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 font-mono text-sm">
        <span>
          {wallet.name} {shortAddress(account.address)}
        </span>
        <span className="text-muted">
          {balance === null ? "balance unknown" : `${sol(balance)} devnet SOL`}
          <button onClick={() => void disconnect()} className="ml-4 underline decoration-line underline-offset-2 hover:text-ink">
            disconnect
          </button>
        </span>
      </div>

      {tooLow && (
        <Faucet
          wallet={account.address}
          onFunded={refreshBalance}
          need="The deposit needs about 0.0101 devnet SOL, and this wallet has less."
        />
      )}

      <button
        onClick={() => void deposit()}
        disabled={busy || tooLow}
        className="mt-5 rounded-full bg-ink px-6 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-50"
      >
        {phase.kind === "signing"
          ? "Approve in your wallet..."
          : phase.kind === "confirming"
            ? "Confirming on devnet..."
            : "Deposit 0.01 devnet SOL"}
      </button>

      {phase.kind === "confirming" && (
        <p className="mt-3 font-mono text-xs text-muted">sent {shortAddress(phase.signature)}, waiting for confirmation</p>
      )}
      {phase.kind === "error" && <p className="mt-3 text-sm leading-6 text-unpaid">{phase.message}</p>}
    </div>
  );
}

/* An RPC can take a moment to index a new transaction by address. */
async function findByReference(client: BrowserRpc, tag: Tag, signature: string) {
  for (let i = 0; i < 6; i++) {
    const list = await client.getSignaturesForAddress(tag.reference, { commitment: "confirmed" }).send();
    const hit = list.find((s) => s.signature === signature);
    if (hit) return hit;
    await sleep(1_500);
  }
  return null;
}
