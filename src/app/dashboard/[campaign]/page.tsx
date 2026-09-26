import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetMeter, ChannelReceipt, SiteHeader, StatTile } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import {
  ago,
  campaignChain,
  campaignMeta,
  campaignReport,
  duration,
  explorer,
  money,
  short,
  slugsByChannel,
} from "@/server/dashboard";

export const revalidate = 30;

type Params = { params: Promise<{ campaign: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const meta = campaignMeta((await params).campaign);
  return { title: meta ? `${meta.name} campaign` : "Campaign" };
}

function status(now: number, endsAt: number, deadline: number): string {
  if (now < endsAt) return "Live";
  if (now <= deadline) return "Ended, still settling";
  return "Closed";
}

export default async function CampaignPage({ params }: Params) {
  const meta = campaignMeta((await params).campaign);
  if (!meta) notFound();
  const [chain, report] = await Promise.all([campaignChain(meta.address).catch(() => null), campaignReport(meta.address)]);
  const slugs = slugsByChannel();

  if (!chain) {
    return (
      <>
        <SiteHeader />
        <main id="content" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight">{meta.name}</h1>
          <p className="mt-4 text-unpaid">Could not read this campaign from Solana just now. Try again in a moment.</p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const d = chain.decimals;
  const byIndex = new Map(report?.channels.map((c) => [c.index, c]) ?? []);
  const sum = (f: (c: NonNullable<typeof report>["channels"][number]) => number) =>
    report ? report.channels.reduce((n, c) => n + f(c), 0) : null;
  const tagged = sum((c) => c.tagged);
  const notPaid = sum((c) => c.gone + c.flagged + c.otherRejected);
  const waiting = sum((c) => c.waiting + c.qualified);
  const settled = chain.channels.reduce((n, c) => n + c.conversions, 0n);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
          All campaigns
        </Link>
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{meta.name}</h1>
          <span className="rounded-full border border-line px-3 py-1 text-sm">{status(now, chain.endsAt, chain.settleDeadline)}</span>
        </div>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
          Pays {money(chain.payout, d)} for each user who stays {duration(chain.retentionSecs)}. Conversions count until{" "}
          {new Date(chain.endsAt * 1000).toUTCString().slice(5, 16)}.
          {meta.description ? ` ${meta.description}` : ""}
        </p>
        <p className="mt-3 font-mono text-xs text-muted">
          campaign{" "}
          <a href={explorer("address", chain.address)} className="underline decoration-line underline-offset-2 hover:text-ink">
            {short(chain.address)}
          </a>{" "}
          · advertiser {short(chain.advertiser)}
        </p>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Headline numbers">
          <StatTile label="Wallets tagged" value={tagged === null ? "not reported" : String(tagged)} note="Came through a channel's link and converted" />
          <StatTile
            label="Stayed and paid for"
            value={String(settled)}
            note={waiting ? `${waiting} more waiting out the window or settling` : "Settled on chain"}
          />
          <StatTile label="Not paid for" value={notPaid === null ? "not reported" : String(notPaid)} note="Left before the window closed, or flagged" />
          <StatTile label="Cost per user who stayed" value={money(chain.payout, d)} note="Set by the campaign, paid only after the window" />
        </section>

        <section className="mt-6 rounded-2xl border border-line p-6 sm:p-8">
          <BudgetMeter funded={chain.funded} committed={chain.committed} claimed={chain.claimed} refunded={chain.refunded} decimals={d} />
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Channels</h2>
          <p className="mt-2 max-w-2xl leading-7 text-muted">
            One receipt per creator or partner. Which wallet came through which channel stays private; these are the counts.
          </p>
          <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {chain.channels.map((ch) => (
              <ChannelReceipt
                key={ch.index}
                chain={ch}
                report={byIndex.get(ch.index) ?? null}
                slug={slugs.get(`${chain.address}:${ch.index}`) ?? null}
                payout={chain.payout}
                decimals={d}
              />
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Settlements</h2>
          {report && report.batches.length ? (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line bg-card text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Channel</th>
                    <th className="px-4 py-3 font-medium">Batch</th>
                    <th className="px-4 py-3 text-right font-medium">Users</th>
                    <th className="px-4 py-3 text-right font-medium">Paid</th>
                    <th className="px-4 py-3 font-medium">Evidence root</th>
                    <th className="px-4 py-3 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {[...report.batches].reverse().map((b) => (
                    <tr key={`${b.channel}-${b.batch}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-sans">{slugs.get(`${chain.address}:${b.channel}`) ?? `channel ${b.channel}`}</td>
                      <td className="px-4 py-3 tabular-nums">{b.batch}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.conversions}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(BigInt(b.conversions) * chain.payout, d)}</td>
                      <td className="px-4 py-3">{`${b.evidence.slice(0, 8)}...${b.evidence.slice(-4)}`}</td>
                      <td className="px-4 py-3">
                        {b.tx ? (
                          <a href={explorer("tx", b.tx)} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                            {short(b.tx)}
                          </a>
                        ) : (
                          "pending"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 leading-7 text-muted">No settlements reported yet.</p>
          )}
          <p className="mt-4 text-sm leading-6 text-muted">
            Each evidence root is stored on the channel&apos;s account. The advertiser holds the list of conversions behind it
            and can check every one against the chain.
          </p>
        </section>

        <p className="mt-14 border-t border-line pt-6 text-sm text-muted">
          {report ? `Counts from the settler's pass ${ago(report.updatedAt)}.` : "The settler has not published a report yet."} Money
          read from Solana devnet within the last 30 seconds. Amounts are a devnet test token standing in for USDC.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
