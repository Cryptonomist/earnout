import "server-only";
import type { LiveReceipt } from "@/components/Receipt";
import { shortAddress } from "@/lib/explorer";
import { campaignList, campaignsWithReports, duration, money, slugsByChannel } from "./dashboard";

/* The receipt on the front page is a real one: the influencer with the
 * most users sent across the campaigns the dashboard lists, verified ones
 * first, read the same way the dashboard reads them. When nothing can be
 * read, the hero falls back to its printed example and says so. */
export async function heroReceipt(): Promise<LiveReceipt | null> {
  const [campaigns, slugs] = await Promise.all([campaignList({ limit: 12 }), slugsByChannel()]);
  let best: { score: number; value: LiveReceipt } | null = null;

  for (const { meta, chain, report } of await campaignsWithReports(campaigns)) {
    if (!report) continue;
    const d = chain.decimals;
    for (const ch of chain.channels) {
      const r = report.channels.find((c) => c.index === ch.index);
      if (!r || r.tagged === 0 || ch.conversions === 0n) continue;
      const score = r.tagged + (ch.handle ? 1_000 : 0);
      if (best && score <= best.score) continue;
      const notPaidUsers = r.gone + r.flagged + r.otherRejected;
      best = {
        score,
        value: {
          campaign: meta.name,
          influencer: ch.handle
            ? `@${ch.handle}`
            : (slugs.get(`${chain.address}:${ch.index}`) ?? `Influencer ${ch.index}`),
          mustStay: duration(chain.retentionSecs),
          sent: r.tagged,
          gone: r.gone,
          flagged: r.flagged + r.otherRejected,
          stayed: Number(ch.conversions),
          price: money(chain.payout, d),
          paid: money(ch.earned, d),
          notPaidUsers,
          notPaid: money(BigInt(notPaidUsers) * chain.payout, d),
          proof: ch.batches ? shortAddress(ch.evidence) : "pending",
          payouts: ch.batches,
          href: `/dashboard/${chain.address}`,
        },
      };
    }
  }
  return best?.value ?? null;
}
