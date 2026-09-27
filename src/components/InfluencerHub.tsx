"use client";

/* The influencer hub: sign in with X, connect a wallet, link the two on chain,
 * and see the channels this wallet is paid for.
 *
 * Linking is two signatures. The server half-signs the transaction as the
 * Earnout identity (api/x/link); the wallet completes it here and the page
 * sends it to devnet through /api/rpc. Unlinking needs the wallet alone. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import { address, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { unlinkXIx } from "../../sdk/program";
import { fetchXLink } from "../../sdk/read";
import { describeError, rpc, sendInstructions, sendSignedTransaction } from "@/lib/browser-rpc";
import { Faucet } from "./Faucet";
import { IDLE, TxStatusLine, type TxStatus } from "./TxStatus";
import { CHAIN, ChooseWallet, useBalances, useDevnetWallet, WalletStrip } from "./Wallet";

/** Rent for the link's two accounts plus a fee, with room: about 0.0035. */
const LINK_MIN_LAMPORTS = 5_000_000n;

type Profile = { handle: string; xId: string; avatar: string | null } | null;

export function InfluencerHub({
  profile,
  identity,
  xConfigured,
}: {
  profile: Profile;
  identity: string | null;
  xConfigured: boolean;
}) {
  const { wallets, connected } = useDevnetWallet();

  return (
    <section className="mt-10 grid gap-4 md:grid-cols-2">
      <Step n={1} title="Sign in with X" done={!!profile}>
        {profile ? (
          <p className="flex items-center gap-3">
            {profile.avatar && (
              // Supplied by X for this account; shown as it is.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar} alt="" className="size-8 rounded-full" />
            )}
            <span>
              Signed in as <span className="font-mono">@{profile.handle}</span>
            </span>
          </p>
        ) : xConfigured ? (
          <a
            href="/api/x/start"
            className="inline-block rounded-full bg-ink px-5 py-2.5 font-medium text-paper hover:opacity-90"
          >
            Sign in with X
          </a>
        ) : (
          <p className="text-muted">X sign-in is not set up on this deployment.</p>
        )}
        <p className="mt-3 text-sm leading-6 text-muted">
          We read your public profile once, and nothing else. The sign-in lasts fifteen minutes.
        </p>
      </Step>

      <Step n={2} title="Connect the wallet you want paid" done={!!connected}>
        {connected ? (
          <Linked wallet={connected.wallet} account={connected.account} profile={profile} identity={identity} />
        ) : (
          <>
            <ChooseWallet wallets={wallets} />
            <p className="mt-3 text-sm leading-6 text-muted">
              A real wallet, not a guest one: this is where your earnings go.
            </p>
          </>
        )}
      </Step>
    </section>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-7">
      <div className="flex items-center gap-3">
        <span
          className={`flex size-7 items-center justify-center rounded-full font-mono text-xs ${done ? "bg-paid text-paper" : "border border-line text-muted"}`}
        >
          {done ? "✓" : n}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

type LinkState =
  { kind: "loading" } | { kind: "none" } | { kind: "linked"; handle: string; xId: string; current: boolean };

function Linked({
  wallet,
  account,
  profile,
  identity,
}: {
  wallet: UiWallet;
  account: UiWalletAccount;
  profile: Profile;
  identity: string | null;
}) {
  const signer = useWalletAccountTransactionSigner(account, CHAIN);
  const { lamports, refresh: refreshBalance } = useBalances(account.address);
  const [link, setLink] = useState<LinkState>({ kind: "loading" });
  const [status, setStatus] = useState<TxStatus>(IDLE);
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);

  // What the chain and the site say about this wallet, read when it
  // changes and again after every link or unlink.
  const refresh = useCallback(() => {
    const linked = identity
      ? fetchXLink(rpc(), address(identity), address(account.address)).catch(() => null)
      : Promise.resolve(null);
    void linked.then((l) =>
      setLink(l ? { kind: "linked", handle: l.handle, xId: String(l.xId), current: l.current } : { kind: "none" }),
    );
    void fetch(`/api/influencers/channels?wallet=${account.address}`)
      .then((r) => r.json())
      .then((b: { channels: ChannelRow[] }) => setChannels(b.channels))
      .catch(() => setChannels([]));
  }, [account.address, identity]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function linkNow() {
    const client = rpc();
    try {
      setStatus({ kind: "working", what: "Asking Earnout to vouch..." });
      const res = await fetch("/api/x/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: account.address }),
      });
      const body = (await res.json()) as { transaction?: string; error?: string };
      if (!res.ok || !body.transaction) throw new Error(body.error ?? "Could not build the link");

      setStatus({ kind: "working", what: "Approve in your wallet..." });
      const half = getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction));
      const [signed] = await signer.modifyAndSignTransactions([half]);
      // A wallet that rewrote the message (a priority fee, say) has voided
      // Earnout's signature on it; say so instead of a bare RPC error.
      if (!sameBytes(signed.messageBytes, half.messageBytes)) {
        throw new Error(
          "Your wallet changed the transaction, so Earnout's signature on it no longer holds. Try a wallet that signs as is.",
        );
      }

      setStatus({ kind: "working", what: "Writing it on devnet..." });
      await sendSignedTransaction(client, signed);
      setStatus(IDLE);
      refresh();
      void refreshBalance();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  async function unlinkNow() {
    if (!identity) return;
    try {
      setStatus({ kind: "working", what: "Approve in your wallet..." });
      const ix = await unlinkXIx({ wallet: signer, voucher: address(identity) });
      await sendInstructions(rpc(), signer, [ix], () =>
        setStatus({ kind: "working", what: "Removing it on devnet..." }),
      );
      setStatus(IDLE);
      refresh();
      void refreshBalance();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  const working = status.kind === "working";
  const alreadyThis = link.kind === "linked" && profile && link.xId === profile.xId && link.current;
  const tooLow = lamports !== null && lamports < LINK_MIN_LAMPORTS;

  return (
    <div>
      <WalletStrip wallet={wallet} account={account} lamports={lamports} surface="paper" />

      {tooLow && !alreadyThis && (
        <Faucet
          wallet={account.address}
          onFunded={refreshBalance}
          need="Linking writes two small accounts on devnet: about 0.0035 devnet SOL in rent and fee, and this wallet has less."
        />
      )}

      <div className="mt-5 leading-7">
        {link.kind === "loading" && <p className="text-muted">Checking this wallet on devnet...</p>}
        {link.kind === "none" && <p>This wallet has no X account linked yet.</p>}
        {link.kind === "linked" && (
          <p>
            <span className="text-paid" aria-hidden="true">
              ✓{" "}
            </span>
            Linked to <span className="font-mono">@{link.handle}</span>
            {!link.current && <span className="text-unpaid"> (that account has since moved to another wallet)</span>}
            {link.current && (
              <>
                {" "}
                <Link
                  href={`/influencers/${link.handle}`}
                  className="text-sm underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  Your public record
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      {profile && !alreadyThis && (
        <button
          onClick={() => void linkNow()}
          disabled={working || tooLow}
          className="mt-4 rounded-full bg-ink px-5 py-2.5 font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {working
            ? status.what
            : link.kind === "linked"
              ? `Link @${profile.handle} instead`
              : `Link @${profile.handle} to this wallet`}
        </button>
      )}
      {!profile && link.kind === "none" && (
        <p className="mt-2 text-sm text-muted">Sign in with X first, then link it here.</p>
      )}
      {link.kind === "linked" && (
        <button
          onClick={() => void unlinkNow()}
          disabled={working}
          className="mt-4 ml-4 text-sm text-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50"
        >
          {working && !profile ? status.what : "Unlink"}
        </button>
      )}
      <TxStatusLine status={status} />

      <Channels rows={channels} linked={link.kind === "linked"} />
    </div>
  );
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type ChannelRow = {
  slug: string | null;
  campaign: string;
  campaignName: string;
  handle: string | null;
  earned: string;
  claimed: string;
  claimable: string;
};

function Channels({ rows, linked }: { rows: ChannelRow[] | null; linked: boolean }) {
  if (rows === null) return null;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="font-semibold tracking-tight">Your links</h3>
      {rows.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((r) => (
            <li key={`${r.campaign}-${r.slug}`} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {r.slug ? (
                  <Link
                    href={`/c/${r.slug}`}
                    className="font-mono underline decoration-line underline-offset-2 hover:decoration-ink"
                  >
                    /r/{r.slug}
                  </Link>
                ) : (
                  <span className="font-mono">link</span>
                )}{" "}
                <span className="text-muted">in {r.campaignName}</span>
              </span>
              <span className="font-mono text-muted">
                earned {r.earned}, claimable {r.claimable}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted">
          {linked
            ? "None yet. Once a project adds you to a campaign, your link and your receipts appear here."
            : "Link your X account, then ask a project to add you to a campaign."}
        </p>
      )}
    </div>
  );
}
