import "server-only";
import { isAddress } from "@solana/kit";
import { campaignChain, campaignList, money, slugsByChannel } from "@/server/dashboard";

export const dynamic = "force-dynamic";

/* The channels a wallet is paid for, across every campaign the dashboard
 * lists. Public information: it is on chain, and the dashboard shows it. */
export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isAddress(wallet)) return Response.json({ error: "Not a wallet" }, { status: 400 });

  const slugs = slugsByChannel();
  const rows: unknown[] = [];
  for (const meta of campaignList()) {
    const chain = await campaignChain(meta.address).catch(() => null);
    if (!chain) continue;
    for (const ch of chain.channels) {
      if (ch.payee !== wallet) continue;
      rows.push({
        slug: slugs.get(`${chain.address}:${ch.index}`) ?? null,
        campaign: chain.address,
        campaignName: meta.name,
        handle: ch.handle,
        earned: money(ch.earned, chain.decimals),
        claimed: money(ch.claimed, chain.decimals),
        claimable: money(ch.earned - ch.claimed, chain.decimals),
      });
    }
  }
  return Response.json({ channels: rows }, { headers: { "cache-control": "no-store" } });
}
