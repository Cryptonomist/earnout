import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { DemoTag } from "@/components/DemoTag";
import { registry } from "@/server/registry";

export const metadata: Metadata = {
  title: "Demo partner",
  description: "What a partner app sees when a visitor arrives through an Earnout link.",
  robots: { index: false },
};

export default function DemoPage() {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Earnout home">
            <Logo />
          </Link>
          <span className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted">devnet demo</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Demo partner app</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          This page plays <span className="font-serif font-normal italic">the partner.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          Think of it as a DeFi app running an Earnout campaign. Arrive through a creator&apos;s link and this is what the
          app keeps, and what it will add to your deposit.
        </p>
        {/* Every registered link that lands here, so a new creator's shows up too. */}
        <DemoTag
          slugs={Object.entries(registry())
            .filter(([, e]) => e.destination === "/demo")
            .map(([slug]) => slug)}
        />
      </main>
    </>
  );
}
