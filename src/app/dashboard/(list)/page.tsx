import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import { ago, campaignChain, campaignList, campaignReport, duration, money } from "@/server/dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Every Earnout campaign: what it paid, and for whom.",
};

export const revalidate = 30;

export default async function DashboardPage() {
  const campaigns = await Promise.all(
    (await campaignList()).map(async (meta) => {
      const [chain, report] = await Promise.all([campaignChain(meta.address).catch(() => null), campaignReport(meta.address)]);
      return { meta, chain, report };
    }),
  );

  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Dashboard</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Campaigns</h1>
          <Link href="/dashboard/new" className="rounded-full bg-ink px-5 py-2.5 font-medium text-paper hover:opacity-90">
            Start a campaign
          </Link>
        </div>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Each campaign pays its KOLs only for users who stayed. Money is read live from Solana; the counts come from
          Earnout&apos;s latest check. Public while Earnout runs on devnet.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {campaigns.map(({ meta, chain, report }) => {
            const tagged = report?.channels.reduce((n, c) => n + c.tagged, 0) ?? null;
            const settled = chain?.channels.reduce((n, c) => n + c.conversions, 0n) ?? 0n;
            return (
              <Link
                key={meta.address}
                href={`/dashboard/${meta.address}`}
                className="group rounded-2xl border border-line bg-card p-7 hover:border-ink"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold tracking-tight">{meta.name}</h2>
                  <span className="text-sm text-muted group-hover:text-ink">Open</span>
                </div>
                {chain ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      {money(chain.payout, chain.decimals)} per user who stays {duration(chain.retentionSecs)} ·{" "}
                      {chain.channels.length} KOL{chain.channels.length === 1 ? "" : "s"}
                    </p>
                    <dl className="mt-6 grid grid-cols-3 gap-4">
                      <Figure label="Budget" value={money(chain.funded, chain.decimals)} />
                      <Figure label="Paid to KOLs" value={money(chain.committed, chain.decimals)} />
                      <Figure label="Users who stayed" value={String(settled)} />
                    </dl>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-unpaid">Could not read this campaign from Solana just now.</p>
                )}
                <p className="mt-6 text-xs text-muted">
                  {report
                    ? `${tagged} user${tagged === 1 ? "" : "s"} sent · checked ${ago(report.updatedAt)}`
                    : "Not checked yet"}
                </p>
              </Link>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight">{value}</dd>
    </div>
  );
}
