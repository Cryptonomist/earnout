"use client";

/* Wallet Standard, with no adapter: any installed Solana wallet that can sign
 * devnet transactions shows up here. */

import { useState } from "react";
import { useConnect, useWallets, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";

export const CHAIN = "solana:devnet" as const;

/** Installed wallets that can sign for devnet, and the first connected account. */
export function useDevnetWallet(): { wallets: readonly UiWallet[]; connected: { wallet: UiWallet; account: UiWalletAccount } | null } {
  const wallets = useWallets().filter((w) => w.chains.includes(CHAIN) && w.features.includes("solana:signTransaction"));
  const connected = wallets.flatMap((wallet) => wallet.accounts.map((account) => ({ wallet, account })))[0] ?? null;
  return { wallets, connected };
}

export function ChooseWallet({ wallets }: { wallets: readonly UiWallet[] }) {
  if (!wallets.length) {
    return (
      <p className="mt-5 rounded-xl bg-card p-4 text-sm leading-6">
        No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload this page.
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
