import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mark } from "@/components/Logo";
import { campaignChain, campaignMeta, duration, linkFor, money } from "@/server/dashboard";

/* Every Earnout link discloses, before anything else happens: who is paid,
 * by whom, for what, and that nothing is paid for a click. The visitor
 * learns it here, on Earnout's own page; the partner app learns nothing
 * about which creator sent them, so the sealed channel stays sealed. The
 * tagged redirect (./go) is only minted when they choose to continue. */

export const revalidate = 60;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Paid partnership: /r/${slug}`, robots: { index: false, follow: false } };
}

export default async function DisclosurePage({ params }: Params) {
  const { slug } = await params;
  const link = await linkFor(slug);
  if (!link) notFound();
  const [meta, chain] = await Promise.all([campaignMeta(link.campaign), campaignChain(link.campaign).catch(() => null)]);
  const channel = chain?.channels.find((c) => c.index === link.channel) ?? null;
  const name = meta?.name ?? "the partner";
  const handle = channel?.handle ?? null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Mark />
          <span>earnout</span>
        </div>

        <p className="mt-10 font-mono text-xs tracking-[0.2em] text-muted uppercase">Paid partnership</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {handle ? (
            <>
              <span className="font-mono">@{handle}</span> sent you here.
            </>
          ) : (
            <>
              The <span className="font-mono">{slug}</span> link sent you here.
            </>
          )}
        </h1>
        <p className="mt-4 leading-7 text-muted">
          {chain ? (
            <>
              {name} pays {handle ? "them" : "for it"} only if you stay: {money(chain.payout, chain.decimals)} for each user still
              active {duration(chain.retentionSecs)} later. Nothing for a click, a visit, or a sign-up that leaves.
            </>
          ) : (
            <>
              {name} pays {handle ? "them" : "for it"} only for users who stay. Nothing for a click, a visit, or a sign-up that
              leaves.
            </>
          )}
        </p>

        <dl className="torn mt-8 bg-card px-6 pt-5 pb-10 font-mono text-[13px] leading-6">
          <Row label="Creator">
            {handle ? (
              <>
                <Link href={`/creators/${handle}`} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                  @{handle}
                </Link>{" "}
                <span className="text-paid">verified X</span>
              </>
            ) : (
              <span className="text-muted">demo link, unverified</span>
            )}
          </Row>
          <Row label="Paid by">{name}</Row>
          {chain && (
            <>
              <Row label="Per user who stays">{money(chain.payout, chain.decimals)}</Row>
              <Row label="Must stay">{duration(chain.retentionSecs)}</Row>
            </>
          )}
          <Row label="For this click">$0.00</Row>
        </dl>

        <a
          href={`/r/${slug}/go`}
          className="mt-8 block rounded-full bg-ink px-6 py-3.5 text-center font-medium text-paper hover:opacity-90"
        >
          Continue to {name}
        </a>

        <p className="mt-6 text-sm leading-6 text-muted">
          Every Earnout link says who is paid, and for what, before you decide. Your wallet is never tied to the creator
          on-chain. Only the project can see which link you used.{" "}
          <Link href="/" className="underline decoration-line underline-offset-2 hover:text-ink">
            About Earnout
          </Link>
        </p>
      </div>
    </main>
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
