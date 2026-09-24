"use client";

/* Same campaign, same audience, same users staying or going; the only thing
 * that changes is what the money is paid for. Paying up front spends the
 * whole budget whatever happens. Earnout pays the price per user for each
 * one who stayed, up to the budget, and the rest never leaves the vault. */

import { useId, useState } from "react";

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
const num = (n: number) => n.toLocaleString("en-US");

export function Calculator() {
  const [budget, setBudget] = useState(10_000);
  const [wallets, setWallets] = useState(2_000);
  const [stay, setStay] = useState(25);
  const [price, setPrice] = useState(12);

  const stayed = Math.round((wallets * stay) / 100);
  const paidFor = Math.min(stayed, Math.floor(budget / price));
  const earnoutSpend = paidFor * price;
  const back = budget - earnoutSpend;
  const upfrontPer = stayed > 0 ? budget / stayed : Infinity;
  const spentShare = budget > 0 ? earnoutSpend / budget : 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
      <div className="space-y-6">
        <Slider label="Campaign budget" value={budget} display={usd(budget)} min={1_000} max={100_000} step={1_000} onChange={setBudget} />
        <Slider label="Wallets your channels bring" value={wallets} display={num(wallets)} min={100} max={20_000} step={100} onChange={setWallets} />
        <Slider label="Still active when the window closes" value={stay} display={`${stay}%`} min={1} max={100} step={1} onChange={setStay} />
        <Slider label="Price you set per user who stayed" value={price} display={usd(price)} min={1} max={100} step={1} onChange={setPrice} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Outcome
          title="Paying up front"
          lines={[
            ["Spent", usd(budget)],
            ["Users who stayed", num(stayed)],
          ]}
          headline={Number.isFinite(upfrontPer) ? usd(upfrontPer, 2) : "n/a"}
          caption="per user who stayed"
          bar={1}
        />
        <Outcome
          title="With Earnout"
          highlight
          lines={[
            ["Paid", usd(earnoutSpend)],
            ["Back to you", usd(back)],
          ]}
          headline={paidFor > 0 ? usd(price, 2) : "n/a"}
          caption={paidFor < stayed ? `per user, budget covers ${num(paidFor)} of ${num(stayed)}` : "per user who stayed"}
          bar={spentShare}
        />
        <p className="text-sm leading-6 sm:col-span-2" aria-live="polite">
          {upfrontPer > price
            ? `Paying up front costs ${usd(upfrontPer - price, 2)} more for every user who stayed, and you only learn that after the money is gone.`
            : `Here paying up front comes out cheaper, but only because you already knew ${stay}% would stay. An up-front deal is a bet on that number; Earnout pays for the result.`}
        </p>
        <p className="text-sm leading-6 text-muted sm:col-span-2">
          Illustrative. Nothing here changes who shows up or who stays; it changes what you pay for. The price per user is
          yours to set, and channels see it before they send anyone.
        </p>
      </div>
    </div>
  );
}

function Slider(p: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm text-muted">
          {p.label}
        </label>
        <output htmlFor={id} className="font-mono text-base tabular-nums">
          {p.display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => p.onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--ink)]"
      />
    </div>
  );
}

function Outcome(p: {
  title: string;
  lines: [string, string][];
  headline: string;
  caption: string;
  bar: number;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-5 ${p.highlight ? "border-ink bg-card" : "border-line"}`}>
      <div className="text-sm font-medium">{p.title}</div>
      <div className="mt-4 font-serif text-4xl tracking-tight tabular-nums">{p.headline}</div>
      <div className="text-sm text-muted">{p.caption}</div>
      {/* Share of the budget spent: ink for spent, bare track for what stayed. */}
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.round(p.bar * 100)}%` }} />
      </div>
      <dl className="mt-4 space-y-1 font-mono text-sm">
        {p.lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
