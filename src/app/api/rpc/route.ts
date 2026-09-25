import "server-only";
import { rpcUrl } from "@/server/chain";

/* Browsers talk to Solana through here, so RPC_URL can carry a paid key
 * without it ever reaching a page. Only the methods the site uses get
 * through, one request at a time, and the body is forwarded as sent (it is
 * parsed only to read the method, so large integers are never rounded). */

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "sendTransaction",
]);

const MAX_BODY = 16_384;

function refuse(id: unknown, message: string, status = 400) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } }, { status });
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return refuse(null, "Request too large", 413);

  let call: { id?: unknown; method?: unknown };
  try {
    call = JSON.parse(text);
  } catch {
    return refuse(null, "Not JSON");
  }
  if (!call || Array.isArray(call) || typeof call.method !== "string" || !ALLOWED.has(call.method)) {
    return refuse(call?.id, "Method not allowed");
  }

  try {
    const upstream = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return refuse(call.id, "RPC unavailable", 502);
  }
}
