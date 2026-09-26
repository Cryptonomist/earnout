import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimPanel } from "@/components/ClaimPanel";
import { CopyLink } from "@/components/CopyLink";
import { ChannelReceipt, SiteHeader } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import { campaignChain, campaignMeta, campaignReport, duration, linkFor, money } from "@/server/dashboard";

/* A creator's page: their link, their receipt, and a claim button. Anyone
 * with the slug can see it, as anyone who sees the link could; only the
 * channel's payout wallet can claim. */

export const revalidate = 30;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: `earnout.dev/r/${slug}`, robots: { index: false } };
}

export default async function CreatorPage({ params }: Params) {
  const { slug } = await params;
  const link = await linkFor(slug);
  if (!link) notFound();
  const [meta, chain, report] = await Promise.all([
    campaignMeta(link.campaign),
    campaignChain(link.campaign).catch(() => null),
    campaignReport(link.campaign),
  ]);
  const channel = chain?.channels.find((c) => c.index === link.channel);
  const url = `https://earnout.dev/r/${slug}`;

  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Creator page</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="font-mono text-2xl font-semibold tracking-tight break-all sm:text-3xl">earnout.dev/r/{slug}</h1>
          <CopyLink url={url} />
        </div>

        {!chain || !channel ? (
          <p className="mt-6 text-unpaid">Could not read this channel from Solana just now. Try again in a moment.</p>
        ) : (
          <>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
              {channel.handle ? (
                <>
                  <span className="font-mono text-ink">@{channel.handle}</span>, verified on X.{" "}
                </>
              ) : (
                <>Added before X verification. </>
              )}
              For {meta?.name ?? "this campaign"}: you earn {money(chain.payout, chain.decimals)} for each person who comes
              through your link, joins, and is still there {duration(chain.retentionSecs)} later. Nobody else can see which
              wallets you sent.
            </p>

            <div className="mt-10 grid gap-10 md:grid-cols-[1fr_1fr] md:items-start">
              <ChannelReceipt
                chain={channel}
                report={report?.channels.find((c) => c.index === channel.index) ?? null}
                slug={slug}
                payout={chain.payout}
                decimals={chain.decimals}
                showCreatorLink={false}
              />
              <section className="rounded-2xl border border-line p-7">
                <h2 className="text-lg font-semibold tracking-tight">Claim your earnings</h2>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{money(channel.earned - channel.claimed, chain.decimals)}</p>
                <p className="text-sm text-muted">claimable now, from a vault that is already funded</p>
                <ClaimPanel
                  campaign={chain.address}
                  channel={channel.address}
                  mint={chain.mint}
                  payee={channel.payee}
                  claimable={String(channel.earned - channel.claimed)}
                  amountText={money(channel.earned - channel.claimed, chain.decimals)}
                />
              </section>
            </div>

            <p className="mt-10 text-sm text-muted">
              <Link href={`/dashboard/${chain.address}`} className="underline decoration-line underline-offset-4 hover:text-ink">
                See the whole campaign
              </Link>
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
