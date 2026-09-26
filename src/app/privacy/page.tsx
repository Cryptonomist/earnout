import type { Metadata } from "next";
import { SiteHeader } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";

export const metadata: Metadata = { title: "Privacy", description: "What Earnout keeps, where, and why." };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-3xl px-4 py-14 leading-7 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Privacy</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">What Earnout keeps</h1>
        <p className="mt-4 text-muted">Last updated 26 September 2026. Earnout runs on Solana devnet during its hackathon build.</p>

        <Section title="On Solana, which is public">
          A tagged transaction shows that a wallet joined a campaign. It does not show which creator sent it: the
          reference is encrypted, and only the campaign can read it. Payouts show how many users each creator was
          paid for, and payouts show which wallet received them.
        </Section>

        <Section title="On our servers">
          Earnout keeps a private ledger of which wallet came through which creator and whether it stayed. It never
          publishes that; the dashboard shows counts only. The project may be given the list behind a payout so they
          can check it against the chain. We keep no accounts, names or emails for people who join.
        </Section>

        <Section title="In your browser">
          An Earnout link leaves a tag in this browser&apos;s local storage for up to seven days, so a partner app can add it
          to your transaction. On the demo, a guest wallet keeps a devnet-only key in local storage too. Clearing your
          browser&apos;s site data removes both.
        </Section>

        <Section title="Signing in with X">
          A creator who links an X account lets us read their public profile (id, handle, picture) once, to write
          &quot;this wallet belongs to this X account&quot; on chain. We ask for no permission to post, read messages or act
          for them later, and keep no X token.
        </Section>

        <Section title="What we do not do">
          No advertising trackers, no selling data, no analytics that follow you across sites.
        </Section>

        <Section title="Contact">
          <a href="mailto:hello@earnout.dev" className="underline underline-offset-4">
            hello@earnout.dev
          </a>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}
