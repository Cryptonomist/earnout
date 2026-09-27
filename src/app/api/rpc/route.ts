import "server-only";
import { rpcUrl } from "@/server/chain";

/* Browsers talk to Solana through here, so RPC_URL can carry a paid key
 * without it ever reaching a page. Only the methods the site uses get
 * through, one request at a time, and the body is forwarded as sent (it is
 * parsed only to read the method, so large integers are never rounded).
 *
 * It is the site's own pages' relay, not a public RPC: a browser says where
 * a request came from (Sec-Fetch-Site), and anything but this origin is
 * refused; each address gets a budget of requests per minute, per server
 * instance; and a history read is capped, since the pages never need more
 * than a hundred signatures. */

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTokenAccountBalance",
  "getTransaction",
  "sendTransaction",
]);

const MAX_BODY = 16_384;
const PER_MINUTE = 120;
const MAX_SIGNATURES = 100;

/** Request times per address, for the last minute. */
const budgets = new Map<string, number[]>();

function overBudget(ip: string, now = Date.now()): boolean {
  if (budgets.size > 10_000) budgets.clear();
  const recent = (budgets.get(ip) ?? []).filter((t) => now - t < 60_000);
  budgets.set(ip, [...recent, now]);
  return recent.length >= PER_MINUTE;
}

function refuse(id: unknown, message: string, status = 400, code = -32601) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

type Call = { id?: unknown; method?: unknown; params?: unknown };

/** The body to forward: as sent, except that a history read has its limit
 * capped. That one method carries no big integers, so it is safe to rewrite. */
function bodyFor(call: Call, text: string): string {
  if (call.method !== "getSignaturesForAddress") return text;
  const [addr, config] = Array.isArray(call.params) ? call.params : [];
  const options = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  const limit = Math.min(Number(options.limit) || MAX_SIGNATURES, MAX_SIGNATURES);
  return JSON.stringify({ ...call, params: [addr, { ...options, limit }] });
}

export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(null, "Forbidden", 403);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (overBudget(ip)) return refuse(null, "Too many requests", 429, -32005);

  const text = await request.text();
  if (text.length > MAX_BODY) return refuse(null, "Request too large", 413);

  let call: Call;
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
      body: bodyFor(call, text),
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
