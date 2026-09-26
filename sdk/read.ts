/* Reads of the program's accounts over an RPC, shared by the scripts and
 * the site. Each returns null for an account that does not exist. */

import { getBase64Encoder, type Address } from "@solana/kit";
import type { createSolanaRpc } from "@solana/kit";
import {
  channelIdentityAddress,
  decodeChannelIdentity,
  decodeXClaim,
  decodeXLink,
  xclaimAddress,
  xlinkAddress,
  type ChannelIdentity,
  type XLink,
} from "./program.ts";

export type Rpc = ReturnType<typeof createSolanaRpc>;

async function accountData(rpc: Rpc, a: Address): Promise<Uint8Array | null> {
  const { value } = await rpc.getAccountInfo(a, { encoding: "base64", commitment: "confirmed" }).send();
  return value ? (getBase64Encoder().encode(value.data[0]) as Uint8Array) : null;
}

/** The wallet's X link as `identity` vouched for it, if the X account still
 * belongs to this wallet. A link whose account has moved to another wallet
 * is reported with `current: false`. */
export async function fetchXLink(rpc: Rpc, identity: Address, wallet: Address): Promise<(XLink & { current: boolean }) | null> {
  const data = await accountData(rpc, await xlinkAddress(identity, wallet));
  if (!data) return null;
  const link = decodeXLink(data);
  const claimData = await accountData(rpc, await xclaimAddress(identity, link.xId));
  const current = !!claimData && decodeXClaim(claimData).wallet === wallet;
  return { ...link, current };
}

export async function fetchChannelIdentity(rpc: Rpc, channel: Address): Promise<ChannelIdentity | null> {
  const data = await accountData(rpc, await channelIdentityAddress(channel));
  return data ? decodeChannelIdentity(data) : null;
}
