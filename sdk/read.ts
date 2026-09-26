/* Reads of the program's accounts over an RPC, shared by the scripts and
 * the site. Each returns null for an account that does not exist. */

import { getBase58Decoder, getBase64Encoder, type Address, type Base58EncodedBytes } from "@solana/kit";
import type { createSolanaRpc } from "@solana/kit";
import { ACCOUNT } from "./generated.ts";
import {
  channelIdentityAddress,
  decodeChannelIdentity,
  decodeXClaim,
  decodeXLink,
  PROGRAM_ADDRESS,
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

/** Every X link `identity` has vouched for. Few enough to list whole. */
export async function fetchXLinks(rpc: Rpc, identity: Address): Promise<XLink[]> {
  const discriminator = getBase58Decoder().decode(ACCOUNT.XLink) as Base58EncodedBytes;
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ADDRESS, {
      encoding: "base64",
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } },
        { memcmp: { offset: 8n, bytes: identity as unknown as Base58EncodedBytes, encoding: "base58" } },
      ],
    })
    .send();
  return accounts.map((a) => decodeXLink(getBase64Encoder().encode(a.account.data[0]) as Uint8Array));
}

/** The wallet an X handle belongs to right now under `identity`, if the
 * account has been linked at all. Handles are matched the way X does,
 * without regard to case. */
export async function findXLinkByHandle(rpc: Rpc, identity: Address, handle: string): Promise<XLink | null> {
  const wanted = handle.replace(/^@/, "").toLowerCase();
  for (const link of await fetchXLinks(rpc, identity)) {
    if (link.handle.toLowerCase() !== wanted) continue;
    const claim = await accountData(rpc, await xclaimAddress(identity, link.xId));
    if (claim && decodeXClaim(claim).wallet === link.wallet) return link;
  }
  return null;
}
