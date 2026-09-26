import "server-only";
import { buildScorecards, findScorecard, type ChannelFacts, type Scorecard } from "@/lib/scorecard";
import { campaignChain, campaignList, campaignReport, slugsByChannel } from "./dashboard";

/* The facts behind every verified channel the dashboard knows, read the
 * same way the dashboard reads them: money from the chain, counts from the
 * settler's published report. Channels made before verification have no
 * identity and do not appear on anyone's record. */
export async function channelFacts(): Promise<ChannelFacts[]> {
  const slugs = slugsByChannel();
  const facts: ChannelFacts[] = [];
  for (const meta of campaignList()) {
    const [chain, report] = await Promise.all([campaignChain(meta.address).catch(() => null), campaignReport(meta.address)]);
    if (!chain) continue;
    for (const ch of chain.channels) {
      if (!ch.handle || ch.xId === null) continue;
      const r = report?.channels.find((c) => c.index === ch.index) ?? null;
      facts.push({
        campaign: chain.address,
        campaignName: meta.name,
        slug: slugs.get(`${chain.address}:${ch.index}`) ?? null,
        index: ch.index,
        xId: String(ch.xId),
        handle: ch.handle,
        payee: ch.payee,
        decimals: chain.decimals,
        payout: chain.payout,
        stayed: ch.conversions,
        earned: ch.earned,
        claimed: ch.claimed,
        reported: !!r,
        tagged: r?.tagged ?? 0,
        waiting: r?.waiting ?? 0,
        qualified: r?.qualified ?? 0,
        gone: r?.gone ?? 0,
        flagged: r?.flagged ?? 0,
        otherRejected: r?.otherRejected ?? 0,
      });
    }
  }
  return facts;
}

export async function scorecards(): Promise<Scorecard[]> {
  return buildScorecards(await channelFacts());
}

export async function scorecard(key: string): Promise<Scorecard | null> {
  return findScorecard(await scorecards(), key);
}
