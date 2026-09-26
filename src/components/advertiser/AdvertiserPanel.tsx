"use client";

/* The advertiser's controls on their campaign page: fund it, add a creator
 * by X handle, and take the refund once the deadline has passed. Anyone can
 * see the page; only the advertiser's wallet can sign any of this, and the
 * program checks the same thing, so nobody signs a transaction that is
 * bound to fail.
 *
 * Adding a creator is one transaction: the channel, plus a memo naming its
 * link slug, which the site records once the transaction has landed
 * (api/campaigns/links). A channel that got its account but not its link
 * can be named later with a memo alone. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDisconnect, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import { address, getBase64Encoder } from "@solana/kit";
import { memoIx } from "../../../sdk/identity";
import { addChannelIx, ataAddress, decodeCampaign, fundIx, refundIx } from "../../../sdk/program";
import { describeError, rpc, sendInstructions, shortAddress, sleep, sol, tokenBalance } from "@/lib/browser-rpc";
import { registerGuestWallet } from "@/lib/guest-wallet";
import { money, toBaseUnits } from "@/lib/money";
import { linkMemo, SLUG, slugFor } from "@/lib/rules";
import { TEST_USD } from "@/lib/test-usd";
import { CopyLink } from "../CopyLink";
import { Faucet } from "../Faucet";
import { CHAIN, ChooseWallet, useDevnetWallet } from "../Wallet";

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
  /** Base units, as strings: bigints do not cross into client components. */
  funded: string;
  committed: string;
  refunded: string;
  channels: PanelChannel[];
};

/* Rent for a channel's two accounts plus a fee, with room. */
const ADD_MIN_LAMPORTS = 5_000_000n;

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
              Connect the advertiser wallet ({shortAddress(p.advertiser)}) to fund it, add creators, or take the refund.
            </span>
          </p>
          {!open && (
            <button onClick={() => setOpen(true)} className="rounded-full border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper">
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
        The connected wallet ({shortAddress(connected.account.address)}) is not this campaign&apos;s advertiser ({shortAddress(p.advertiser)}).
        <Disconnect wallet={connected.wallet} />
      </section>
    );
  }
  return <Controls {...p} wallet={connected.wallet} account={connected.account} />;
}

function Disconnect({ wallet }: { wallet: UiWallet }) {
  const [, disconnect] = useDisconnect(wallet);
  return (
    <button onClick={() => void disconnect()} className="ml-3 underline decoration-line underline-offset-2 hover:text-ink">
      disconnect
    </button>
  );
}

type Busy = { kind: "idle" } | { kind: "working"; what: string } | { kind: "done"; text: string; tx: string } | { kind: "error"; message: string };

function Controls(p: PanelProps & { wallet: UiWallet; account: UiWalletAccount }) {
  const signer = useWalletAccountTransactionSigner(p.account, CHAIN);
  const router = useRouter();
  const owner = address(p.account.address);
  const mint = address(p.mint);
  const campaign = address(p.campaign);
  const [lamports, setLamports] = useState<bigint | null>(null);
  const [tokens, setTokens] = useState<bigint | null>(null);

  const refresh = async () => {
    const client = rpc();
    const [l, t] = await Promise.all([
      client
        .getBalance(owner, { commitment: "confirmed" })
        .send()
        .then((r) => r.value)
        .catch(() => null),
      tokenBalance(client, owner, mint),
    ]);
    setLamports(l);
    setTokens(t);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.account.address]);

  const now = Math.floor(Date.now() / 1000);
  const refundable = BigInt(p.funded) - BigInt(p.committed) - BigInt(p.refunded);
  const refundOpen = now > p.settleDeadline;

  return (
    <section className="mt-8 rounded-2xl border border-ink p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Manage this campaign</h2>
        <p className="font-mono text-sm text-muted">
          {p.wallet.name} {shortAddress(p.account.address)}
          {lamports !== null && ` · ${sol(lamports)} SOL`}
          {tokens !== null && ` · ${money(tokens, p.decimals)} ${TEST_USD.symbol}`}
          <Disconnect wallet={p.wallet} />
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Fund {...p} signer={signer} tokens={tokens} refresh={refresh} onChanged={() => router.refresh()} />
        <AddCreator {...p} signer={signer} lamports={lamports} refresh={refresh} onChanged={() => router.refresh()} />
        <div className="rounded-xl bg-card p-5">
          <h3 className="font-semibold tracking-tight">Refund</h3>
          {refundOpen ? (
            <Refund {...p} signer={signer} refundable={refundable} onChanged={() => router.refresh()} />
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted">
              {money(refundable, p.decimals)} is still unspent. Whatever is still unspent when payouts close on{" "}
              {new Date(p.settleDeadline * 1000).toUTCString().slice(5, 16)} comes back to this wallet with one click here.
            </p>
          )}
        </div>
      </div>

      <Links {...p} signer={signer} onChanged={() => router.refresh()} />
    </section>
  );
}

// ── fund ─────────────────────────────────────────────────────────────────────

type Signer = ReturnType<typeof useWalletAccountTransactionSigner>;

function Fund(p: PanelProps & { signer: Signer; tokens: bigint | null; refresh: () => Promise<void>; onChanged: () => void }) {
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const units = toBaseUnits(amount, p.decimals);
  const short = units !== null && p.tokens !== null && p.tokens < units;

  async function fund() {
    if (units === null) return;
    const client = rpc();
    const mint = address(p.mint);
    try {
      setBusy({ kind: "working", what: "Approve in your wallet..." });
      const ix = await fundIx({ funder: p.signer, campaign: address(p.campaign), mint, source: await ataAddress(address(p.signer.address), mint), amount: units });
      const tx = await sendInstructions(client, p.signer, [ix], () => setBusy({ kind: "working", what: "Confirming on devnet..." }));
      setBusy({ kind: "done", text: `Added ${money(units, p.decimals)} to the budget.`, tx });
      await p.refresh();
      p.onChanged();
    } catch (e) {
      setBusy({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="rounded-xl bg-card p-5">
      <h3 className="font-semibold tracking-tight">Add to the budget</h3>
      <p className="mt-2 text-sm leading-6 text-muted">Top-ups are open until payouts close. Money leaves two ways: to a creator who earned it, or back to you.</p>
      <div className="mt-3 flex gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 font-mono text-[15px] outline-none focus:border-ink" />
        <button
          onClick={() => void fund()}
          disabled={busy.kind === "working" || units === null || short}
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {busy.kind === "working" ? busy.what : "Fund"}
        </button>
      </div>
      {short && address(p.mint) === TEST_USD.mint && (
        <Faucet kind="usd" wallet={p.signer.address} onFunded={p.refresh} need={`This wallet holds ${money(p.tokens ?? 0n, p.decimals)} ${TEST_USD.symbol}.`} />
      )}
      {short && address(p.mint) !== TEST_USD.mint && <p className="mt-2 text-sm text-unpaid">This wallet holds {money(p.tokens ?? 0n, p.decimals)} of the payout token.</p>}
      <Status busy={busy} />
    </div>
  );
}

// ── add a creator ────────────────────────────────────────────────────────────

type Found = { found: true; handle: string; xId: string; wallet: string } | { found: false; handle: string };

function AddCreator(p: PanelProps & { signer: Signer; lamports: bigint | null; refresh: () => Promise<void>; onChanged: () => void }) {
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [looking, setLooking] = useState(false);
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const tooLittleSol = p.lamports !== null && p.lamports < ADD_MIN_LAMPORTS;

  async function look() {
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    setLooking(true);
    setFound(null);
    setBusy({ kind: "idle" });
    try {
      const res = await fetch(`/api/creators/lookup?handle=${encodeURIComponent(h)}`);
      const body = (await res.json()) as Found & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not look that up");
      setFound(body);
      if (body.found) setSlug(slugFor(p.name, body.handle));
    } catch (e) {
      setBusy({ kind: "error", message: describeError(e) });
    } finally {
      setLooking(false);
    }
  }

  async function add() {
    if (!found?.found || !SLUG.test(slug)) return;
    const client = rpc();
    const campaign = address(p.campaign);
    try {
      setBusy({ kind: "working", what: "Reading the campaign..." });
      const { value } = await client.getAccountInfo(campaign, { encoding: "base64", commitment: "confirmed" }).send();
      if (!value) throw new Error("Could not read the campaign from devnet");
      const index = decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array).channels;

      setBusy({ kind: "working", what: "Approve in your wallet..." });
      const ixs = [
        await addChannelIx({ advertiser: p.signer, campaign, identity: address(p.identity), index, payee: address(found.wallet), xId: BigInt(found.xId) }),
        memoIx(linkMemo(p.campaign, index, slug)),
      ];
      const tx = await sendInstructions(client, p.signer, ixs, () => setBusy({ kind: "working", what: "Confirming on devnet..." }));
      setBusy({ kind: "working", what: "Naming the link..." });
      await registerLink(tx);
      setBusy({ kind: "done", text: `Added @${found.handle}. Their link is earnout.dev/r/${slug}.`, tx });
      setFound(null);
      setHandle("");
      await p.refresh();
      // Another server instance may hold the registry for two seconds more.
      await sleep(2_500);
      p.onChanged();
    } catch (e) {
      setBusy({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="rounded-xl bg-card p-5">
      <h3 className="font-semibold tracking-tight">Add a creator</h3>
      {p.source === "file" ? (
        <p className="mt-2 text-sm leading-6 text-muted">This pilot campaign is managed from the repository; its creators are added with scripts/add-channel.ts.</p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-muted">
            By X handle. They must have linked their X account to a wallet at{" "}
            <Link href="/creators" className="underline decoration-line underline-offset-2 hover:decoration-ink">
              earnout.dev/creators
            </Link>{" "}
            first; that wallet is where they are paid.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void look()}
              placeholder="@handle"
              className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 font-mono text-[15px] outline-none focus:border-ink"
            />
            <button onClick={() => void look()} disabled={looking || !handle.trim()} className="shrink-0 rounded-full border border-ink px-4 py-2.5 text-sm font-medium hover:bg-ink hover:text-paper disabled:opacity-50">
              {looking ? "Looking..." : "Find"}
            </button>
          </div>
          {found && !found.found && (
            <p className="mt-3 text-sm leading-6 text-unpaid">
              @{found.handle} has not linked an X account on Earnout yet. Send them to earnout.dev/creators; it takes a minute.
            </p>
          )}
          {found?.found && (
            <div className="mt-3 text-sm leading-6">
              <p>
                <span className="text-paid" aria-hidden="true">
                  ✓{" "}
                </span>
                <span className="font-mono">@{found.handle}</span>, verified, paid to <span className="font-mono">{shortAddress(found.wallet)}</span>
              </p>
              <label className="mt-2 block">
                <span className="text-xs text-muted">Their link</span>
                <div className="mt-1 flex items-center gap-1 font-mono">
                  <span className="text-muted">earnout.dev/r/</span>
                  <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[15px] outline-none focus:border-ink" />
                </div>
              </label>
              {!SLUG.test(slug) && <p className="mt-1 text-xs text-unpaid">Lowercase letters, digits and dashes, starting with a letter or digit.</p>}
              {tooLittleSol && <Faucet wallet={p.signer.address} onFunded={p.refresh} need="Adding a creator writes two small accounts on devnet: about 0.004 devnet SOL in rent and fees, and this wallet has less." />}
              <button
                onClick={() => void add()}
                disabled={busy.kind === "working" || !SLUG.test(slug) || tooLittleSol}
                className="mt-3 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy.kind === "working" ? busy.what : `Add @${found.handle}`}
              </button>
            </div>
          )}
          <Status busy={busy} />
        </>
      )}
    </div>
  );
}

/** Ask the site to record the slug. The RPC can take a moment to index a
 * new transaction, so a "not on chain yet" is retried. */
async function registerLink(signature: string): Promise<void> {
  for (let i = 0; ; i++) {
    const res = await fetch("/api/campaigns/links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) });
    if (res.ok) return;
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status !== 404 || i >= 8) throw new Error(error ?? "The creator was added but their link could not be named. Name it below.");
    await sleep(1_500);
  }
}

// ── refund ───────────────────────────────────────────────────────────────────

function Refund(p: PanelProps & { signer: Signer; refundable: bigint; onChanged: () => void }) {
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });

  async function refund() {
    try {
      setBusy({ kind: "working", what: "Approve in your wallet..." });
      const ix = await refundIx({ advertiser: p.signer, campaign: address(p.campaign), mint: address(p.mint) });
      const tx = await sendInstructions(rpc(), p.signer, [ix], () => setBusy({ kind: "working", what: "Confirming on devnet..." }));
      setBusy({ kind: "done", text: `Refunded ${money(p.refundable, p.decimals)}.`, tx });
      p.onChanged();
    } catch (e) {
      setBusy({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <>
      <p className="mt-2 text-sm leading-6 text-muted">Payouts have closed. What no creator earned is yours to take back.</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{money(p.refundable, p.decimals)}</p>
      <button
        onClick={() => void refund()}
        disabled={busy.kind === "working" || p.refundable <= 0n || busy.kind === "done"}
        className="mt-3 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
      >
        {busy.kind === "working" ? busy.what : p.refundable > 0n ? "Refund it" : "Nothing to refund"}
      </button>
      <Status busy={busy} />
    </>
  );
}

// ── links ────────────────────────────────────────────────────────────────────

function Links(p: PanelProps & { signer: Signer; onChanged: () => void }) {
  const [naming, setNaming] = useState<{ index: number; slug: string } | null>(null);
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });

  async function name() {
    if (!naming || !SLUG.test(naming.slug)) return;
    try {
      setBusy({ kind: "working", what: "Approve in your wallet..." });
      const tx = await sendInstructions(rpc(), p.signer, [memoIx(linkMemo(p.campaign, naming.index, naming.slug))], () => setBusy({ kind: "working", what: "Confirming on devnet..." }));
      setBusy({ kind: "working", what: "Naming the link..." });
      await registerLink(tx);
      setBusy({ kind: "done", text: `Creator ${naming.index} is now earnout.dev/r/${naming.slug}.`, tx });
      setNaming(null);
      await sleep(2_500);
      p.onChanged();
    } catch (e) {
      setBusy({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="font-semibold tracking-tight">Links to hand out</h3>
      {p.channels.length === 0 ? (
        <p className="mt-2 text-sm leading-6 text-muted">No creators yet. Add one above and their link appears here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {p.channels.map((c) => (
            <li key={c.index} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="font-mono">
                {c.slug ? (
                  <>
                    earnout.dev/r/{c.slug} <span className="text-muted">{c.handle ? `@${c.handle}` : `channel ${c.index}`}</span>
                  </>
                ) : (
                  <>
                    creator {c.index} <span className="text-muted">{c.handle ? `@${c.handle}, ` : ""}no link yet</span>
                  </>
                )}
              </span>
              {c.slug ? (
                <CopyLink url={`https://earnout.dev/r/${c.slug}`} />
              ) : p.source === "db" && naming?.index !== c.index ? (
                <button onClick={() => setNaming({ index: c.index, slug: slugFor(p.name, c.handle ?? `channel-${c.index}`) })} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink">
                  Give it a link
                </button>
              ) : null}
              {naming?.index === c.index && (
                <div className="flex w-full items-center gap-2 font-mono">
                  <span className="text-muted">earnout.dev/r/</span>
                  <input value={naming.slug} onChange={(e) => setNaming({ index: c.index, slug: e.target.value.toLowerCase() })} className="w-full max-w-xs rounded-xl border border-line bg-paper px-3 py-2 outline-none focus:border-ink" />
                  <button onClick={() => void name()} disabled={busy.kind === "working" || !SLUG.test(naming.slug)} className="shrink-0 rounded-full bg-ink px-4 py-2 font-sans text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                    {busy.kind === "working" ? busy.what : "Name it"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Status busy={busy} />
    </div>
  );
}

function Status({ busy }: { busy: Busy }) {
  if (busy.kind === "done") {
    return (
      <p className="mt-3 text-sm leading-6">
        <span className="text-paid" aria-hidden="true">
          ✓{" "}
        </span>
        {busy.text}{" "}
        <a href={`https://explorer.solana.com/tx/${busy.tx}?cluster=devnet`} className="underline decoration-line underline-offset-2 hover:decoration-ink">
          Transaction
        </a>
      </p>
    );
  }
  if (busy.kind === "error") return <p className="mt-3 text-sm leading-6 text-unpaid">{busy.message}</p>;
  return null;
}
