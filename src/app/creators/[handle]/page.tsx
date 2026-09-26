import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, StatTile } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import { explorer, money, short } from "@/server/dashboard";
import { scorecard } from "@/server/scorecard";

/* A creator's public record: what their links brought, across every
 * campaign, in counts. Nobody can edit it, and it cannot be shed by
 * changing wallets, because channels are grouped by X account. */

export const revalidate = 30;

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${decodeURIComponent(handle).replace(/^@/, "")} on Earnout` };
}

const pct = (r: number | null) => (r === null ? "n/a" : `${Math.round(r * 100)}%`);

export default async function CreatorScorecard({ params }: Params) {
  const { handle } = await params;
  const card = await scorecard(decodeURIComponent(handle));
  if (!card) notFound();

  const m = (n: bigint, d: number) => money(n, d);
  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <Link href="/creators" className="text-sm text-muted hover:text-ink">
          Creators
        </Link>
        <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="font-mono text-4xl font-semibold tracking-tight sm:text-5xl">@{card.handle}</h1>
          <span className="rounded-full bg-paid-soft px-3 py-1 text-sm text-paid">verified X</span>
          <a href={`https://x.com/${card.handle}`} className="text-sm text-muted underline decoration-line underline-offset-4 hover:text-ink">
            x.com/{card.handle}
          </a>
        </div>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          {card.campaigns} campaign{card.campaigns === 1 ? "" : "s"} on Earnout. Every number here is the settler&apos;s
          count or the chain&apos;s; none of it can be edited, and it stays with this X account whatever wallet it pays to.
        </p>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Record">
          <StatTile label="Users sent" value={String(card.tagged)} note={card.pending ? `${card.pending} still in their window` : "Tagged conversions"} />
          <StatTile label="Stayed and paid for" value={String(card.stayed)} note="Settled on chain" />
          <StatTile label="Stay rate" value={pct(card.stayRate)} note="Of users whose window has closed" />
          <StatTile
            label="Flagged"
            value={String(card.flagged)}
            note={card.flagRate === null ? "Bot clusters, self-referrals" : `${pct(card.flagRate)} of decided users`}
          />
        </section>

        {card.earned !== null && card.decimals !== null && (
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatTile label="Earned" value={m(card.earned, card.decimals)} note="Across all campaigns" />
            <StatTile label="Claimed" value={m(card.claimed ?? 0n, card.decimals)} />
            <StatTile label="Gone before the window closed" value={String(card.gone)} note="Not paid for" />
          </section>
        )}

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Campaigns</h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line bg-card text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Link</th>
                  <th className="px-4 py-3 text-right font-medium">Sent</th>
                  <th className="px-4 py-3 text-right font-medium">Stayed</th>
                  <th className="px-4 py-3 text-right font-medium">Gone</th>
                  <th className="px-4 py-3 text-right font-medium">Flagged</th>
                  <th className="px-4 py-3 text-right font-medium">Earned</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {card.rows.map((r) => (
                  <tr key={`${r.campaign}-${r.index}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-sans">
                      <Link href={`/dashboard/${r.campaign}`} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                        {r.campaignName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.slug ? (
                        <Link href={`/c/${r.slug}`} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                          /r/{r.slug}
                        </Link>
                      ) : (
                        `channel ${r.index}`
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{r.reported ? r.tagged : "n/a"}</td>
                    <td className="px-4 py-3 text-right">{String(r.stayed)}</td>
                    <td className="px-4 py-3 text-right">{r.reported ? r.gone : "n/a"}</td>
                    <td className="px-4 py-3 text-right">{r.reported ? r.flagged : "n/a"}</td>
                    <td className="px-4 py-3 text-right">{m(r.earned, r.decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 text-sm leading-6 text-muted">
          <p>
            Paid to{" "}
            {card.payees.map((p, i) => (
              <span key={p}>
                {i > 0 && ", earlier "}
                <a href={explorer("address", p)} className="font-mono underline decoration-line underline-offset-2 hover:text-ink">
                  {short(p)}
                </a>
              </span>
            ))}
            . X account id {card.xId}.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
