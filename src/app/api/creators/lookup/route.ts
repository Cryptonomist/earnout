import "server-only";
import { createSolanaRpc } from "@solana/kit";
import { isHandle } from "../../../../../sdk/program";
import { findXLinkByHandle } from "../../../../../sdk/read";
import { rpcUrl } from "@/server/chain";
import { loadSecrets, type Secrets } from "@/server/links";

export const dynamic = "force-dynamic";

let secrets: Promise<Secrets | null> | null = null;
const getSecrets = () => (secrets ??= loadSecrets().catch(() => null));

/* Which wallet an X handle is linked to, under Earnout's identity, so an
 * advertiser can add a KOL by name. Public information: the link is on
 * chain and on the KOL's own page. */
export async function GET(request: Request) {
  const handle = (new URL(request.url).searchParams.get("handle") ?? "").trim().replace(/^@/, "");
  if (!isHandle(handle)) return Response.json({ error: "That is not an X handle" }, { status: 400 });
  const s = await getSecrets();
  if (!s) return Response.json({ error: "The Earnout identity is not configured on this deployment" }, { status: 503 });

  try {
    const link = await findXLinkByHandle(createSolanaRpc(rpcUrl()), s.identityAddress, handle);
    const body = link ? { found: true, handle: link.handle, xId: String(link.xId), wallet: link.wallet } : { found: false, handle };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(`[KOLs/lookup] ${(e as Error).message}`);
    return Response.json({ error: "Devnet did not answer. Try again in a moment." }, { status: 502 });
  }
}
