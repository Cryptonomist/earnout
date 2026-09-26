import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CreatorHub } from "@/components/CreatorHub";
import { SiteHeader } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import Link from "next/link";
import { money } from "@/server/dashboard";
import { loadSecrets } from "@/server/links";
import { scorecards } from "@/server/scorecard";
import { COOKIE_PROFILE, openProfile, xConfig } from "@/server/x-auth";

export const metadata: Metadata = {
  title: "Creators",
  description: "Link your X account to your wallet and get paid for users who stay.",
};

export const dynamic = "force-dynamic";

type Params = { searchParams: Promise<{ x?: string; message?: string }> };

export default async function CreatorsPage({ searchParams }: Params) {
  const { x, message } = await searchParams;
  const cfg = xConfig();
  const profile = cfg ? openProfile(cfg.clientSecret, (await cookies()).get(COOKIE_PROFILE)?.value) : null;
  const identity = await loadSecrets()
    .then((s) => s.identityAddress as string)
    .catch(() => null);
  const cards = await scorecards().catch(() => []);

  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">For creators</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your name, <span className="font-serif font-normal italic">on the record.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          Link your X account to your wallet once. Every campaign you run adds to your public record: users sent, users
          who stayed, money earned. Projects can see it. Nobody can fake it.
        </p>

        {x === "error" && (
          <p className="mt-6 rounded-xl bg-unpaid-soft px-4 py-3 text-sm leading-6 text-unpaid">
            {message ?? "X sign-in failed."}
          </p>
        )}

        <CreatorHub profile={profile} identity={identity} xConfigured={!!cfg} />

        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">Verified creators</h2>
          <p className="mt-2 max-w-2xl leading-7 text-muted">
            Every creator on Earnout and their record so far. The numbers come from the chain and from Earnout&apos;s checks.
            Nobody edits them.
          </p>
          {cards.length ? (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line bg-card text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Creator</th>
                    <th className="px-4 py-3 text-right font-medium">Campaigns</th>
                    <th className="px-4 py-3 text-right font-medium">Users sent</th>
                    <th className="px-4 py-3 text-right font-medium">Stayed</th>
                    <th className="px-4 py-3 text-right font-medium">Stay rate</th>
                    <th className="px-4 py-3 text-right font-medium">Earned</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {cards.map((c) => (
                    <tr key={c.xId} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/creators/${c.handle}`} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                          @{c.handle}
                        </Link>{" "}
                        <span className="text-xs text-paid">verified</span>
                      </td>
                      <td className="px-4 py-3 text-right">{c.campaigns}</td>
                      <td className="px-4 py-3 text-right">{c.tagged}</td>
                      <td className="px-4 py-3 text-right">{c.stayed}</td>
                      <td className="px-4 py-3 text-right">{c.stayRate === null ? "n/a" : `${Math.round(c.stayRate * 100)}%`}</td>
                      <td className="px-4 py-3 text-right">{c.earned !== null && c.decimals !== null ? money(c.earned, c.decimals) : "mixed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-muted">None yet.</p>
          )}
        </section>

        <section className="mt-16 grid gap-8 md:grid-cols-3">
          {[
            ["Two signatures", "Your wallet signs, and Earnout signs that X confirmed your account. Neither alone can write anything."],
            ["Read-only", "We read your public profile once. No posting, no messages, no access later."],
            ["Yours to move", "Change payout wallets any time by linking X from the new one. Your record comes with you."],
          ].map(([t, b]) => (
            <div key={t} className="border-t border-ink pt-5">
              <h2 className="font-semibold tracking-tight">{t}</h2>
              <p className="mt-2 text-[15px] leading-7 text-muted">{b}</p>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
