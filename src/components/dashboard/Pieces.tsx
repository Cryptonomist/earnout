/* The dashboard's building blocks. Server components: nothing here needs the
 * browser except the hover values, which are CSS. */

import Link from "next/link";
import type { ChannelReport } from "@/lib/report";
import { explorer, money, short, type ChannelChain } from "@/server/dashboard";

export { SiteHeader } from "@/components/SiteShell";

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {note && <div className="mt-1 text-sm leading-5 text-muted">{note}</div>}
    </div>
  );
}

/* The budget as a meter: one scale of green for money that has gone to
 * channels (claimed, then owed), on a pale track of the same green for what
 * is not committed yet. The segments are separated by a 2px surface gap,
 * each shows its value on hover or focus, and the legend beside it is the
 * table view: every number, in text. */
export function BudgetMeter(p: {
  funded: bigint;
  committed: bigint;
  claimed: bigint;
  refunded: bigint;
  decimals: number;
}) {
  const owed = p.committed - p.claimed;
  const uncommitted = p.funded - p.committed - p.refunded;
  const pct = (n: bigint) => (p.funded > 0n ? Math.max(0, (Number(n) / Number(p.funded)) * 100) : 0);
  const segments = [
    { key: "claimed", label: "Claimed by KOLs", value: p.claimed, className: "bg-paid" },
    { key: "owed", label: "Earned, not yet claimed", value: owed, className: "bg-paid-mid" },
  ].filter((s) => s.value > 0n);
  const rows: [string, bigint, string][] = [
    ["Claimed by KOLs", p.claimed, "bg-paid"],
    ["Earned, not yet claimed", owed, "bg-paid-mid"],
    ["Still unspent", uncommitted, "bg-paid-soft border border-line"],
  ];
  if (p.refunded > 0n) rows.push(["Refunded to the project", p.refunded, "bg-line"]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Budget</span>
          <span className="font-medium">{money(p.funded, p.decimals)} funded</span>
        </div>
        <div className="mt-3 flex h-4 gap-[2px] overflow-visible rounded-md bg-paid-soft" role="img" aria-label="Budget meter; values in the table beside it">
          {segments.map((s, i) => (
            <div
              key={s.key}
              tabIndex={0}
              className={`group relative h-full ${s.className} ${i === 0 ? "rounded-l-md" : ""} outline-offset-2`}
              style={{ width: `${pct(s.value)}%`, minWidth: "6px" }}
            >
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 rounded-md bg-ink px-2 py-1 font-mono text-xs whitespace-nowrap text-paper group-hover:block group-focus:block">
                {s.label}: {money(s.value, p.decimals)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value, swatch]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <td className="py-2">
                <span className={`mr-2 inline-block size-3 rounded-sm align-middle ${swatch}`} aria-hidden="true" />
                {label}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">{money(value, p.decimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* One channel's receipt, in the landing page's printed style, with real
 * numbers: counts from the settler's report, money from the chain. */
export function ChannelReceipt({
  chain,
  report,
  slug,
  payout,
  decimals,
  showCreatorLink = true,
}: {
  chain: ChannelChain;
  report: ChannelReport | null;
  slug: string | null;
  payout: bigint;
  decimals: number;
  showCreatorLink?: boolean;
}) {
  const claimable = chain.earned - chain.claimed;
  const notPaid = report ? report.gone + report.flagged + report.otherRejected : 0;
  return (
    <figure className="torn bg-card px-6 pt-6 pb-11 font-mono text-[13px] leading-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] tracking-[0.2em] text-muted">CREATOR {chain.index}</div>
          <div className="text-base font-semibold tracking-tight">{slug ?? `channel ${chain.index}`}</div>
          {chain.handle ? (
            <div className="mt-0.5 text-[12px]">
              <Link href={`/creators/${chain.handle}`} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                @{chain.handle}
              </Link>{" "}
              <span className="text-paid">verified X</span>
            </div>
          ) : (
            <div className="mt-0.5 text-[12px] text-unpaid">unverified: added before X verification</div>
          )}
        </div>
        <a href={explorer("address", chain.payee)} className="text-[11px] text-muted underline decoration-line underline-offset-2 hover:text-ink">
          pays {short(chain.payee)}
        </a>
      </div>
      <hr className="rule my-4" />
      {report ? (
        <dl className="space-y-0.5">
          <Row label="Users sent" value={String(report.tagged)} />
          <Row label="Still in the stay period" value={String(report.waiting)} />
          <Row label="Left early" value={report.gone ? `-${report.gone}` : "0"} unpaid={report.gone > 0} />
          <Row label="Flagged as bots" value={report.flagged ? `-${report.flagged}` : "0"} unpaid={report.flagged > 0} />
          {report.otherRejected > 0 && <Row label="Not counted" value={`-${report.otherRejected}`} unpaid />}
        </dl>
      ) : (
        <p className="text-muted">Sent, left and flagged counts appear after Earnout&apos;s next check.</p>
      )}
      <hr className="rule my-4" />
      <dl className="space-y-0.5">
        <Row label="Stayed, paid on-chain" value={String(chain.conversions)} strong />
        {report && report.qualified > 0 && <Row label="Stayed, paying next" value={String(report.qualified)} />}
        <Row label="x price per user" value={money(payout, decimals)} />
      </dl>
      <div className="mt-4 flex items-baseline justify-between rounded-sm bg-paid-soft px-2 py-1.5 text-paid">
        <span className="font-semibold">Earned</span>
        <span className="text-base font-semibold">{money(chain.earned, decimals)}</span>
      </div>
      <dl className="mt-1.5 space-y-0.5 px-2">
        <Row label="Claimed" value={money(chain.claimed, decimals)} />
        <Row label="Claimable now" value={money(claimable, decimals)} strong={claimable > 0n} />
        {report && notPaid > 0 && <Row label={`Not paid, ${notPaid} user${notPaid === 1 ? "" : "s"}`} value={money(BigInt(notPaid) * payout, decimals)} unpaid />}
      </dl>
      <hr className="rule my-4" />
      <dl className="space-y-0.5 text-[11px] text-muted">
        <Row label="Payouts" value={String(chain.batches)} />
        <Row label="Latest proof" value={chain.batches ? `${chain.evidence.slice(0, 6)}...${chain.evidence.slice(-4)}` : "none yet"} />
      </dl>
      {showCreatorLink && slug && (
        <Link href={`/c/${slug}`} className="mt-4 inline-block font-sans text-sm underline decoration-line underline-offset-4 hover:decoration-ink">
          KOL page for {slug}
        </Link>
      )}
    </figure>
  );
}

function Row({ label, value, unpaid, strong }: { label: string; value: string; unpaid?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${unpaid ? "text-unpaid" : ""} ${strong ? "font-semibold" : ""}`}>
      <dt className={unpaid || strong ? "" : "text-muted"}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
