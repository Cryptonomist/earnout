/* The one header and footer every page wears. Server components: the
 * mobile menu is a <details>, so it needs no JavaScript to open. */

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SITE } from "@/lib/site";
import { PROGRAM_ADDRESS } from "../../sdk/generated";

export const NAV = [
  { href: "/dashboard", label: "Campaigns" },
  { href: "/creators", label: "Creators" },
  { href: "/demo", label: "Demo" },
  { href: SITE.github, label: "GitHub" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Earnout home" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 text-sm md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-muted transition-colors hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted sm:inline">devnet</span>
          <a
            href={SITE.contact}
            className="hidden rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 sm:inline-block"
          >
            Run a pilot
          </a>
          <details className="group relative md:hidden">
            <summary
              aria-label="Menu"
              className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-line [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true" className="relative block h-3 w-4">
                <span className="absolute inset-x-0 top-0 h-[2px] bg-ink transition-transform group-open:translate-y-[5px] group-open:rotate-45" />
                <span className="absolute inset-x-0 top-[5px] h-[2px] bg-ink transition-opacity group-open:opacity-0" />
                <span className="absolute inset-x-0 top-[10px] h-[2px] bg-ink transition-transform group-open:-translate-y-[5px] group-open:-rotate-45" />
              </span>
            </summary>
            <nav
              aria-label="Main, mobile"
              className="absolute right-0 mt-3 w-56 rounded-2xl border border-line bg-card p-2 shadow-[0_16px_40px_rgba(22,21,15,0.14)]"
            >
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-xl px-3 py-2.5 text-sm hover:bg-paper">
                  {n.label}
                </Link>
              ))}
              <a href={SITE.contact} className="mt-1 block rounded-xl bg-ink px-3 py-2.5 text-center text-sm font-medium text-paper">
                Run a pilot
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/dashboard", label: "Campaigns" },
      { href: "/demo", label: "Live demo" },
      { href: "/#how", label: "How it works" },
      { href: "/#developers", label: "For developers" },
    ],
  },
  {
    title: "Creators",
    links: [
      { href: "/creators", label: "Link your X account" },
      { href: "/creators", label: "Verified creators" },
      { href: "/c/cryptonomist", label: "A creator page" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/brand", label: "Brand" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: SITE.contact, label: "Contact", external: true },
    ],
  },
  {
    title: "Open source",
    links: [
      { href: SITE.github, label: "GitHub", external: true },
      { href: `https://explorer.solana.com/address/${PROGRAM_ADDRESS}?cluster=devnet`, label: "Program on Solana", external: true },
      { href: "https://solana.com/docs/tools/actions", label: "Solana Actions spec", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted">
              Pay for users who stay. On-chain attribution and retention-gated payouts for Solana marketing.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="text-sm font-semibold">{col.title}</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} className="transition-colors hover:text-ink">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="transition-colors hover:text-ink">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Built on Solana. Running on devnet during the Colosseum Crypto World&apos;s Fair. © 2026 Earnout.</p>
          <p className="font-mono">program {PROGRAM_ADDRESS.slice(0, 4)}...{PROGRAM_ADDRESS.slice(-4)}</p>
        </div>
      </div>
    </footer>
  );
}
