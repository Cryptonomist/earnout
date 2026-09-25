"use client";

/* Connect a wallet and make the demo deposit with the tag on it.
 *
 * The wallet only signs; the page sends through /api/rpc to devnet. Asking
 * the wallet to send would put the transaction on whatever network the
 * wallet is set to, and a Phantom left on mainnet would lose it. */

import { useEffect, useState } from "react";
import { useConnect, useDisconnect, useWallets, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Signature,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { tagInstructions, verifiedReferences, type Tag } from "../../sdk/identity";
import { clearTag } from "../../sdk/client";
import { DEMO } from "@/lib/demo";

export type DepositResult = {
  signature: string;
  wallet: string;
  memo: string | null;
  foundByReference: boolean;
  signedByIdentity: boolean;
};

const rpc = () => createSolanaRpc(new URL("/api/rpc", location.origin).toString());
const sol = (l: bigint) => (Number(l) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DemoDeposit({ tag, onDeposited }: { tag: Tag; onDeposited: (r: DepositResult) => void }) {
  const wallets = useWallets().filter(
    (w) => w.chains.includes(DEMO.chain) && w.features.includes("solana:signTransaction"),
  );
  const connected = wallets.flatMap((wallet) => wallet.accounts.map((account) => ({ wallet, account })))[0];

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

function ChooseWallet({ wallets }: { wallets: readonly UiWallet[] }) {
  if (!wallets.length) {
    return (
      <p className="mt-5 rounded-xl bg-card p-4 text-sm leading-6">
        No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload this page; your tag
        will still be here.
      </p>
    );
  }
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-3">
        {wallets.map((w) => (
          <ConnectButton key={w.name} wallet={w} />
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-muted">
        Any network setting works, since this page sends to devnet itself; your wallet may just show a warning if it is
        set to mainnet.
      </p>
    </div>
  );
}

function ConnectButton({ wallet }: { wallet: UiWallet }) {
  const [connecting, connect] = useConnect(wallet);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        onClick={() => connect().catch(() => setError("Not connected"))}
        disabled={connecting}
        className="inline-flex items-center gap-2.5 rounded-full border border-line bg-card px-4 py-2.5 font-medium hover:border-ink disabled:opacity-60"
      >
        {/* Wallet icons are data URIs supplied by the wallet itself. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wallet.icon} alt="" className="size-5 rounded" />
        {connecting ? "Connecting..." : `Connect ${wallet.name}`}
      </button>
      {error && <p className="mt-1 text-xs text-unpaid">{error}</p>}
    </div>
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
      await confirm(client, signature);
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
      setPhase({ kind: "error", message: describe(e) });
    }
  }

  const tooLow = balance !== null && balance < DEMO.minBalance;
  const busy = phase.kind === "signing" || phase.kind === "confirming";

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 font-mono text-sm">
        <span>
          {wallet.name} {short(account.address)}
        </span>
        <span className="text-muted">
          {balance === null ? "balance unknown" : `${sol(balance)} devnet SOL`}
          <button onClick={() => void disconnect()} className="ml-4 underline decoration-line underline-offset-2 hover:text-ink">
            disconnect
          </button>
        </span>
      </div>

      {tooLow && (
        <p className="mt-3 text-sm leading-6">
          This wallet needs at least 0.0101 devnet SOL.{" "}
          <a href={DEMO.faucet} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Get some from the Solana faucet
          </a>
          , then{" "}
          <button onClick={() => void refreshBalance()} className="underline underline-offset-2">
            check again
          </button>
          .
        </p>
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
        <p className="mt-3 font-mono text-xs text-muted">sent {short(phase.signature)}, waiting for confirmation</p>
      )}
      {phase.kind === "error" && <p className="mt-3 text-sm leading-6 text-unpaid">{phase.message}</p>}
    </div>
  );
}

type Rpc = ReturnType<typeof rpc>;

async function confirm(client: Rpc, signature: string) {
  for (let i = 0; i < 40; i++) {
    const { value } = await client.getSignatureStatuses([signature as Signature]).send();
    const status = value[0];
    if (status?.err) throw new Error("The deposit failed on chain.");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await sleep(1_500);
  }
  throw new Error("Not confirmed after a minute. It may still land; check the explorer.");
}

/* An RPC can take a moment to index a new transaction by address. */
async function findByReference(client: Rpc, tag: Tag, signature: string) {
  for (let i = 0; i < 6; i++) {
    const list = await client.getSignaturesForAddress(tag.reference, { commitment: "confirmed" }).send();
    const hit = list.find((s) => s.signature === signature);
    if (hit) return hit;
    await sleep(1_500);
  }
  return null;
}

function describe(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e);
  if (/reject|denied|declin|cancel/i.test(text)) return "You declined in your wallet. Nothing was sent.";
  if (/insufficient|debit an account/i.test(text)) return "Not enough devnet SOL for the deposit and its fee.";
  if (/blockhash/i.test(text)) return "That took too long and the transaction expired. Try again.";
  if (/429|too many/i.test(text)) return "Devnet is rate-limiting right now. Wait a few seconds and try again.";
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
