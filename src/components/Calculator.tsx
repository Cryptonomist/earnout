"use client";

/* Same campaign, same audience, same users staying or going; the only thing
 * that changes is what the money is paid for. Paying up front spends the
 * whole budget whatever happens, so the share of it that went to users who
 * left is the share who left. Earnout pays the price per user for each one
 * who stayed, up to the budget, and the rest never leaves the vault.
 *
 * The inputs read as one sentence, with the four numbers in it; the sliders
 * under it move them. The two outcomes under that are sentences too. */

import { useId, useState } from "react";

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
const num = (n: number) => n.toLocaleString("en-US");

export function Calculator() {
  const [budget, setBudget] = useState(10_000);
  const [users, setUsers] = useState(2_000);
  const [stay, setStay] = useState(25);
  const [price, setPrice] = useState(12);

  const stayed = Math.round((users * stay) / 100);
  const left = users - stayed;
  const paidFor = Math.min(stayed, Math.floor(budget / price));
  const earnoutSpend = paidFor * price;
  const back = budget - earnoutSpend;
  const upfrontPer = stayed > 0 ? budget / stayed : Infinity;
  const upfrontWasted = Math.round(budget * (left / Math.max(users, 1)));
  const capped = paidFor < stayed;

  return (
    <div>
      <p className="max-w-3xl text-2xl leading-[1.6] font-medium tracking-tight sm:text-3xl">
        My budget is <Num>{usd(budget)}</Num>. My creators bring <Num>{num(users)}</Num> users. <Num>{stay}%</Num> are still there a
        week later. I pay <Num>{usd(price)}</Num> per user who stays.
      </p>

      <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <Slider label="Budget" value={budget} display={usd(budget)} min={1_000} max={100_000} step={1_000} onChange={setBudget} />
        <Slider label="Users the creators bring" value={users} display={num(users)} min={100} max={20_000} step={100} onChange={setUsers} />
        <Slider label="Share still there a week later" value={stay} display={`${stay}%`} min={1} max={100} step={1} onChange={setStay} />
        <Slider label="Price per user who stays" value={price} display={usd(price)} min={1} max={100} step={1} onChange={setPrice} />
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Outcome
          title="Paying up front"
          headline={Number.isFinite(upfrontPer) ? usd(upfrontPer, 2) : "n/a"}
          caption="per user who stayed"
          bar={1}
          lines={[
            `${usd(budget)} gone, whatever happens.`,
            `${num(stayed)} users stayed.`,
            `${usd(upfrontWasted)} went to the ${num(left)} who left.`,
          ]}
        />
        <Outcome
          title="With Earnout"
          highlight
          headline={paidFor > 0 ? usd(price, 2) : "n/a"}
          caption="per user who stayed"
          bar={budget > 0 ? earnoutSpend / budget : 0}
          lines={[
            `${usd(earnoutSpend)} paid, ${usd(back)} back to you.`,
            capped ? `${num(paidFor)} of the ${num(stayed)} who stayed paid for; the budget ran out.` : `${num(stayed)} users stayed.`,
            `$0 went to the ${num(left)} who left.`,
          ]}
        />
      </div>

      <p className="mt-6 max-w-3xl text-[15px] leading-7" aria-live="polite">
        {upfrontPer > price
          ? `Paying up front costs ${usd(upfrontPer - price, 2)} more for every user who stayed, and you only find out after the money is gone.`
          : `Here paying up front comes out cheaper, but only because you already knew ${stay}% would stay. Up front is a bet on that number; Earnout pays for the result.`}{" "}
        <span className="text-muted">
          An illustration: nothing here changes who shows up or who stays, only what you pay for. You set the price, and creators
          see it before they send anyone.
        </span>
      </p>
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-card px-2 py-0.5 font-mono text-[0.85em] tabular-nums ring-1 ring-line">{children}</span>;
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
        <output htmlFor={id} className="font-mono text-sm tabular-nums">
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

function Outcome(p: { title: string; headline: string; caption: string; bar: number; lines: string[]; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-6 ${p.highlight ? "border-ink bg-card" : "border-line"}`}>
      <div className="text-sm font-medium">{p.title}</div>
      <div className="mt-3 font-serif text-4xl tracking-tight tabular-nums">{p.headline}</div>
      <div className="text-sm text-muted">{p.caption}</div>
      {/* Share of the budget spent: ink for spent, bare track for what stayed with you. */}
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.round(p.bar * 100)}%` }} />
      </div>
      <ul className="mt-5 space-y-1.5 text-[15px] leading-7">
        {p.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
