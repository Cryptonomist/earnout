import "server-only";
import { rpcUrl } from "@/server/chain";
import type { Limiter } from "@/server/faucet";
import { grantUsd, liveUsdDeps, type UsdDeps } from "@/server/faucet-usd";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const limiter: Limiter = new Map();
let deps: Promise<UsdDeps | null> | null = null;

/* Test dollars for funding a campaign on devnet; see server/faucet-usd.ts. */
export async function POST(request: Request) {
  deps ??= liveUsdDeps(rpcUrl(), process.env.FAUCET_KEYPAIR).catch((e) => {
    console.error(`[faucet/usd] off: ${(e as Error).message}`);
    return null;
  });
  const live = await deps;
  if (!live) {
    return Response.json({ ok: false, reason: "unavailable", message: "The test dollar faucet is off on this deployment." }, { status: 503 });
  }

  let wallet = "";
  try {
    wallet = String(((await request.json()) as { wallet?: unknown }).wallet ?? "");
  } catch {
    // An unreadable body is just a bad address.
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  try {
    const result = await grantUsd(wallet, ip, live, limiter);
    const status = result.ok ? 200 : result.reason === "rate limited" ? 429 : 400;
    return Response.json(result, { status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(`[faucet/usd] ${(e as Error).message}`);
    return Response.json({ ok: false, reason: "unavailable", message: "Devnet did not answer. Try again in a moment." }, { status: 502 });
  }
}
