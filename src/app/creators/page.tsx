import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CreatorHub } from "@/components/CreatorHub";
import { SiteHeader } from "@/components/dashboard/Pieces";
import { loadSecrets } from "@/server/links";
import { COOKIE_PROFILE, openProfile, xConfig } from "@/server/x-auth";

export const metadata: Metadata = {
  title: "Creators",
  description: "Link your X account to your wallet and become a verified Earnout channel.",
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

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">For creators</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your name, <span className="font-serif font-normal italic">on the record.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          Every Earnout channel belongs to a verified X account. Link yours to your wallet once, and every campaign you
          run builds a record that follows you: users sent, users who stayed, and what you were paid, all checkable on
          chain. Projects can see it, and nobody can fake it.
        </p>

        {x === "error" && (
          <p className="mt-6 rounded-xl bg-unpaid-soft px-4 py-3 text-sm leading-6 text-unpaid">
            {message ?? "X sign-in failed."}
          </p>
        )}

        <CreatorHub profile={profile} identity={identity} xConfigured={!!cfg} />

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
    </>
  );
}
