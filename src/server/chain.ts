/* The one chain read a link needs: when its campaign ends. Cached for a
 * minute, and bounded to 1.5 seconds, because a slow RPC must never hold up
 * a click; when it cannot answer, the link tags anyway (the settler ignores
 * conversions after the end, so the only cost is a wasted reference). */

import { createSolanaRpc, getBase64Encoder, type Address } from "@solana/kit";
import { decodeCampaign } from "../../sdk/program.ts";

const TTL_MS = 60_000;
const TIMEOUT_MS = 1_500;

const cache = new Map<Address, { endsAt: number | null; at: number }>();

export function rpcUrl(): string {
  return process.env.RPC_URL ?? "https://api.devnet.solana.com";
}

export async function campaignEndsAt(campaign: Address): Promise<number | null> {
  const hit = cache.get(campaign);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.endsAt;

  try {
    const { value } = await createSolanaRpc(rpcUrl())
      .getAccountInfo(campaign, { encoding: "base64" })
      .send({ abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
    const endsAt = value ? Number(decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array).endsAt) : null;
    cache.set(campaign, { endsAt, at: Date.now() });
    return endsAt;
  } catch {
    return null;
  }
}
