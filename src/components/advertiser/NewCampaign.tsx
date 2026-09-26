"use client";

/* Starting a campaign from the browser: set the rules, fund the vault, and
 * commit to both in one transaction the wallet signs.
 *
 * The rules (what counts as a conversion, what "stayed" means) live off
 * chain, so their hash goes on chain: the creating transaction carries it in
 * a memo, and the site records the rules only if they hash to what the memo
 * says (api/campaigns). Nothing here can be changed later, which is the
 * point: a creator who reads the disclosure page is reading the terms the
 * advertiser is bound to. */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useDisconnect, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import { address, isAddress, type Address } from "@solana/kit";
import { memoIx } from "../../../sdk/identity";
import { ataAddress, campaignAddress, createCampaignIx, fundIx } from "../../../sdk/program";
import { describeError, mintDecimals, rpc, sendInstructions, shortAddress, sleep, sol, tokenBalance } from "@/lib/browser-rpc";
import { DEMO } from "@/lib/demo";
import { registerGuestWallet } from "@/lib/guest-wallet";
import { duration, money, toBaseUnits } from "@/lib/money";
import { describeConversion, describeRetention, LIMITS, RulesError, rulesHash, rulesMemo, validateRules, type Rules } from "@/lib/rules";
import { TEST_USD } from "@/lib/test-usd";
import { Faucet } from "../Faucet";
import { CHAIN, ChooseWallet, useDevnetWallet } from "../Wallet";

type Props = {
  /** The Earnout identity every hub campaign names, or null when the deployment has none. */
  identity: string | null;
  settler: string;
  mint: string;
  decimals: number;
  /** Why creating is off on this deployment, or null when it is on. */
  reason: string | null;
};

/* Rent for the campaign and its vault, plus fees, with room. */
const CREATE_MIN_LAMPORTS = 8_000_000n;

const RETENTION_OPTIONS: [number, string][] = [
  [600, "10 minutes (for a demo)"],
  [3_600, "1 hour"],
  [86_400, "1 day"],
  [3 * 86_400, "3 days"],
  [7 * 86_400, "7 days"],
  [14 * 86_400, "14 days"],
  [30 * 86_400, "30 days"],
  [90 * 86_400, "90 days"],
];

const WINDOW_OPTIONS: [number, string][] = [
  [86_400, "1 day"],
  [3 * 86_400, "3 days"],
  [7 * 86_400, "7 days"],
  [30 * 86_400, "30 days"],
];

type Form = {
  name: string;
  description: string;
  destination: string;
  convKind: "sol-transfer" | "program";
  convTo: string;
  convSol: string;
  convProgram: string;
  retKind: "sol-balance" | "token-balance" | "program-activity";
  retSol: string;
  retMint: string;
  retAmount: string;
  retProgram: string;
  retVisits: string;
  retentionSecs: number;
  lengthDays: string;
  attributionWindowSecs: number;
  price: string;
  budget: string;
  maxWallets: string;
  ignoreFunders: string;
};

const EMPTY: Form = {
  name: "",
  description: "",
  destination: "",
  convKind: "sol-transfer",
  convTo: "",
  convSol: "0.01",
  convProgram: "",
  retKind: "sol-balance",
  retSol: "0.005",
  retMint: "",
  retAmount: "",
  retProgram: "",
  retVisits: "1",
  retentionSecs: 600,
  lengthDays: "30",
  attributionWindowSecs: 7 * 86_400,
  price: "5",
  budget: "100",
  maxWallets: "3",
  ignoreFunders: "",
};

/* The demo partner's own rules, so a judge can run the whole loop in a
 * session: a 0.01 SOL deposit, keep 0.005, ten minutes. The faucet that
 * funds demo wallets is listed so the cluster check ignores it. */
const DEMO_PRESET: Partial<Form> = {
  name: "My demo campaign",
  description: "A pretend DeFi app on devnet. A conversion is a 0.01 SOL deposit into its treasury; a wallet stays if it still holds 0.005 SOL ten minutes later.",
  destination: "/demo",
  convKind: "sol-transfer",
  convTo: DEMO.treasury,
  convSol: "0.01",
  retKind: "sol-balance",
  retSol: "0.005",
  retentionSecs: 600,
  ignoreFunders: "EpYsqPa4wdJ4sUPcwAn9VNhyxvWCoJV8pCVTwNydzRSK",
};

const lamportsText = (solText: string): string => {
  const n = toBaseUnits(solText, 9);
  return n === null ? "" : n.toString();
};

/** The form as rules, with every amount in base units. Throws a RulesError
 * for anything the advertiser still has to fix. */
function toRules(f: Form, retDecimals: number | null): Rules {
  const conversion =
    f.convKind === "sol-transfer"
      ? { kind: "sol-transfer" as const, to: f.convTo, minLamports: lamportsText(f.convSol) }
      : { kind: "program" as const, programId: f.convProgram };
  let retention: Rules["retention"];
  if (f.retKind === "sol-balance") retention = { kind: "sol-balance", minLamports: lamportsText(f.retSol) };
  else if (f.retKind === "token-balance") {
    if (retDecimals === null) throw new RulesError("Enter the mint of the token a wallet must keep");
    retention = { kind: "token-balance", mint: f.retMint, minAmount: (toBaseUnits(f.retAmount, retDecimals) ?? "").toString() };
  } else retention = { kind: "program-activity", programId: f.retProgram, minTransactions: Number(f.retVisits) };
  return validateRules({
    name: f.name,
    description: f.description,
    destination: f.destination,
    conversion,
    retention,
    attributionWindowSecs: f.attributionWindowSecs,
    sybil: {
      maxWalletsPerFunder: Number(f.maxWallets),
      ignoreFunders: f.ignoreFunders.split(/[\s,]+/).filter(Boolean),
    },
  });
}

export function NewCampaign(p: Props) {
  const { wallets, connected } = useDevnetWallet({ allowGuest: true });
  const [form, setForm] = useState<Form>(EMPTY);
  const [retDecimals, setRetDecimals] = useState<number | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // The advertiser's money here is devnet test dollars, so the wallet that
  // lives in the page is offered, as on the demo: a judge installs nothing.
  useEffect(() => {
    registerGuestWallet();
  }, []);

  // The decimals of the token a wallet must keep, read when a mint is typed.
  useEffect(() => {
    if (form.retKind !== "token-balance" || !isAddress(form.retMint)) return setRetDecimals(null);
    let live = true;
    mintDecimals(rpc(), address(form.retMint)).then((d) => live && setRetDecimals(d));
    return () => {
      live = false;
    };
  }, [form.retKind, form.retMint]);

  const checked = useMemo<{ rules: Rules; problem: null } | { rules: null; problem: string }>(() => {
    try {
      return { rules: toRules(form, retDecimals), problem: null };
    } catch (e) {
      return { rules: null, problem: e instanceof RulesError ? e.message : "Something in the rules could not be read" };
    }
  }, [form, retDecimals]);

  const payout = toBaseUnits(form.price, p.decimals);
  const budget = form.budget.trim() === "" || form.budget.trim() === "0" ? 0n : toBaseUnits(form.budget, p.decimals);
  const lengthDays = Number(form.lengthDays);
  const moneyProblem =
    payout === null
      ? "Set a price per user who stays"
      : budget === null
        ? "The budget must be a plain amount, or empty to fund later"
        : !(Number.isInteger(lengthDays) && lengthDays >= 1 && lengthDays <= 365)
          ? "The campaign must run 1 to 365 days"
          : null;
  const problem = checked.problem ?? moneyProblem;

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-start">
      <div className="space-y-6">
        <Card n={1} title="The campaign">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm leading-6 text-muted">What the disclosure page calls you, and where your links send people.</p>
            <button type="button" onClick={() => setForm((f) => ({ ...f, ...DEMO_PRESET }))} className="text-sm underline decoration-line underline-offset-4 hover:decoration-ink">
              Start from the demo partner&apos;s rules
            </button>
          </div>
          <Field label="Name" hint={`Up to ${LIMITS.name} characters`}>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={LIMITS.name} placeholder="Stonk Wars" className={INPUT} />
          </Field>
          <Field label="One line about it" hint="Optional; shown on the campaign page">
            <input value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={LIMITS.description} placeholder="Stock-picking duels on Solana, settled by Pyth." className={INPUT} />
          </Field>
          <Field label="Destination" hint="An https URL in your app. Every link lands there with the tag in ?eo=">
            <input value={form.destination} onChange={(e) => set("destination", e.target.value)} placeholder="https://stonkwars.fun/new" className={`${INPUT} font-mono`} />
          </Field>
        </Card>

        <Card n={2} title="What you pay for">
          <fieldset>
            <legend className="text-sm text-muted">A conversion is when a wallet...</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Choice on={form.convKind === "sol-transfer"} onClick={() => set("convKind", "sol-transfer")} title="Deposits SOL" text="Sends at least this much SOL to your treasury" />
              <Choice on={form.convKind === "program"} onClick={() => set("convKind", "program")} title="Uses your program" text="Makes any transaction with your program" />
            </div>
          </fieldset>
          {form.convKind === "sol-transfer" ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Treasury address">
                <input value={form.convTo} onChange={(e) => set("convTo", e.target.value)} placeholder="HoYb..." className={`${INPUT} font-mono`} />
              </Field>
              <Field label="At least, in SOL">
                <input value={form.convSol} onChange={(e) => set("convSol", e.target.value)} inputMode="decimal" className={`${INPUT} font-mono`} />
              </Field>
            </div>
          ) : (
            <Field label="Program id">
              <input value={form.convProgram} onChange={(e) => set("convProgram", e.target.value)} placeholder="Hxr3..." className={`${INPUT} font-mono`} />
            </Field>
          )}

          <fieldset className="mt-6">
            <legend className="text-sm text-muted">...and it has stayed if, when the window closes, it...</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Choice on={form.retKind === "sol-balance"} onClick={() => set("retKind", "sol-balance")} title="Still holds SOL" text="Did not drain the wallet" />
              <Choice on={form.retKind === "token-balance"} onClick={() => set("retKind", "token-balance")} title="Still holds a token" text="Kept a position or receipt" />
              <Choice on={form.retKind === "program-activity"} onClick={() => set("retKind", "program-activity")} title="Came back" text="Used your program again" />
            </div>
          </fieldset>
          {form.retKind === "sol-balance" && (
            <Field label="At least, in SOL">
              <input value={form.retSol} onChange={(e) => set("retSol", e.target.value)} inputMode="decimal" className={`${INPUT} max-w-[200px] font-mono`} />
            </Field>
          )}
          {form.retKind === "token-balance" && (
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Token mint" hint={retDecimals === null ? (isAddress(form.retMint) ? "Reading the mint..." : undefined) : `${retDecimals} decimals`}>
                <input value={form.retMint} onChange={(e) => set("retMint", e.target.value)} placeholder="Mint address" className={`${INPUT} font-mono`} />
              </Field>
              <Field label="At least, in tokens">
                <input value={form.retAmount} onChange={(e) => set("retAmount", e.target.value)} inputMode="decimal" className={`${INPUT} font-mono`} />
              </Field>
            </div>
          )}
          {form.retKind === "program-activity" && (
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Program id">
                <input value={form.retProgram} onChange={(e) => set("retProgram", e.target.value)} placeholder="Hxr3..." className={`${INPUT} font-mono`} />
              </Field>
              <Field label="Return visits, at least">
                <input value={form.retVisits} onChange={(e) => set("retVisits", e.target.value)} inputMode="numeric" className={`${INPUT} font-mono`} />
              </Field>
            </div>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Field label="The window" hint="How long a wallet must stay">
              <select value={form.retentionSecs} onChange={(e) => set("retentionSecs", Number(e.target.value))} className={INPUT}>
                {RETENTION_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Campaign runs for" hint="Days conversions count">
              <input value={form.lengthDays} onChange={(e) => set("lengthDays", e.target.value)} inputMode="numeric" className={`${INPUT} font-mono`} />
            </Field>
            <Field label="A click counts for" hint="Time from click to conversion">
              <select value={form.attributionWindowSecs} onChange={(e) => set("attributionWindowSecs", Number(e.target.value))} className={INPUT}>
                {WINDOW_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">Cluster check</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field label="Wallets per funder" hint="More than this from one quiet source is a farm">
                <input value={form.maxWallets} onChange={(e) => set("maxWallets", e.target.value)} inputMode="numeric" className={`${INPUT} font-mono`} />
              </Field>
              <Field label="Funders to ignore" hint="A faucet you run, one address per line. Each one is a way around the check.">
                <textarea value={form.ignoreFunders} onChange={(e) => set("ignoreFunders", e.target.value)} rows={2} className={`${INPUT} font-mono`} />
              </Field>
            </div>
          </details>
        </Card>

        <Card n={3} title="The money">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Per user who stays" hint={`In ${TEST_USD.symbol}, the devnet test dollar`}>
              <input value={form.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" className={`${INPUT} font-mono`} />
            </Field>
            <Field label="Fund now" hint="Empty to fund later; top-ups are always open">
              <input value={form.budget} onChange={(e) => set("budget", e.target.value)} inputMode="decimal" className={`${INPUT} font-mono`} />
            </Field>
          </div>
          {payout !== null && budget !== null && budget > 0n && (
            <p className="mt-3 text-sm leading-6 text-muted">
              {money(budget, p.decimals)} pays for {(Number(budget) / Number(payout)).toLocaleString("en-US", { maximumFractionDigits: 0 })} users who stay{" "}
              {duration(form.retentionSecs)}. Whatever nobody earns comes back to you after the deadline.
            </p>
          )}
        </Card>

        <Card n={4} title="Sign it">
          {p.reason ? (
            <p className="text-sm leading-6 text-unpaid">{p.reason}</p>
          ) : connected ? (
            <Create wallet={connected.wallet} account={connected.account} form={form} rules={checked.rules} payout={payout} budget={budget ?? 0n} problem={problem} {...p} />
          ) : (
            <>
              <p className="text-sm leading-6 text-muted">The wallet that signs is the advertiser: it funds the vault, adds creators, and gets the refund.</p>
              <ChooseWallet wallets={wallets} />
            </>
          )}
        </Card>
      </div>

      <Preview form={form} rules={checked.rules} payout={payout} decimals={p.decimals} />
    </div>
  );
}

// ── the signature ────────────────────────────────────────────────────────────

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming"; signature: string }
  | { kind: "registering"; signature: string; campaign: string }
  | { kind: "error"; message: string };

function Create(
  p: Props & {
    wallet: UiWallet;
    account: UiWalletAccount;
    form: Form;
    rules: Rules | null;
    payout: bigint | null;
    budget: bigint;
    problem: string | null;
  },
) {
  const signer = useWalletAccountTransactionSigner(p.account, CHAIN);
  const [, disconnect] = useDisconnect(p.wallet);
  const router = useRouter();
  const [lamports, setLamports] = useState<bigint | null>(null);
  const [tokens, setTokens] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const mint = address(p.mint);
  const owner = address(p.account.address);

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

  async function create() {
    if (!p.rules || p.payout === null || !p.identity) return;
    const client = rpc();
    try {
      setPhase({ kind: "signing" });
      const rules = p.rules;
      const hash = await rulesHash(rules);
      const seed = BigInt(Date.now());
      const campaign = await campaignAddress(owner, seed);
      const now = Math.floor(Date.now() / 1000);
      const endsAt = BigInt(now + Number(p.form.lengthDays) * 86_400);
      const settleDeadline = endsAt + BigInt(p.form.retentionSecs) + 86_400n;
      const ixs = [
        await createCampaignIx({
          advertiser: signer,
          mint,
          seed,
          payout: p.payout,
          retentionSecs: p.form.retentionSecs,
          endsAt,
          settleDeadline,
          settler: address(p.settler),
          identity: address(p.identity),
        }),
        ...(p.budget > 0n ? [await fundIx({ funder: signer, campaign, mint, source: await ataAddress(owner, mint), amount: p.budget })] : []),
        memoIx(rulesMemo(hash)),
      ];
      const signature = await sendInstructions(client, signer, ixs, (s) => setPhase({ kind: "confirming", signature: s }));

      setPhase({ kind: "registering", signature, campaign });
      await register({ signature, campaign, rules });
      // Another server instance may hold the registry for two seconds more.
      await sleep(2_500);
      router.push(`/dashboard/${campaign}`);
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }

  const tooLittleSol = lamports !== null && lamports < CREATE_MIN_LAMPORTS;
  const tooFewTokens = tokens !== null && tokens < p.budget;
  const busy = phase.kind === "signing" || phase.kind === "confirming" || phase.kind === "registering";
  const isTestUsd = mint === TEST_USD.mint;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3 font-mono text-sm">
        <span>
          {p.wallet.name} {shortAddress(p.account.address)}
        </span>
        <span className="text-muted">
          {lamports === null ? "" : `${sol(lamports)} SOL`}
          {tokens === null ? "" : ` · ${money(tokens, p.decimals)} ${TEST_USD.symbol}`}
          <button onClick={() => void disconnect()} className="ml-4 underline decoration-line underline-offset-2 hover:text-ink">
            disconnect
          </button>
        </span>
      </div>

      {tooLittleSol && <Faucet wallet={p.account.address} onFunded={refresh} need="Creating a campaign writes two accounts on devnet: about 0.005 devnet SOL in rent and fees, and this wallet has less." />}
      {tooFewTokens &&
        (isTestUsd ? (
          <Faucet
            kind="usd"
            wallet={p.account.address}
            onFunded={refresh}
            need={`Funding ${money(p.budget, p.decimals)} needs that much ${TEST_USD.symbol} in this wallet, and it holds ${money(tokens ?? 0n, p.decimals)}.`}
          />
        ) : (
          <p className="mt-4 text-sm leading-6 text-unpaid">This wallet holds {money(tokens ?? 0n, p.decimals)} of the payout token. Lower the budget, or fund later.</p>
        ))}

      <button
        onClick={() => void create()}
        disabled={busy || !!p.problem || tooLittleSol || tooFewTokens || !p.identity}
        className="mt-5 rounded-full bg-ink px-6 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-50"
      >
        {phase.kind === "signing"
          ? "Approve in your wallet..."
          : phase.kind === "confirming"
            ? "Confirming on devnet..."
            : phase.kind === "registering"
              ? "Listing the campaign..."
              : p.budget > 0n && p.payout !== null
                ? `Create and fund ${money(p.budget, p.decimals)}`
                : "Create the campaign"}
      </button>
      {p.problem && !busy && <p className="mt-3 text-sm leading-6 text-muted">{p.problem}.</p>}
      {phase.kind === "confirming" && <p className="mt-3 font-mono text-xs text-muted">sent {shortAddress(phase.signature)}, waiting for confirmation</p>}
      {phase.kind === "error" && <p className="mt-3 text-sm leading-6 text-unpaid">{phase.message}</p>}
      <p className="mt-4 text-sm leading-6 text-muted">
        One transaction: create the campaign{p.budget > 0n ? ", fund it" : ""}, and commit to the rules by their hash. The settler is Earnout&apos;s ({shortAddress(p.settler)}); it can only ever pay out of this budget, never more.
      </p>
    </div>
  );
}

/** Ask the site to list the campaign. The RPC can take a moment to index a
 * new transaction, so a "not on chain yet" is retried. */
async function register(body: { signature: string; campaign: string; rules: Rules }): Promise<void> {
  for (let i = 0; ; i++) {
    const res = await fetch("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return;
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status !== 404 || i >= 8) throw new Error(error ?? "The campaign was created but could not be listed. Open it from the dashboard.");
    await sleep(1_500);
  }
}

// ── the preview ──────────────────────────────────────────────────────────────

function Preview({ form, rules, payout, decimals }: { form: Form; rules: Rules | null; payout: bigint | null; decimals: number }) {
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    if (!rules) return setHash(null);
    let live = true;
    rulesHash(rules).then((h) => live && setHash(h));
    return () => {
      live = false;
    };
  }, [rules]);

  const name = form.name.trim() || "your project";
  const price = payout === null ? "$—" : money(payout, decimals);
  return (
    <aside className="lg:sticky lg:top-24">
      <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">What visitors will read</p>
      <div className="torn mt-3 bg-card px-6 pt-6 pb-10">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Paid partnership</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          <span className="font-mono">@creator</span> sent you here.
        </h2>
        <p className="mt-3 text-[15px] leading-7 text-muted">
          They are paid by {name} only if you stay: {price} for each user who is still there {duration(form.retentionSecs)} later. Nothing is
          paid for a click, a visit, or a sign-up that leaves.
        </p>
        <dl className="mt-5 space-y-0.5 font-mono text-[13px] leading-6">
          <Row label="Paid by">{name}</Row>
          <Row label="Per user who stays">{price}</Row>
          <Row label="Must stay">{duration(form.retentionSecs)}</Row>
          <Row label="For this click">$0.00</Row>
        </dl>
      </div>

      <div className="mt-6 rounded-2xl border border-line p-6 text-[15px] leading-7">
        <h2 className="font-semibold tracking-tight">The rules, in words</h2>
        {rules ? (
          <>
            <p className="mt-2">
              A conversion is when a wallet {describeConversion(rules.conversion)}. It has stayed if, {duration(form.retentionSecs)} later, it{" "}
              {describeRetention(rules.retention)}.
            </p>
            <p className="mt-2 text-muted">
              A click counts for {duration(rules.attributionWindowSecs)}. More than {rules.sybil.maxWalletsPerFunder} converting wallets funded by one quiet source
              is a cluster, and none of them is paid for.
            </p>
            <p className="mt-3 font-mono text-xs text-muted break-all">rules hash {hash ?? "..."}</p>
            <p className="mt-1 text-sm text-muted">This hash goes into the transaction that creates the campaign. The rules cannot change afterwards.</p>
          </>
        ) : (
          <p className="mt-2 text-muted">Fill in the campaign and the rules appear here, along with the hash the transaction will commit to.</p>
        )}
      </div>
    </aside>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

const INPUT = "mt-1.5 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[15px] outline-none focus:border-ink";

function Card({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-7">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full border border-line font-mono text-xs text-muted">{n}</span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span>}
    </label>
  );
}

function Choice({ on, onClick, title, text }: { on: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-xl border px-4 py-3 text-left transition-colors ${on ? "border-ink bg-paper" : "border-line hover:border-ink"}`}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs leading-5 text-muted">{text}</span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
