import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteShell";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Not found</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          No receipt <span className="font-serif font-normal italic">for that.</span>
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-muted">
          That page, link or KOL does not exist here. If you followed a KOL&apos;s link, it may have been retired.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="rounded-full bg-ink px-5 py-2.5 font-medium text-paper hover:opacity-90">
            Home
          </Link>
          <Link href="/dashboard" className="rounded-full border border-line px-5 py-2.5 font-medium hover:border-ink">
            Campaigns
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
