import "server-only";
import { campaignEndsAt } from "@/server/chain";
import { loadSecrets, resolveLink, type Secrets } from "@/server/links";
import { registry } from "@/server/registry";

/* The redirect behind a link, reached from the disclosure page's Continue
 * button. Every click must mint its own reference, so nothing here is
 * cached: not by Next, not by a CDN, not by the browser. */
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

let secrets: Promise<Secrets | null> | null = null;
function getSecrets(): Promise<Secrets | null> {
  secrets ??= loadSecrets().catch((e) => {
    console.error(`[links] untagged redirects until fixed: ${(e as Error).message}`);
    return null;
  });
  return secrets;
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const result = await resolveLink(slug, {
    registry: await registry(),
    secrets: await getSecrets(),
    origin: new URL(request.url).origin,
    now: Math.floor(Date.now() / 1000),
    campaignEndsAt,
  });

  if (result.status === 404) {
    return new Response("This Earnout link is not active.", { status: 404, headers: HEADERS });
  }
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: result.location } });
}
