import "server-only";
import { createSolanaRpc, isAddress, address } from "@solana/kit";
import { rpcUrl } from "@/server/chain";
import { loadSecrets, type Secrets } from "@/server/links";
import { COOKIE_PROFILE, openProfile, xConfig } from "@/server/x-auth";
import { buildLinkTransaction } from "@/server/x-link-tx";

export const dynamic = "force-dynamic";

/* Step three: the voucher signs, then the wallet.
 *
 * Builds the link_x transaction for the signed-in X profile and the wallet
 * the browser names, signs it as the Earnout identity, and hands it back
 * for the wallet to complete and send. A wallet that will not sign gets
 * nothing written; a server without a signed-in profile writes nothing. */

let secrets: Promise<Secrets | null> | null = null;
const getSecrets = () => (secrets ??= loadSecrets().catch(() => null));

export async function POST(request: Request) {
  const cfg = xConfig();
  if (!cfg) return Response.json({ error: "X sign-in is not configured on this deployment" }, { status: 503 });
  const s = await getSecrets();
  if (!s) return Response.json({ error: "The Earnout identity is not configured on this deployment" }, { status: 503 });

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_PROFILE}=`))
    ?.slice(COOKIE_PROFILE.length + 1);
  const profile = openProfile(cfg.clientSecret, cookie);
  if (!profile) return Response.json({ error: "Sign in with X again: that sign-in has expired" }, { status: 401 });

  let wallet = "";
  try {
    wallet = String(((await request.json()) as { wallet?: unknown }).wallet ?? "");
  } catch {
    // Not JSON: the address check below refuses it.
  }
  if (!isAddress(wallet)) return Response.json({ error: "Send the wallet that will sign" }, { status: 400 });

  try {
    const { value: lifetime } = await createSolanaRpc(rpcUrl()).getLatestBlockhash({ commitment: "confirmed" }).send();
    const transaction = await buildLinkTransaction({
      identity: s.identitySigner,
      wallet: address(wallet),
      xId: BigInt(profile.xId),
      handle: profile.handle,
      lifetime,
    });
    return Response.json(
      { transaction, handle: profile.handle, xId: profile.xId, identity: s.identityAddress },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error(`[x/link] ${(e as Error).message}`);
    return Response.json({ error: "Devnet did not answer. Try again in a moment." }, { status: 502 });
  }
}
