import type { Metadata } from "next";
import { SiteHeader } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";

export const metadata: Metadata = { title: "Terms", description: "The terms for using Earnout while it runs on devnet." };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-3xl px-4 py-14 leading-7 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Terms</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Terms of use</h1>
        <p className="mt-4 text-muted">Last updated 26 September 2026.</p>

        <Section title="A devnet build">
          Earnout currently runs on Solana devnet, a test network. Tokens and SOL on devnet have no value, and campaigns,
          payouts and links here are demonstrations. Do not send anything of value to any address this site shows.
        </Section>

        <Section title="No warranty">
          The software is provided as it is, without warranty of any kind. The program and the checker may have bugs, and the
          service may change, pause or stop.
        </Section>

        <Section title="The guest wallet">
          The demo can make a guest wallet whose key is kept in your browser. It is for trying the demo on devnet only.
          Anyone with access to your browser can use it, and it is lost if you clear your browser&apos;s data.
        </Section>

        <Section title="KOLs and projects">
          A KOL is paid only for users Earnout counts under a campaign&apos;s published rules; users who
          leave before the stay period ends, or look like a bot farm, are not paid for. Paid partnerships made
          through Earnout are disclosed as such, and KOLs remain responsible for following the disclosure rules where
          they post.
        </Section>

        <Section title="Open source">
          The code is MIT-licensed at{" "}
          <a href="https://github.com/Cryptonomist/earnout" className="underline underline-offset-4">
            github.com/Cryptonomist/earnout
          </a>
          .
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
