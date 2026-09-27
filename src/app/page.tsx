import { Fragment } from "react";
import { Calculator } from "@/components/Calculator";
import { LiveNow } from "@/components/LiveNow";
import { SiteFooter, SiteHeader } from "@/components/SiteShell";
import { Receipt, type LiveReceipt } from "@/components/Receipt";
import { SITE, STATS } from "@/lib/site";
import { heroReceipt } from "@/server/hero";

/* The whole site speaks one small vocabulary: a project pays, an influencer
 * shares a link, a user joins through it, and if the user stays Earnout
 * pays the influencer. One scene, short sentences. The mechanism lives in the
 * developer section and the docs, not up here. */

/* Each step shows the real screen it happens on: crops of the live site,
 * captured at 2x (public/shots, made by the Playwright script in the
 * repo's history), so the page shows the product and not a description. */
/* The same four steps as FLOW, shown on the screens where they happen. */
const STEPS = [
  {
    title: "The deal, on the form",
    body: "The project types a price and a stay period, funds the budget, and the rules are locked on Solana in one transaction.",
    image: "/shots/step-1.png",
    alt: "The money step of the new campaign form: an influencer earns $5 per user who stays, fund now $100.",
  },
  {
    title: "The influencer's link",
    body: "Each influencer gets their own link, ready to copy from their page. Their X account proves it is theirs.",
    image: "/shots/step-2.png",
    alt: "An influencer page with their link, earnout.dev/r/hub-test-crypt0nomist, and a copy button.",
  },
  {
    title: "What the user sees",
    body: "Who sent them, and that the influencer is paid only if they stay. Nothing is hidden, and the tag can never break their deposit.",
    image: "/shots/step-3.png",
    alt: "The disclosure page a visitor sees: @CRYPT0NOMIST sent you here, paid only if you stay.",
  },
  {
    title: "The project's dashboard",
    body: "Users sent, users who stayed, what was paid, what came back. Every number is backed by a Solana transaction.",
    image: "/shots/step-4.png",
    alt: "A campaign dashboard: 13 users sent, 7 stayed and paid for.",
  },
];

const GUARANTEES = [
  "A payout is always users who stayed times your price. Never more than the budget.",
  "Nobody can be paid twice for the same user.",
  "No payouts after your deadline. No refunds before it.",
  "Money leaves two ways: to an influencer who earned it, or back to you.",
  "No admin key. No fee. Open source.",
];

/* The whole mechanism in one look, right under the headline: who does
 * what, in order, and the fork at the end that the rest of the page is
 * about. The roles are defined here and nowhere else. */
const FLOW: {
  who: string;
  head: string;
  text?: string;
  outcomes?: { paid: boolean; text: string }[];
  cta?: { href: string; label: string };
}[] = [
  {
    who: "Project",
    head: "Locks a budget",
    text: "An app on Solana that wants real users. It names a price, say $5 for each new user still active after 7 days, and the money sits in a Solana program.",
    cta: { href: "/dashboard/new", label: "Start a campaign" },
  },
  {
    who: "Influencer",
    head: "Shares their link",
    text: "In crypto, a KOL: anyone whose audience brings users. Every link says who is paid, and for what, before anyone continues.",
    cta: { href: "/influencers", label: "Link your X account" },
  },
  {
    who: "User",
    head: "Joins through the link",
    text: "A regular person, never paid, never named. Their first transaction carries the influencer's tag, so the chain knows who sent them.",
  },
  {
    who: "Earnout",
    head: "Checks 7 days later",
    outcomes: [
      { paid: true, text: "Still active: the influencer is paid $5, automatically." },
      { paid: false, text: "Left, or a bot: nothing is paid, and the money goes back to the project." },
    ],
  },
];

const PROBLEMS = [
  {
    title: "Influencers are paid per post.",
    body: "The biggest line in a crypto marketing budget, $500 to $50,000 a post, paid up front. The deal is done the moment the post goes up.",
  },
  {
    title: "Nobody can prove who stayed.",
    body: "Audiences can be bought and engagement faked. A million impressions can mean zero users. Off-chain tracking dies at the wallet.",
  },
  {
    title: "Rewards pay the leavers.",
    body: "Airdrops and quests pay on claim day. Most recipients sell at once, and few keep using the product.",
  },
];

/* By category, not by name: what each way of paying for growth actually
 * buys, who measures it, who holds the money, and whether the user is told. */
const COMPARE: { who: string; pays: string; measured: string; money: string; told: string; earnout?: true }[] = [
  { who: "Influencer deals and agencies", pays: "A post", measured: "Nobody", money: "The influencer, up front", told: "Rarely" },
  { who: "Quest platforms", pays: "Tasks, on claim day", measured: "The platform", money: "The platform", told: "No" },
  { who: "Creator marketplaces", pays: "Posts, clicks, sign-ups, mindshare", measured: "The platform's own data", money: "The platform", told: "Sometimes" },
  { who: "Attribution dashboards", pays: "Nothing; they only measure", measured: "Pixels and on-chain data", money: "You", told: "No" },
  {
    who: "Earnout",
    pays: "Users who stayed",
    measured: "The user's own Solana transaction, then a stay check",
    money: "A Solana program that only pays results or refunds you",
    told: "Every link",
    earnout: true,
  },
];

export const revalidate = 60;

export default async function Home() {
  // The receipt in the hero is a real one when devnet can be read.
  const live = await heroReceipt().catch(() => null);
  return (
    <>
      <SiteHeader />
      <main id="content">
        <Hero live={live} />
        <Flow />
        <LiveNow />
        <Stats />
        <Problem />
        <HowItWorks />
        <Compare />
        <Numbers />
        <Trust />
        <Developers />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}

// ── sections ─────────────────────────────────────────────────────────────────

function Hero({ live }: { live: LiveReceipt | null }) {
  return (
    <section id="top" className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-14 sm:px-6 md:pt-20 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="rise font-mono text-xs tracking-[0.2em] text-muted">RESULTS-DRIVEN INFLUENCER MARKETING ON SOLANA</p>
        <h1 className="rise rise-2 mt-5 text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
          Pay influencers for users <span className="font-serif font-normal italic">who stay.</span>
        </h1>
        <p className="rise rise-3 mt-6 max-w-xl text-lg leading-8 text-muted">
          Think of it as a sales commission. Influencers are paid only for the users they bring who are still active a week
          later. Nothing for clicks. Nothing for people who leave.
        </p>
        <div className="rise rise-4 mt-9 flex flex-wrap gap-3">
          <a href="/r/demo-alice" className="rounded-full bg-ink px-6 py-3 font-medium text-paper transition-opacity hover:opacity-90">
            Try the demo
          </a>
          <a href="/dashboard/new" className="rounded-full border border-line px-6 py-3 font-medium transition-colors hover:border-ink">
            Start a campaign
          </a>
        </div>
        <p className="rise rise-4 mt-4 text-sm text-muted">
          {live ? "This receipt is live on Solana devnet. Three clicks to make your own, no wallet needed." : "Live on Solana devnet. Three clicks, no wallet needed."}
        </p>
      </div>
      <div className="rise rise-3 lift">
        <Receipt live={live} />
      </div>
    </section>
  );
}

/* Four boxes, three arrows, one fork: the premise without reading. */
function Flow() {
  return (
    <section aria-label="How it works, in one look" className="reveal mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <p className="mb-4 font-mono text-xs tracking-[0.2em] text-muted uppercase">In one look</p>
      <ol className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:gap-0">
        {FLOW.map((n, i) => (
          <Fragment key={n.who}>
            <li className="flex flex-col rounded-2xl border border-line bg-card p-5">
              <div className="flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-muted uppercase">
                <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[10px] text-paper">{i + 1}</span>
                {n.who}
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">{n.head}</h2>
              {n.text && <p className="mt-2 text-sm leading-6 text-muted">{n.text}</p>}
              {n.outcomes && (
                <ul className="mt-3 space-y-2 text-sm leading-6">
                  {n.outcomes.map((o) => (
                    <li key={o.text} className={`flex gap-2 ${o.paid ? "text-paid" : "text-unpaid"}`}>
                      <span className="font-mono" aria-hidden="true">
                        {o.paid ? "✓" : "✗"}
                      </span>
                      <span>{o.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {n.cta && (
                <a href={n.cta.href} className="mt-4 inline-block self-start rounded-full border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper">
                  {n.cta.label}
                </a>
              )}
            </li>
            {i < FLOW.length - 1 && (
              <li aria-hidden="true" className="flex items-center justify-center py-1 text-muted md:px-2 md:py-0">
                <svg viewBox="0 0 24 24" className="size-5 rotate-90 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </li>
            )}
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

function Stats() {
  return (
    <section aria-label="Why now" className="reveal border-y border-line bg-card">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-2 px-4 sm:px-6 lg:grid-cols-4 lg:gap-px">
        {STATS.map((s) => (
          <figure key={s.figure} className="py-6 sm:py-8 lg:px-5 lg:first:pl-0">
            <div className="font-serif text-3xl tracking-tight sm:text-4xl">{s.figure}</div>
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
    <Section eyebrow="The problem" title="Marketing today pays for quantity. Earnout pays for quality.">
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
    <Section id="how" eyebrow="In the product" title="The same four steps, on screen.">
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-xl border border-line bg-card p-6">
            <div className="font-mono text-sm text-muted">{String(i + 1).padStart(2, "0")}</div>
            <h3 className="mt-6 text-lg font-semibold tracking-tight">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-7 text-muted">{s.body}</p>
            {/* A crop of the live screen this step happens on. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.image}
              alt={s.alt}
              loading="lazy"
              className="mt-5 h-40 w-full rounded-lg border border-line object-cover object-left-top shadow-[0_8px_24px_rgba(22,21,15,0.08)]"
            />
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Compare() {
  const cols: [string, "pays" | "measured" | "money" | "told"][] = [
    ["You pay for", "pays"],
    ["Measured by", "measured"],
    ["Who holds the money", "money"],
    ["Is the user told?", "told"],
  ];
  return (
    <Section band eyebrow="How it compares" title="Quantity is clicks, posts and sign‑ups. Quality is a user who is still there.">
      {/* On a phone the table would scroll sideways and hide its point, so each row becomes a card. */}
      <div className="space-y-3 md:hidden">
        {COMPARE.map((r) => (
          <div key={r.who} className={`rounded-2xl border p-5 ${r.earnout ? "border-paid bg-paid-soft" : "border-line"}`}>
            <div className="font-semibold">{r.who}</div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm leading-6">
              {cols.map(([label, key]) => (
                <Fragment key={key}>
                  <dt className="text-muted">{label}</dt>
                  <dd className={r.earnout ? "font-medium" : ""}>{r[key]}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
        <table className="w-full min-w-[760px] text-left text-[15px]">
          <thead className="border-b border-line bg-card text-sm text-muted">
            <tr>
              <th className="px-4 py-3 font-medium" />
              {cols.map(([label]) => (
                <th key={label} className="px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((r) => (
              <tr key={r.who} className={`border-b border-line last:border-0 ${r.earnout ? "bg-paid-soft font-medium" : ""}`}>
                <td className="px-4 py-3 font-semibold">{r.who}</td>
                {cols.map(([, key]) => (
                  <td key={key} className={`px-4 py-3 leading-6 ${r.earnout ? "" : "text-muted"}`}>
                    {r[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted">
        Categories, not names. Mobile apps have paid per retained user for a decade; crypto could not, because the proof lived
        off-chain. On Solana the proof is the user&apos;s own transaction.
      </p>
    </Section>
  );
}

function Numbers() {
  return (
    <Section eyebrow="Run your numbers" title="What changes when you pay for who stayed.">
      <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
        <Calculator />
      </div>
    </Section>
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
            <strong className="font-semibold text-ink">Private by design.</strong> The chain shows that a user joined, not
            which influencer sent them. Only the project can see that.
          </p>
          <p>
            <strong className="font-semibold text-ink">Honest about trust.</strong> Earnout does the counting. The program
            holds it to your budget and your deadline, and every payout comes with evidence anyone can check.
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
import {
  captureTag, pendingTag, tagInstructions, clearTag,
} from "./earnout/sdk";

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
    <Section id="developers" eyebrow="For developers" title="Two instructions on a transaction you already send.">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div className="space-y-5 leading-7 text-muted">
          <p>
            Earnout follows the Solana Actions spec, so any Actions indexer can read its tags. The SDK is checked against
            the official <code className="font-mono text-sm text-ink">@solana/actions</code> package both ways.
          </p>
          <p>The tag reads nothing and writes nothing. It can never break a user&apos;s transaction.</p>
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
    <section className="reveal mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="rounded-3xl bg-ink px-6 py-16 text-center text-paper sm:px-12">
        <h2 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Run your next campaign <span className="font-serif font-normal italic">on results.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-8 opacity-75">
          Create one on devnet in minutes, with test dollars. Or talk to us about mainnet.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <a href="/dashboard/new" className="rounded-full bg-paper px-6 py-3 font-medium text-ink hover:opacity-90">
            Start a campaign
          </a>
          <a href={SITE.contact} className="rounded-full border border-paper/30 px-6 py-3 font-medium hover:border-paper">
            Talk to us
          </a>
        </div>
      </div>
    </section>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function Section({
  id,
  eyebrow,
  title,
  band,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  /** On the opposite paper (ink in the light theme), for the one section that should stop the scroll. */
  band?: boolean;
  children: React.ReactNode;
}) {
  const section = (
    <section id={id} className="reveal mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-24">
      <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">{eyebrow}</p>
      <h2 className="mt-4 mb-12 max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {children}
    </section>
  );
  return band ? <div className="band-ink my-8">{section}</div> : section;
}
