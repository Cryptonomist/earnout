"use client";

/* Wallet Standard, with no adapter: any installed Solana wallet that can sign
 * devnet transactions shows up here. On the demo and in the advertiser hub,
 * so does the guest wallet (src/lib/guest-wallet.ts); anywhere a KOL's
 * earnings are at stake, it is left out. */

import { useState } from "react";
import { useConnect, useWallets, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { GUEST_WALLET_NAME } from "@/lib/guest-wallet";

export const CHAIN = "solana:devnet" as const;

export const isGuest = (w: UiWallet) => w.name === GUEST_WALLET_NAME;

/** Installed wallets that can sign for devnet (the guest one only when
 * allowed, and always last), and the first connected account. */
export function useDevnetWallet({ allowGuest = false }: { allowGuest?: boolean } = {}): {
  wallets: readonly UiWallet[];
  connected: { wallet: UiWallet; account: UiWalletAccount } | null;
} {
  const wallets = useWallets()
    .filter((w) => w.chains.includes(CHAIN) && w.features.includes("solana:signTransaction"))
    .filter((w) => allowGuest || !isGuest(w))
    .sort((a, b) => Number(isGuest(a)) - Number(isGuest(b)));
  const connected = wallets.flatMap((wallet) => wallet.accounts.map((account) => ({ wallet, account })))[0] ?? null;
  return { wallets, connected };
}

export function ChooseWallet({ wallets }: { wallets: readonly UiWallet[] }) {
  const installed = wallets.filter((w) => !isGuest(w));
  const guest = wallets.find(isGuest);
  if (!wallets.length) {
    return (
      <p className="mt-5 rounded-xl bg-card p-4 text-sm leading-6">
        No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload this page.
      </p>
    );
  }
  return (
    <div className="mt-5">
      {installed.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {installed.map((w) => (
            <ConnectButton key={w.name} wallet={w} />
          ))}
        </div>
      )}
      {guest && (
        <div className={installed.length ? "mt-5 border-t border-line pt-5" : ""}>
          <ConnectButton wallet={guest} label="Use a guest wallet" />
          <p className="mt-2 text-sm leading-6 text-muted">
            Nothing to install: a devnet-only wallet kept in this browser. Fine for trying the demo; never send it anything
            of value.
          </p>
        </div>
      )}
      {installed.length > 0 && (
        <p className="mt-4 text-sm leading-6 text-muted">
          Any network setting works, since this page sends to devnet itself; your wallet may just show a warning if it is
          set to mainnet.
        </p>
      )}
    </div>
  );
}

function ConnectButton({ wallet, label }: { wallet: UiWallet; label?: string }) {
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
        {connecting ? "Connecting..." : (label ?? `Connect ${wallet.name}`)}
      </button>
      {error && <p className="mt-1 text-xs text-unpaid">{error}</p>}
    </div>
  );
}
