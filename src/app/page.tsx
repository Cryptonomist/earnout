import { Calculator } from "@/components/Calculator";
import { LiveNow } from "@/components/LiveNow";
import { Mark } from "@/components/Logo";
import { SiteFooter, SiteHeader } from "@/components/SiteShell";
import { Receipt } from "@/components/Receipt";
import { SITE, STATS } from "@/lib/site";

/* The whole site speaks one small vocabulary: a project pays, a KOL
 * shares a link, a user joins through it, and if the user stays Earnout
 * pays the KOL. One scene, short sentences. The mechanism lives in the
 * developer section and the docs, not up here. */

const STEPS = [
  {
    title: "Set the deal",
    body: "Say a KOL earns $5 for each new user still active after 7 days. Lock the budget in a Solana program.",
  },
  {
    title: "Give each KOL a link",
    body: "Every link tells the visitor who is paid, and for what, before they continue.",
  },
  {
    title: "The user's first deposit carries the tag",
    body: "That is how Earnout knows which KOL sent them. The tag can never break the deposit.",
  },
  {
    title: "Pay only for who stayed",
    body: "After 7 days, Earnout checks who is still active and pays their KOLs on-chain. Unspent budget comes back to you.",
  },
];

const GUARANTEES = [
  "A payout is always users who stayed times your price. Never more than the budget.",
  "Nobody can be paid twice for the same user.",
  "No payouts after your deadline. No refunds before it.",
  "Money leaves two ways: to a KOL who earned it, or back to you.",
  "No admin key. No fee. Open source.",
];

const ROLES = [
  {
    who: "Project",
    text: "An app on Solana that wants more real users: a game, a DEX, a wallet. It sets the deal and locks the budget.",
  },
  {
    who: "KOL",
    text: "A key opinion leader, crypto's word for an influencer: a trader with a following, a newsletter writer, a community lead. They share their link and get paid for the users who stay.",
  },
  {
    who: "User",
    text: "A person who clicks the link and joins the project's app. Counted, never paid, never named.",
  },
];

const PROBLEMS = [
  {
    title: "KOLs are paid per post.",
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
  { who: "KOL deals and agencies", pays: "A post", measured: "Nobody", money: "The KOL, up front", told: "Rarely" },
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

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="content">
        <Hero />
        <WhoIsWho />
        <LiveNow />
        <Stats />
        <Problem />
        <HowItWorks />
        <Compare />
        <Numbers />
        <Sides />
        <Trust />
        <Developers />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}

// ── sections ─────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section id="top" className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 md:pt-24 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="rise font-mono text-xs tracking-[0.2em] text-muted">RESULTS-DRIVEN KOL MARKETING ON SOLANA</p>
        <h1 className="rise rise-2 mt-5 text-5xl leading-[1.02] font-semibold tracking-tight sm:text-6xl lg:text-7xl">
          Pay KOLs for users <span className="font-serif font-normal italic">who stay.</span>
        </h1>
        <p className="rise rise-3 mt-6 max-w-xl text-lg leading-8 text-muted">
          Think of it as a sales commission. A KOL shares a link to your project. When someone comes through it and is
          still active a week later, the KOL gets paid. Nothing for clicks. Nothing for people who leave.
        </p>
        <div className="rise rise-4 mt-9 flex flex-wrap gap-3">
          <a href="/r/demo-alice" className="rounded-full bg-ink px-6 py-3 font-medium text-paper transition-opacity hover:opacity-90">
            Try the demo
          </a>
          <a href="/dashboard/new" className="rounded-full border border-line px-6 py-3 font-medium transition-colors hover:border-ink">
            Start a campaign
          </a>
        </div>
        <p className="rise rise-4 mt-4 text-sm text-muted">Live on Solana devnet. Three clicks, no wallet needed.</p>
      </div>
      <div className="rise rise-3 lift">
        <Receipt />
      </div>
    </section>
  );
}

/* The three people in every sentence on this site, named once. */
function WhoIsWho() {
  return (
    <section aria-label="Who is who" className="reveal mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <div className="grid gap-6 rounded-2xl border border-line bg-card p-6 sm:grid-cols-3 sm:p-8">
        {ROLES.map((r) => (
          <div key={r.who}>
            <div className="font-mono text-xs tracking-[0.2em] text-muted uppercase">{r.who}</div>
            <p className="mt-2 text-[15px] leading-7">{r.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section aria-label="Why now" className="reveal border-y border-line bg-card">
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
    <Section id="how" eyebrow="How it works" title="Four steps. One rule: no stay, no pay.">
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

function Compare() {
  const cols: [string, "pays" | "measured" | "money" | "told"][] = [
    ["You pay for", "pays"],
    ["Measured by", "measured"],
    ["Who holds the money", "money"],
    ["Is the user told?", "told"],
  ];
  return (
    <Section eyebrow="How it compares" title="Quantity is clicks, posts and sign-ups. Quality is a user who is still there.">
      <div className="overflow-x-auto rounded-2xl border border-line">
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
      <div className="rounded-2xl border border-line p-6 sm:p-8">
        <Calculator />
      </div>
    </Section>
  );
}

function Sides() {
  return (
    <Section id="kols" eyebrow="Both sides of the deal" title="Fair to the ones paying and the ones sending.">
      <div className="grid gap-4 md:grid-cols-2">
        <Side
          who="For projects"
          points={[
            "See which KOL brought each user.",
            "Pay per user who stayed, at your price.",
            "Unspent budget comes back on its own.",
            "Every payout has proof on-chain.",
          ]}
          cta={{ href: "/dashboard/new", label: "Start a campaign" }}
        />
        <Side
          who="For KOLs"
          points={[
            "Get paid from a budget that is already locked.",
            "No invoices. Claim straight from the program.",
            "Your audience stays private.",
            "Your X account is your record. It follows you, wallet to wallet.",
          ]}
          cta={{ href: "/creators", label: "Link your X account" }}
        />
      </div>
    </Section>
  );
}

function Side({ who, points, cta }: { who: string; points: string[]; cta?: { href: string; label: string } }) {
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
      {cta && (
        <a href={cta.href} className="mt-6 inline-block rounded-full border border-ink px-5 py-2.5 font-medium hover:bg-ink hover:text-paper">
          {cta.label}
        </a>
      )}
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
            <strong className="font-semibold text-ink">Private by design.</strong> The chain shows that a user joined, not
            which KOL sent them. Only the project can see that.
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
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="reveal mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 md:py-24">
      <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">{eyebrow}</p>
      <h2 className="mt-4 mb-12 max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {children}
    </section>
  );
}
