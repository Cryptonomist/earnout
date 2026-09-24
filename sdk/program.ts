/* Instruction builders and account decoders for the earnout program, written
 * against @solana/kit with the discriminators from ./generated.ts. Every
 * builder returns a plain kit Instruction; signer accounts carry their
 * TransactionSigner so `signTransactionMessageWithSigners` finds them. */

import {
  AccountRole,
  address,
  fixCodecSize,
  getAddressCodec,
  getBytesCodec,
  getI64Codec,
  getProgramDerivedAddress,
  getStructCodec,
  getU32Codec,
  getU64Codec,
  getU8Codec,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { ACCOUNT, IX, PROGRAM_ADDRESS } from "./generated.ts";

export { PROGRAM_ADDRESS };

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const addressCodec = getAddressCodec();
const bytes32 = fixCodecSize(getBytesCodec(), 32);
const enc = (s: string) => new TextEncoder().encode(s);

function le64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

function le32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── addresses ────────────────────────────────────────────────────────────────

export async function campaignAddress(advertiser: Address, seed: bigint): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [enc("campaign"), addressCodec.encode(advertiser), le64(seed)],
  });
  return a;
}

export async function channelAddress(campaign: Address, index: number): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [enc("channel"), addressCodec.encode(campaign), le32(index)],
  });
  return a;
}

export async function ataAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM,
): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [addressCodec.encode(owner), addressCodec.encode(tokenProgram), addressCodec.encode(mint)],
  });
  return a;
}

// ── instructions ─────────────────────────────────────────────────────────────

const W = AccountRole.WRITABLE;
const R = AccountRole.READONLY;
const WS = AccountRole.WRITABLE_SIGNER;
const RS = AccountRole.READONLY_SIGNER;

type Meta = { address: Address; role: AccountRole; signer?: TransactionSigner };
const signer = (s: TransactionSigner, role: AccountRole): Meta => ({ address: s.address, role, signer: s });
const meta = (a: Address, role: AccountRole): Meta => ({ address: a, role });

function ix(data: Uint8Array, accounts: Meta[]): Instruction {
  return { programAddress: PROGRAM_ADDRESS, accounts, data } as Instruction;
}

const createCampaignArgs = getStructCodec([
  ["seed", getU64Codec()],
  ["payout", getU64Codec()],
  ["retentionSecs", getU32Codec()],
  ["endsAt", getI64Codec()],
  ["settleDeadline", getI64Codec()],
  ["settler", addressCodec],
  ["identity", addressCodec],
]);

export type CreateCampaignParams = {
  advertiser: TransactionSigner;
  mint: Address;
  tokenProgram?: Address;
  seed: bigint;
  /** Per qualified conversion, in the mint's base units. */
  payout: bigint;
  retentionSecs: number;
  endsAt: bigint;
  settleDeadline: bigint;
  settler: Address;
  identity: Address;
};

export async function createCampaignIx(p: CreateCampaignParams): Promise<Instruction> {
  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM;
  const campaign = await campaignAddress(p.advertiser.address, p.seed);
  const vault = await ataAddress(campaign, p.mint, tokenProgram);
  const data = concat(
    IX.create_campaign,
    createCampaignArgs.encode({
      seed: p.seed,
      payout: p.payout,
      retentionSecs: p.retentionSecs,
      endsAt: p.endsAt,
      settleDeadline: p.settleDeadline,
      settler: p.settler,
      identity: p.identity,
    }) as Uint8Array,
  );
  return ix(data, [
    signer(p.advertiser, WS),
    meta(p.mint, R),
    meta(campaign, W),
    meta(vault, W),
    meta(tokenProgram, R),
    meta(ATA_PROGRAM, R),
    meta(SYSTEM_PROGRAM, R),
  ]);
}

export async function fundIx(p: {
  funder: TransactionSigner;
  campaign: Address;
  mint: Address;
  source: Address;
  amount: bigint;
  tokenProgram?: Address;
}): Promise<Instruction> {
  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM;
  const vault = await ataAddress(p.campaign, p.mint, tokenProgram);
  return ix(concat(IX.fund, le64(p.amount)), [
    signer(p.funder, RS),
    meta(p.campaign, W),
    meta(p.mint, R),
    meta(vault, W),
    meta(p.source, W),
    meta(tokenProgram, R),
  ]);
}

export async function addChannelIx(p: {
  advertiser: TransactionSigner;
  campaign: Address;
  /** The campaign's current `channels` count: the new channel's index. */
  index: number;
  payee: Address;
}): Promise<Instruction> {
  const channel = await channelAddress(p.campaign, p.index);
  return ix(concat(IX.add_channel, addressCodec.encode(p.payee) as Uint8Array), [
    signer(p.advertiser, WS),
    meta(p.campaign, W),
    meta(channel, W),
    meta(SYSTEM_PROGRAM, R),
  ]);
}

export function setPayeeIx(p: { payee: TransactionSigner; channel: Address; newPayee: Address }): Instruction {
  return ix(concat(IX.set_payee, addressCodec.encode(p.newPayee) as Uint8Array), [
    signer(p.payee, RS),
    meta(p.channel, W),
  ]);
}

export function settleIx(p: {
  settler: TransactionSigner;
  campaign: Address;
  channel: Address;
  batch: number;
  conversions: number;
  evidence: Uint8Array;
}): Instruction {
  return ix(concat(IX.settle, le32(p.batch), le32(p.conversions), bytes32.encode(p.evidence) as Uint8Array), [
    signer(p.settler, RS),
    meta(p.campaign, W),
    meta(p.channel, W),
  ]);
}

export async function claimIx(p: {
  payee: TransactionSigner;
  campaign: Address;
  channel: Address;
  mint: Address;
  tokenProgram?: Address;
}): Promise<Instruction> {
  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM;
  return ix(IX.claim, [
    signer(p.payee, WS),
    meta(p.campaign, W),
    meta(p.channel, W),
    meta(p.mint, R),
    meta(await ataAddress(p.campaign, p.mint, tokenProgram), W),
    meta(await ataAddress(p.payee.address, p.mint, tokenProgram), W),
    meta(tokenProgram, R),
    meta(ATA_PROGRAM, R),
    meta(SYSTEM_PROGRAM, R),
  ]);
}

export async function refundIx(p: {
  advertiser: TransactionSigner;
  campaign: Address;
  mint: Address;
  tokenProgram?: Address;
}): Promise<Instruction> {
  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM;
  return ix(IX.refund, [
    signer(p.advertiser, WS),
    meta(p.campaign, W),
    meta(p.mint, R),
    meta(await ataAddress(p.campaign, p.mint, tokenProgram), W),
    meta(await ataAddress(p.advertiser.address, p.mint, tokenProgram), W),
    meta(tokenProgram, R),
    meta(ATA_PROGRAM, R),
    meta(SYSTEM_PROGRAM, R),
  ]);
}

/** The instruction that marks a transaction as coming through a campaign
 * link. Pair it with the identifier memo; see ./identity.ts. */
export function tagIx(p: { campaign: Address; identity: Address; reference: Address }): Instruction {
  return ix(IX.tag, [meta(p.campaign, R), meta(p.identity, R), meta(p.reference, R)]);
}

// ── accounts ─────────────────────────────────────────────────────────────────

const campaignCodec = getStructCodec([
  ["advertiser", addressCodec],
  ["seed", getU64Codec()],
  ["mint", addressCodec],
  ["settler", addressCodec],
  ["identity", addressCodec],
  ["payout", getU64Codec()],
  ["retentionSecs", getU32Codec()],
  ["createdAt", getI64Codec()],
  ["endsAt", getI64Codec()],
  ["settleDeadline", getI64Codec()],
  ["funded", getU64Codec()],
  ["committed", getU64Codec()],
  ["claimed", getU64Codec()],
  ["refunded", getU64Codec()],
  ["channels", getU32Codec()],
  ["bump", getU8Codec()],
]);

const channelCodec = getStructCodec([
  ["campaign", addressCodec],
  ["index", getU32Codec()],
  ["payee", addressCodec],
  ["batches", getU32Codec()],
  ["conversions", getU64Codec()],
  ["earned", getU64Codec()],
  ["claimed", getU64Codec()],
  ["evidence", bytes32],
  ["bump", getU8Codec()],
]);

export type Campaign = ReturnType<typeof campaignCodec.decode>;
export type Channel = ReturnType<typeof channelCodec.decode>;

function checkDiscriminator(data: Uint8Array, disc: Uint8Array, name: string) {
  if (data.length < 8 || !disc.every((b, i) => data[i] === b)) {
    throw new Error(`Not a ${name} account`);
  }
}

export function decodeCampaign(data: Uint8Array): Campaign {
  checkDiscriminator(data, ACCOUNT.Campaign, "Campaign");
  return campaignCodec.decode(data.subarray(8));
}

export function decodeChannel(data: Uint8Array): Channel {
  checkDiscriminator(data, ACCOUNT.Channel, "Channel");
  return channelCodec.decode(data.subarray(8));
}
