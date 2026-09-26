import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdvertiserPanel } from "@/components/advertiser/AdvertiserPanel";
import { BudgetMeter, ChannelReceipt, SiteHeader, StatTile } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import { describeConversion, describeRetention } from "@/lib/rules";
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

/* Read fresh on every view: the advertiser acts from this page and expects
 * to see the result, and the money is one RPC call away. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ campaign: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const meta = await campaignMeta((await params).campaign);
  return { title: meta ? `${meta.name} campaign` : "Campaign" };
}

function status(now: number, endsAt: number, deadline: number): string {
  if (now < endsAt) return "Live";
  if (now <= deadline) return "Ended, still settling";
  return "Closed";
}

export default async function CampaignPage({ params }: Params) {
  const meta = await campaignMeta((await params).campaign);
  if (!meta) notFound();
  const [chain, report, slugs] = await Promise.all([campaignChain(meta.address).catch(() => null), campaignReport(meta.address), slugsByChannel()]);

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
  const slugOf = (index: number) => slugs.get(`${chain.address}:${index}`) ?? null;

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
          Pays {money(chain.payout, d)} per user who stays {duration(chain.retentionSecs)}. New users count until{" "}
          {new Date(chain.endsAt * 1000).toUTCString().slice(5, 16)}.
          {meta.description ? ` ${meta.description}` : ""}
        </p>
        <p className="mt-3 font-mono text-xs text-muted">
          campaign{" "}
          <a href={explorer("address", chain.address)} className="underline decoration-line underline-offset-2 hover:text-ink">
            {short(chain.address)}
          </a>{" "}
          · project {short(chain.advertiser)} · checked by {short(chain.settler)}
        </p>

        <AdvertiserPanel
          campaign={chain.address}
          advertiser={chain.advertiser}
          identity={chain.identity}
          mint={chain.mint}
          decimals={d}
          name={meta.name}
          source={meta.source}
          endsAt={chain.endsAt}
          settleDeadline={chain.settleDeadline}
          funded={String(chain.funded)}
          committed={String(chain.committed)}
          refunded={String(chain.refunded)}
          channels={chain.channels.map((ch) => ({ index: ch.index, slug: slugOf(ch.index), handle: ch.handle, payee: ch.payee }))}
        />

        {meta.rules && meta.rulesHash && (
          <section className="mt-8 rounded-2xl border border-line bg-card p-6 sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight">The rules, locked on-chain</h2>
            <dl className="mt-4 grid gap-4 text-[15px] leading-7 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">A user counts when their wallet</dt>
                <dd>{describeConversion(meta.rules.conversion)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">They have stayed if, {duration(chain.retentionSecs)} later, their wallet</dt>
                <dd>{describeRetention(meta.rules.retention)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">A link click counts for</dt>
                <dd>{duration(meta.rules.attributionWindowSecs)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Bot check: users from one quiet funder before they count as a farm</dt>
                <dd>{meta.rules.sybil.maxWalletsPerFunder}</dd>
              </div>
            </dl>
            <p className="mt-4 font-mono text-xs leading-6 text-muted break-all">
              rules hash {meta.rulesHash}
              {meta.rulesTx && (
                <>
                  , in{" "}
                  <a href={explorer("tx", meta.rulesTx)} className="underline decoration-line underline-offset-2 hover:text-ink">
                    the transaction that created the campaign
                  </a>
                </>
              )}
              . Links send people to <span className="text-ink">{meta.destination}</span>.
            </p>
          </section>
        )}

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Headline numbers">
          <StatTile label="Users sent" value={tagged === null ? "not checked yet" : String(tagged)} note="Came through a KOL's link and joined" />
          <StatTile
            label="Stayed and paid for"
            value={String(settled)}
            note={waiting ? `${waiting} more still in the stay period or being paid` : "Paid on-chain"}
          />
          <StatTile label="Not paid for" value={notPaid === null ? "not checked yet" : String(notPaid)} note="Left early, or flagged as bots" />
          <StatTile label="Price per user who stayed" value={money(chain.payout, d)} note="Set by the project, paid only after the stay period" />
        </section>

        <section className="mt-6 rounded-2xl border border-line p-6 sm:p-8">
          <BudgetMeter funded={chain.funded} committed={chain.committed} claimed={chain.claimed} refunded={chain.refunded} decimals={d} />
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">KOLs</h2>
          <p className="mt-2 max-w-2xl leading-7 text-muted">
            One receipt per KOL. Which user came through which KOL stays private; these are the counts.
          </p>
          {chain.channels.length ? (
            <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {chain.channels.map((ch) => (
                <ChannelReceipt key={ch.index} chain={ch} report={byIndex.get(ch.index) ?? null} slug={slugOf(ch.index)} payout={chain.payout} decimals={d} />
              ))}
            </div>
          ) : (
            <p className="mt-4 leading-7 text-muted">No KOLs yet. The project adds them by X handle above; each one gets a link and a receipt here.</p>
          )}
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Payouts</h2>
          {report && report.batches.length ? (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line bg-card text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">KOL</th>
                    <th className="px-4 py-3 font-medium">Payout</th>
                    <th className="px-4 py-3 text-right font-medium">Users</th>
                    <th className="px-4 py-3 text-right font-medium">Paid</th>
                    <th className="px-4 py-3 font-medium">Proof</th>
                    <th className="px-4 py-3 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {[...report.batches].reverse().map((b) => (
                    <tr key={`${b.channel}-${b.batch}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-sans">{slugOf(b.channel) ?? `channel ${b.channel}`}</td>
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
            <p className="mt-4 leading-7 text-muted">No payouts yet.</p>
          )}
          <p className="mt-4 text-sm leading-6 text-muted">
            Each proof is stored on-chain with the KOL&apos;s account. The project holds the list of users behind it and
            can check every one against the chain.
          </p>
        </section>

        <p className="mt-14 border-t border-line pt-6 text-sm text-muted">
          {report ? `Counts from Earnout's check ${ago(report.updatedAt)}.` : "Earnout has not checked this campaign yet; it checks every ten minutes."} Money
          read from Solana devnet just now. Amounts are a devnet test token standing in for USDC.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
