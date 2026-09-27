"use client";

/* The advertiser's controls on their campaign page: fund it, add an influencer
 * by X handle, and take the refund once the deadline has passed. Anyone can
 * see the page; only the advertiser's wallet can sign any of this, and the
 * program checks the same thing, so nobody signs a transaction that is
 * bound to fail.
 *
 * Adding an influencer is one transaction: the channel, plus a memo naming its
 * link slug, which the site records once the transaction has landed
 * (api/campaigns/links). A channel that got its account but not its link
 * can be named later with a memo alone. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import { address, getBase64Encoder } from "@solana/kit";
import { memoIx } from "../../../sdk/identity";
import { addChannelIx, ataAddress, decodeCampaign, fundIx, refundIx } from "../../../sdk/program";
import { describeError, postUntilIndexed, rpc, sendInstructions, sleep } from "@/lib/browser-rpc";
import { shortAddress } from "@/lib/explorer";
import { registerGuestWallet } from "@/lib/guest-wallet";
import { money, toBaseUnits } from "@/lib/money";
import { linkMemo, SLUG, slugFor } from "@/lib/rules";
import { linkText, linkUrl, SITE } from "@/lib/site";
import { TEST_USD } from "@/lib/test-usd";
import { CopyLink } from "../CopyLink";
import { Faucet } from "../Faucet";
import { IDLE, TxStatusLine, type TxStatus } from "../TxStatus";
import { CHAIN, ChooseWallet, DisconnectButton, useBalances, useDevnetWallet, WalletStrip } from "../Wallet";

export type PanelChannel = { index: number; slug: string | null; handle: string | null; payee: string };

export type PanelProps = {
  campaign: string;
  advertiser: string;
  identity: string;
  mint: string;
  decimals: number;
  name: string;
  /** "file" campaigns are managed from the repo; their links are not named here. */
  source: "file" | "db";
  endsAt: number;
  settleDeadline: number;
  /** Whether the settle deadline has passed, decided by the server when the
   * page was rendered (the page is never cached). */
  refundOpen: boolean;
  /** Base units, as strings: bigints do not cross into client components. */
  funded: string;
  committed: string;
  refunded: string;
  channels: PanelChannel[];
};

/* Rent for a channel's two accounts plus a fee, with room. */
const ADD_MIN_LAMPORTS = 5_000_000n;

const INPUT =
  "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 font-mono text-[15px] outline-none focus:border-ink";

export function AdvertiserPanel(p: PanelProps) {
  const { wallets, connected } = useDevnetWallet({ allowGuest: true });
  const [open, setOpen] = useState(false);

  // A campaign made with the guest wallet is managed with it too.
  useEffect(() => {
    registerGuestWallet();
  }, []);

  if (!connected) {
    return (
      <section className="mt-8 rounded-2xl border border-dashed border-line p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="leading-7">
            <span className="font-semibold">Your campaign?</span>{" "}
            <span className="text-muted">
              Connect the advertiser wallet ({shortAddress(p.advertiser)}) to fund it, add influencers, or take the
              refund.
            </span>
          </p>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="rounded-full border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper"
            >
              Connect
            </button>
          )}
        </div>
        {open && <ChooseWallet wallets={wallets} />}
      </section>
    );
  }
  if (connected.account.address !== p.advertiser) {
    return (
      <section className="mt-8 rounded-2xl border border-dashed border-line p-6 text-sm leading-6 text-muted">
        The connected wallet ({shortAddress(connected.account.address)}) is not this campaign&apos;s advertiser (
        {shortAddress(p.advertiser)}).
        <DisconnectButton wallet={connected.wallet} />
      </section>
    );
  }
  return <Controls {...p} wallet={connected.wallet} account={connected.account} />;
}

function Controls(p: PanelProps & { wallet: UiWallet; account: UiWalletAccount }) {
  const signer = useWalletAccountTransactionSigner(p.account, CHAIN);
  const router = useRouter();
  const { lamports, tokens, refresh } = useBalances(p.account.address, p.mint);
  const refundable = BigInt(p.funded) - BigInt(p.committed) - BigInt(p.refunded);
  const changed = () => router.refresh();

  return (
    <section className="mt-8 rounded-2xl border border-ink p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Manage this campaign</h2>
      </div>
      <div className="mt-4">
        <WalletStrip wallet={p.wallet} account={p.account} lamports={lamports} tokens={tokens} token={TEST_USD} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Fund {...p} signer={signer} tokens={tokens} refresh={refresh} onChanged={changed} />
        <AddInfluencer {...p} signer={signer} lamports={lamports} refresh={refresh} onChanged={changed} />
        <div className="rounded-xl bg-card p-5">
          <h3 className="font-semibold tracking-tight">Refund</h3>
          {p.refundOpen ? (
            <Refund {...p} signer={signer} refundable={refundable} onChanged={changed} />
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted">
              {money(refundable, p.decimals)} is still unspent. Whatever is still unspent when payouts close on{" "}
              {new Date(p.settleDeadline * 1000).toUTCString().slice(5, 16)} comes back to this wallet with one click
              here.
            </p>
          )}
        </div>
      </div>

      <Links {...p} signer={signer} onChanged={changed} />
    </section>
  );
}

// ── fund ─────────────────────────────────────────────────────────────────────

type Signer = ReturnType<typeof useWalletAccountTransactionSigner>;

function Fund(
  p: PanelProps & { signer: Signer; tokens: bigint | null; refresh: () => Promise<void>; onChanged: () => void },
) {
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState<TxStatus>(IDLE);
  const units = toBaseUnits(amount, p.decimals);
  const short = units !== null && p.tokens !== null && p.tokens < units;

  async function fund() {
    if (units === null) return;
    const client = rpc();
    const mint = address(p.mint);
    try {
      setStatus({ kind: "working", what: "Approve in your wallet..." });
      const ix = await fundIx({
        funder: p.signer,
        campaign: address(p.campaign),
        mint,
        source: await ataAddress(address(p.signer.address), mint),
        amount: units,
      });
      const tx = await sendInstructions(client, p.signer, [ix], () =>
        setStatus({ kind: "working", what: "Confirming on devnet..." }),
      );
      setStatus({ kind: "done", text: `Added ${money(units, p.decimals)} to the budget.`, tx });
      await p.refresh();
      p.onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="rounded-xl bg-card p-5">
      <h3 className="font-semibold tracking-tight">Add to the budget</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        Top-ups are open until payouts close. Money leaves two ways: to an influencer who earned it, or back to you.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label="Amount to add"
          className={INPUT}
        />
        <button
          onClick={() => void fund()}
          disabled={status.kind === "working" || units === null || short}
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {status.kind === "working" ? status.what : "Fund"}
        </button>
      </div>
      {short && address(p.mint) === TEST_USD.mint && (
        <Faucet
          kind="usd"
          wallet={p.signer.address}
          onFunded={p.refresh}
          need={`This wallet holds ${money(p.tokens ?? 0n, p.decimals)} ${TEST_USD.symbol}.`}
        />
      )}
      {short && address(p.mint) !== TEST_USD.mint && (
        <p className="mt-2 text-sm text-unpaid">
          This wallet holds {money(p.tokens ?? 0n, p.decimals)} of the payout token.
        </p>
      )}
      <TxStatusLine status={status} />
    </div>
  );
}

// ── add an influencer ────────────────────────────────────────────────────────

type Found = { found: true; handle: string; xId: string; wallet: string } | { found: false; handle: string };

const UNNAMED = "The influencer was added but their link could not be named. Name it below.";

function AddInfluencer(
  p: PanelProps & { signer: Signer; lamports: bigint | null; refresh: () => Promise<void>; onChanged: () => void },
) {
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [looking, setLooking] = useState(false);
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<TxStatus>(IDLE);
  const tooLittleSol = p.lamports !== null && p.lamports < ADD_MIN_LAMPORTS;

  async function look() {
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    setLooking(true);
    setFound(null);
    setStatus(IDLE);
    try {
      const res = await fetch(`/api/influencers/lookup?handle=${encodeURIComponent(h)}`);
      const body = (await res.json()) as Found & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not look that up");
      setFound(body);
      if (body.found) setSlug(slugFor(p.name, body.handle));
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    } finally {
      setLooking(false);
    }
  }

  async function add() {
    if (!found?.found || !SLUG.test(slug)) return;
    const client = rpc();
    const campaign = address(p.campaign);
    try {
      setStatus({ kind: "working", what: "Reading the campaign..." });
      const { value } = await client.getAccountInfo(campaign, { encoding: "base64", commitment: "confirmed" }).send();
      if (!value) throw new Error("Could not read the campaign from devnet");
      const index = decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array).channels;

      setStatus({ kind: "working", what: "Approve in your wallet..." });
      const ixs = [
        await addChannelIx({
          advertiser: p.signer,
          campaign,
          identity: address(p.identity),
          index,
          payee: address(found.wallet),
          xId: BigInt(found.xId),
        }),
        memoIx(linkMemo(p.campaign, index, slug)),
      ];
      const tx = await sendInstructions(client, p.signer, ixs, () =>
        setStatus({ kind: "working", what: "Confirming on devnet..." }),
      );
      setStatus({ kind: "working", what: "Naming the link..." });
      await postUntilIndexed("/api/campaigns/links", { signature: tx }, UNNAMED);
      setStatus({ kind: "done", text: `Added @${found.handle}. Their link is ${linkText(slug)}.`, tx });
      setFound(null);
      setHandle("");
      await p.refresh();
      // Another server instance may hold the registry for two seconds more.
      await sleep(2_500);
      p.onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="rounded-xl bg-card p-5">
      <h3 className="font-semibold tracking-tight">Add an influencer</h3>
      {p.source === "file" ? (
        <p className="mt-2 text-sm leading-6 text-muted">
          This pilot campaign is managed from the repository; its influencers are added with scripts/add-channel.ts.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-muted">
            By X handle. They must have linked their X account to a wallet at{" "}
            <Link href="/influencers" className="underline decoration-line underline-offset-2 hover:decoration-ink">
              {SITE.host}/influencers
            </Link>{" "}
            first; that wallet is where they are paid.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void look()}
              placeholder="@handle"
              aria-label="X handle"
              className={INPUT}
            />
            <button
              onClick={() => void look()}
              disabled={looking || !handle.trim()}
              className="shrink-0 rounded-full border border-ink px-4 py-2.5 text-sm font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
            >
              {looking ? "Looking..." : "Find"}
            </button>
          </div>
          {found && !found.found && (
            <p className="mt-3 text-sm leading-6 text-unpaid">
              @{found.handle} has not linked an X account on Earnout yet. Send them to {SITE.host}/influencers; it takes
              a minute.
            </p>
          )}
          {found?.found && (
            <div className="mt-3 text-sm leading-6">
              <p>
                <span className="text-paid" aria-hidden="true">
                  ✓{" "}
                </span>
                <span className="font-mono">@{found.handle}</span>, verified, paid to{" "}
                <span className="font-mono">{shortAddress(found.wallet)}</span>
              </p>
              <label className="mt-2 block">
                <span className="text-xs text-muted">Their link</span>
                <div className="mt-1 flex items-center gap-1 font-mono">
                  <span className="text-muted">{SITE.host}/r/</span>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    className={`${INPUT} px-3 py-2`}
                  />
                </div>
              </label>
              {!SLUG.test(slug) && (
                <p className="mt-1 text-xs text-unpaid">
                  Lowercase letters, digits and dashes, starting with a letter or digit.
                </p>
              )}
              {tooLittleSol && (
                <Faucet
                  wallet={p.signer.address}
                  onFunded={p.refresh}
                  need="Adding an influencer writes two small accounts on devnet: about 0.004 devnet SOL in rent and fees, and this wallet has less."
                />
              )}
              <button
                onClick={() => void add()}
                disabled={status.kind === "working" || !SLUG.test(slug) || tooLittleSol}
                className="mt-3 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {status.kind === "working" ? status.what : `Add @${found.handle}`}
              </button>
            </div>
          )}
          <TxStatusLine status={status} />
        </>
      )}
    </div>
  );
}

// ── refund ───────────────────────────────────────────────────────────────────

function Refund(p: PanelProps & { signer: Signer; refundable: bigint; onChanged: () => void }) {
  const [status, setStatus] = useState<TxStatus>(IDLE);

  async function refund() {
    try {
      setStatus({ kind: "working", what: "Approve in your wallet..." });
      const ix = await refundIx({ advertiser: p.signer, campaign: address(p.campaign), mint: address(p.mint) });
      const tx = await sendInstructions(rpc(), p.signer, [ix], () =>
        setStatus({ kind: "working", what: "Confirming on devnet..." }),
      );
      setStatus({ kind: "done", text: `Refunded ${money(p.refundable, p.decimals)}.`, tx });
      p.onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <>
      <p className="mt-2 text-sm leading-6 text-muted">
        Payouts have closed. What no influencer earned is yours to take back.
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{money(p.refundable, p.decimals)}</p>
      <button
        onClick={() => void refund()}
        disabled={status.kind === "working" || p.refundable <= 0n || status.kind === "done"}
        className="mt-3 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
      >
        {status.kind === "working" ? status.what : p.refundable > 0n ? "Refund it" : "Nothing to refund"}
      </button>
      <TxStatusLine status={status} />
    </>
  );
}

// ── links ────────────────────────────────────────────────────────────────────

function Links(p: PanelProps & { signer: Signer; onChanged: () => void }) {
  const [naming, setNaming] = useState<{ index: number; slug: string } | null>(null);
  const [status, setStatus] = useState<TxStatus>(IDLE);

  async function name() {
    if (!naming || !SLUG.test(naming.slug)) return;
    try {
      setStatus({ kind: "working", what: "Approve in your wallet..." });
      const tx = await sendInstructions(
        rpc(),
        p.signer,
        [memoIx(linkMemo(p.campaign, naming.index, naming.slug))],
        () => setStatus({ kind: "working", what: "Confirming on devnet..." }),
      );
      setStatus({ kind: "working", what: "Naming the link..." });
      await postUntilIndexed("/api/campaigns/links", { signature: tx }, UNNAMED);
      setStatus({ kind: "done", text: `Influencer ${naming.index} is now ${linkText(naming.slug)}.`, tx });
      setNaming(null);
      await sleep(2_500);
      p.onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="font-semibold tracking-tight">Links to hand out</h3>
      {p.channels.length === 0 ? (
        <p className="mt-2 text-sm leading-6 text-muted">
          No influencers yet. Add one above and their link appears here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {p.channels.map((c) => (
            <li key={c.index} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="font-mono">
                {c.slug ? (
                  <>
                    {linkText(c.slug)}{" "}
                    <span className="text-muted">{c.handle ? `@${c.handle}` : `Influencer ${c.index}`}</span>
                  </>
                ) : (
                  <>
                    Influencer {c.index}{" "}
                    <span className="text-muted">{c.handle ? `@${c.handle}, ` : ""}no link yet</span>
                  </>
                )}
              </span>
              {c.slug ? (
                <CopyLink url={linkUrl(c.slug)} />
              ) : p.source === "db" && naming?.index !== c.index ? (
                <button
                  onClick={() =>
                    setNaming({ index: c.index, slug: slugFor(p.name, c.handle ?? `influencer-${c.index}`) })
                  }
                  className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink"
                >
                  Give it a link
                </button>
              ) : null}
              {naming?.index === c.index && (
                <div className="flex w-full items-center gap-2 font-mono">
                  <span className="text-muted">{SITE.host}/r/</span>
                  <input
                    value={naming.slug}
                    onChange={(e) => setNaming({ index: c.index, slug: e.target.value.toLowerCase() })}
                    aria-label="Link slug"
                    className={`${INPUT} max-w-xs px-3 py-2`}
                  />
                  <button
                    onClick={() => void name()}
                    disabled={status.kind === "working" || !SLUG.test(naming.slug)}
                    className="shrink-0 rounded-full bg-ink px-4 py-2 font-sans text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
                  >
                    {status.kind === "working" ? status.what : "Name it"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <TxStatusLine status={status} />
    </div>
  );
}
