import Link from "next/link";
import { campaignChain, campaignList, campaignReport, money } from "@/server/dashboard";

/* One line of proof under the hero: what Earnout has done on devnet, read
 * live from the chain and the settler's report. Every figure is a real
 * count; if nothing can be read, the line is simply absent. */
export async function LiveNow() {
  // The pilots and the newest dozen from the hub: a bounded number of reads.
  const campaigns = await campaignList({ limit: 12 });
  let tagged = 0;
  let paidFor = 0;
  let notPaid = 0;
  let paidOut = 0n;
  let decimals: number | null = null;
  const creators = new Set<string>();
  let first: string | null = null;

  for (const meta of campaigns) {
    const [chain, report] = await Promise.all([campaignChain(meta.address).catch(() => null), campaignReport(meta.address)]);
    if (!chain) continue;
    first ??= chain.address;
    decimals ??= chain.decimals;
    for (const ch of chain.channels) {
      paidFor += Number(ch.conversions);
      if (chain.decimals === decimals) paidOut += ch.earned;
      if (ch.xId !== null) creators.add(String(ch.xId));
    }
    for (const c of report?.channels ?? []) {
      tagged += c.tagged;
      notPaid += c.gone + c.flagged + c.otherRejected;
    }
  }
  if (!first || decimals === null) return null;

  const items: { text: string; tone?: "paid" | "unpaid" }[] = [
    { text: `${tagged} user${tagged === 1 ? "" : "s"} sent` },
    { text: `${paidFor} paid for`, tone: "paid" },
    { text: `${notPaid} not paid`, tone: "unpaid" },
    { text: `${money(paidOut, decimals)} paid out` },
    { text: `${creators.size} verified creator${creators.size === 1 ? "" : "s"}` },
  ];

  return (
    <div className="reveal mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-card px-5 py-3 font-mono text-[13px]">
        <span className="flex items-center gap-2">
          <span className="live-dot size-2 rounded-full bg-paid" aria-hidden="true" />
          Live on devnet
        </span>
        {items.map((i) => (
          <span key={i.text} className={i.tone === "paid" ? "text-paid" : i.tone === "unpaid" ? "text-unpaid" : ""}>
            {i.text}
          </span>
        ))}
        <Link href={`/dashboard/${first}`} className="ml-auto underline decoration-line underline-offset-4 hover:decoration-ink">
          Open the campaign
        </Link>
      </div>
    </div>
  );
}
