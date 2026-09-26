import { Calculator } from "@/components/Calculator";
import { Logo, Mark } from "@/components/Logo";
import { Receipt } from "@/components/Receipt";
import { SITE, STATS } from "@/lib/site";

const STEPS = [
  {
    title: "Fund a campaign",
    body: "Set a price per user, a retention window and an end date. The budget sits in an on-chain vault that only the program can move.",
  },
  {
    title: "Hand out links",
    body: "Every creator, newsletter or partner app gets its own. Each click mints a single-use reference signed by your campaign.",
  },
  {
    title: "Tag the conversion",
    body: "The user's deposit, swap or mint carries that reference: a standard Solana Actions memo, plus a tag that can never make the transaction fail.",
  },
  {
    title: "Pay for who stayed",
    body: "When the window closes, wallets still active and not part of a bot cluster are settled on-chain. Channels claim. The rest comes back to you.",
  },
];

const GUARANTEES = [
  "A settlement pays exactly conversions times your price, never more than the budget left.",
  "Batches are numbered, so the same conversions cannot be paid twice.",
  "Nothing settles after your deadline. Nothing refunds before it.",
  "Money leaves the vault two ways: to a channel that earned it, or back to you.",
  "No admin key, no protocol fee, no sweep.",
];

const PROBLEMS = [
  {
    title: "Tracking dies at the wallet.",
    body: "Link tracking breaks the moment a user connects a wallet or jumps to a mobile app, and the deposit itself happens in a DEX or a wallet, not on your site.",
  },
  {
    title: "Rewards pay the people who leave.",
    body: "Airdrops and points pay out when someone claims, not when they stay. Farmers claim, sell and move on to the next one.",
  },
  {
    title: "Creators get paid per post.",
    body: "Flat fees, rarely disclosed, with no way to see whose audience actually converted, or whether any of it stuck.",
  },
];

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Stats />
        <Problem />
        <HowItWorks />
        <Numbers />
        <Sides />
        <Trust />
        <Developers />
        <Closing />
      </main>
      <Footer />
    </>
  );
}

// ── sections ─────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" aria-label="Earnout home">
          <Logo />
        </a>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="hidden text-muted hover:text-ink md:inline">
            How it works
          </a>
          <a href="#creators" className="hidden text-muted hover:text-ink md:inline">
            For creators
          </a>
          <a href="#developers" className="hidden text-muted hover:text-ink md:inline">
            Developers
          </a>
          <a href="/dashboard" className="hidden text-muted hover:text-ink sm:inline">
            Dashboard
          </a>
          <a href={SITE.github} className="hidden text-muted hover:text-ink sm:inline">
            GitHub
          </a>
          <a href={SITE.contact} className="rounded-full bg-ink px-4 py-2 font-medium text-paper hover:opacity-90">
            Run a pilot
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 md:pt-24 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="font-mono text-xs tracking-[0.2em] text-muted">ON-CHAIN ATTRIBUTION FOR SOLANA</p>
        <h1 className="mt-5 text-5xl leading-[1.02] font-semibold tracking-tight sm:text-6xl lg:text-7xl">
          Pay for users <span className="font-serif font-normal italic">who stay.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
          Give every creator, newsletter and partner app its own link. Earnout tags the transactions they bring, waits out
          your retention window, and pays only for wallets that are still there. Whatever nobody earned comes back to you.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a href={SITE.contact} className="rounded-full bg-ink px-6 py-3 font-medium text-paper hover:opacity-90">
            Run a pilot
          </a>
          <a href="#how" className="rounded-full border border-line px-6 py-3 font-medium hover:border-ink">
            See how it works
          </a>
        </div>
      </div>
      <Receipt />
    </section>
  );
}

function Stats() {
  return (
    <section aria-label="Why now" className="border-y border-line bg-card">
      <div className="mx-auto grid max-w-6xl gap-px px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {STATS.map((s) => (
          <figure key={s.figure} className="py-8 sm:px-5 lg:first:pl-0">
            <div className="font-serif text-4xl tracking-tight">{s.figure}</div>
            <p className="mt-2 text-sm leading-6">{s.text}</p>
            <figcaption className="mt-2 text-xs text-muted">
              <a href={s.href} className="underline decoration-line underline-offset-2 hover:decoration-ink">
                {s.source}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Problem() {
  return (
    <Section eyebrow="The problem" title="Crypto marketing pays for attention. Nobody can prove it paid for users.">
      <div className="grid gap-8 md:grid-cols-3">
        {PROBLEMS.map((p) => (
          <div key={p.title} className="border-t border-ink pt-5">
            <h3 className="text-lg font-semibold tracking-tight">{p.title}</h3>
            <p className="mt-2 leading-7 text-muted">{p.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section id="how" eyebrow="How it works" title="A budget that only pays for results you can check.">
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-line bg-card p-6">
            <div className="font-mono text-sm text-muted">{String(i + 1).padStart(2, "0")}</div>
            <h3 className="mt-6 text-lg font-semibold tracking-tight">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-7 text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Numbers() {
  return (
    <Section eyebrow="Run your numbers" title="What a retention window is worth.">
      <div className="rounded-2xl border border-line p-6 sm:p-8">
        <Calculator />
      </div>
    </Section>
  );
}

function Sides() {
  return (
    <Section id="creators" eyebrow="Both sides of the deal" title="Fair to the people paying and the people sending.">
      <div className="grid gap-4 md:grid-cols-2">
        <Side
          who="For projects"
          points={[
            "See which channel worked, per wallet, not per click.",
            "Pay per user who stayed, at a price you set.",
            "Unspent budget comes back after the deadline, automatically.",
            "Every paid conversion comes with evidence you can check on-chain.",
          ]}
        />
        <Side
          who="For creators and partners"
          points={[
            "Get paid on results from a vault that is already funded.",
            "No invoices and no chasing: claim straight from the program.",
            "Your audience stays private. The chain cannot link wallets to you.",
            "Move your payout wallet whenever you like, earnings included.",
          ]}
        />
      </div>
    </Section>
  );
}

function Side({ who, points }: { who: string; points: string[] }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-7">
      <h3 className="text-xl font-semibold tracking-tight">{who}</h3>
      <ul className="mt-5 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex gap-3 leading-7">
            <Mark className="mt-1 size-4 shrink-0" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Trust() {
  return (
    <Section eyebrow="Enforced on-chain" title="The program keeps the promises, not us.">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <ul className="divide-y divide-line border-y border-line">
          {GUARANTEES.map((g) => (
            <li key={g} className="flex gap-4 py-4 leading-7">
              <span className="font-mono text-paid" aria-hidden="true">
                ✓
              </span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-6 leading-7 text-muted">
          <p>
            <strong className="font-semibold text-ink">Sealed channels.</strong> Each link&apos;s reference is encrypted, and
            only your campaign can open it. The chain shows that a wallet converted, never who sent it. Under EU guidance
            wallet addresses can be personal data, so Earnout never publishes that link.
          </p>
          <p>
            <strong className="font-semibold text-ink">Honest about trust.</strong> A settler decides which wallets
            qualified. The program holds it to your budget and your deadline, and every batch ships with evidence you can
            check against the chain, so overcounting gets caught.
          </p>
          <p>
            <a href={SITE.github} className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
              Read the program on GitHub
            </a>
            . Open source, MIT.
          </p>
        </div>
      </div>
    </Section>
  );
}

const SNIPPET = `// sdk/ in github.com/Cryptonomist/earnout
import { captureTag, pendingTag, tagInstructions, clearTag } from "./earnout/sdk";

captureTag(); // on page load: keeps ?eo= and cleans the URL

// when the user deposits
const tag = pendingTag();
const instructions = [
  ...yourDepositInstructions,
  ...(tag ? tagInstructions(tag) : []),
];
// ...send, confirm, then
clearTag();`;

function Developers() {
  return (
    <Section id="developers" eyebrow="For developers" title="Two instructions on the transaction you already send.">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div className="space-y-5 leading-7 text-muted">
          <p>
            Earnout follows the Solana Actions spec for Action Identity, so any Actions indexer can read its tags. Our SDK is
            checked against the official <code className="font-mono text-sm text-ink">@solana/actions</code> package in
            both directions.
          </p>
          <p>
            The tag reads nothing and writes nothing. A stale link, a closed campaign or a typo can never break your user&apos;s
            transaction.
          </p>
        </div>
        {/* Code stays dark in both themes, like an editor. */}
        <pre className="overflow-x-auto rounded-2xl border border-line bg-[#16150f] p-6 font-mono text-[13px] leading-6 text-[#edebe3]">
          <code>{SNIPPET}</code>
        </pre>
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="rounded-3xl bg-ink px-6 py-16 text-center text-paper sm:px-12">
        <h2 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Run your next campaign <span className="font-serif font-normal italic">on results.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-8 opacity-75">
          We are onboarding a small number of Solana projects and creators for the first pilots.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <a href={SITE.contact} className="rounded-full bg-paper px-6 py-3 font-medium text-ink hover:opacity-90">
            Run a pilot
          </a>
          <a href={SITE.github} className="rounded-full border border-paper/30 px-6 py-3 font-medium hover:border-paper">
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <p>Built on Solana. © 2026 Earnout.</p>
      </div>
    </footer>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 md:py-24">
      <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">{eyebrow}</p>
      <h2 className="mt-4 mb-12 max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {children}
    </section>
  );
}
