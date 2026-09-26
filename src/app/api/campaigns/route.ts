import "server-only";
import { registerCampaign } from "@/server/campaign-registry";
import { liveRegistryDeps } from "@/server/registry-write";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "no-store" };

/* A campaign made from the hub asks to be listed: the browser sends the
 * signature of the transaction that created it and the rules it committed
 * to in that transaction's memo. The checks are in server/campaign-registry. */
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
    const r = await registerCampaign(body, live.deps);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return Response.json({ ok: true, created: r.created, campaign: r.value.campaign }, { status: r.created ? 201 : 200, headers: NO_STORE });
  } catch (e) {
    console.error(`[campaigns] ${(e as Error).message}`);
    return Response.json({ error: "Devnet or the database did not answer. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
}
