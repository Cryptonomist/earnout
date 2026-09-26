import "server-only";
import { rpcUrl } from "@/server/chain";
import { grant, liveDeps, type FaucetDeps, type Limiter } from "@/server/faucet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const limiter: Limiter = new Map();
let deps: Promise<FaucetDeps | null> | null = null;

export async function POST(request: Request) {
  deps ??= liveDeps(rpcUrl(), process.env.FAUCET_KEYPAIR).catch((e) => {
    console.error(`[faucet] off: ${(e as Error).message}`);
    return null;
  });
  const live = await deps;
  if (!live) {
    return Response.json({ ok: false, reason: "unavailable", message: "The demo faucet is off. Use the Solana faucet instead." }, { status: 503 });
  }

  let wallet = "";
  try {
    wallet = String(((await request.json()) as { wallet?: unknown }).wallet ?? "");
  } catch {
    // An unreadable body is just a bad address.
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  try {
    const result = await grant(wallet, ip, live, limiter);
    const status = result.ok ? 200 : result.reason === "rate limited" ? 429 : 400;
    return Response.json(result, { status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(`[faucet] ${(e as Error).message}`);
    return Response.json({ ok: false, reason: "unavailable", message: "Devnet did not answer. Try again in a moment." }, { status: 502 });
  }
}
