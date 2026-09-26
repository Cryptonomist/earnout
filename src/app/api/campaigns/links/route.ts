import "server-only";
import { registerLink } from "@/server/campaign-registry";
import { liveRegistryDeps } from "@/server/registry-write";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "no-store" };

/* A new channel asks for its link: the browser sends the signature of the
 * advertiser's transaction whose memo names the campaign, the channel and
 * the slug. The checks are in server/campaign-registry. */
export async function POST(request: Request) {
  const live = await liveRegistryDeps();
  if (!live.deps) return Response.json({ error: live.reason }, { status: 503, headers: NO_STORE });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Not JSON: the checks refuse an empty body.
  }
  try {
    const r = await registerLink(body, live.deps);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return Response.json({ ok: true, created: r.created, slug: r.value.slug }, { status: r.created ? 201 : 200, headers: NO_STORE });
  } catch (e) {
    console.error(`[campaigns/links] ${(e as Error).message}`);
    return Response.json({ error: "Devnet or the database did not answer. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
}
