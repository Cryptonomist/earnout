/* Read one transaction, as getTransaction returns it with json encoding,
 * down to what the settler cares about: Earnout tags, memos, SOL moving,
 * and which programs ran. Inner instructions count for transfers and
 * programs (a partner's program may move the SOL by CPI); a tag counts only
 * at the top level, where the SDK puts it. */

import { address, getBase58Encoder, type Address } from "@solana/kit";
import { IX, PROGRAM_ADDRESS } from "../sdk/generated.ts";
import { MEMO_PROGRAM } from "../sdk/identity.ts";
import { SYSTEM_PROGRAM } from "../sdk/program.ts";

const MEMO_V1 = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";

type RawIx = { programIdIndex: number; accounts: number[]; data: string };

export type RawTx = {
  slot: bigint | number;
  blockTime: bigint | number | null;
  meta: {
    err: unknown;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
    innerInstructions?: { index: number; instructions: RawIx[] }[] | null;
  } | null;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: RawIx[] } };
};

export type SolMove = { from: Address; to: Address; lamports: bigint; kind: "transfer" | "create" };

export type ParsedTx = {
  signature: string;
  slot: bigint;
  blockTime: number;
  feePayer: Address;
  failed: boolean;
  tags: { campaign: Address; identity: Address; reference: Address }[];
  memos: string[];
  solMoves: SolMove[];
  programs: Set<string>;
};

const b58 = getBase58Encoder();
const utf8 = new TextDecoder("utf-8", { fatal: false });

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function parseTransaction(raw: RawTx): ParsedTx {
  const msg = raw.transaction.message;
  const keys = [
    ...msg.accountKeys,
    ...(raw.meta?.loadedAddresses?.writable ?? []),
    ...(raw.meta?.loadedAddresses?.readonly ?? []),
  ];
  const key = (i: number) => keys[i];
  const out: ParsedTx = {
    signature: raw.transaction.signatures[0],
    slot: BigInt(raw.slot),
    blockTime: Number(raw.blockTime ?? 0),
    feePayer: address(msg.accountKeys[0]),
    failed: raw.meta?.err != null,
    tags: [],
    memos: [],
    solMoves: [],
    programs: new Set(),
  };

  const visit = (ix: RawIx, topLevel: boolean) => {
    const program = key(ix.programIdIndex);
    out.programs.add(program);
    const data = b58.encode(ix.data) as Uint8Array;

    if (program === SYSTEM_PROGRAM && data.length >= 12) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const which = view.getUint32(0, true);
      if (which === 2 || which === 0) {
        out.solMoves.push({
          from: address(key(ix.accounts[0])),
          to: address(key(ix.accounts[1])),
          lamports: view.getBigUint64(4, true),
          kind: which === 2 ? "transfer" : "create",
        });
      }
    }
    if (topLevel && program === PROGRAM_ADDRESS && ix.accounts.length >= 3 && sameBytes(data.subarray(0, 8), IX.tag)) {
      out.tags.push({
        campaign: address(key(ix.accounts[0])),
        identity: address(key(ix.accounts[1])),
        reference: address(key(ix.accounts[2])),
      });
    }
    if (program === MEMO_PROGRAM || program === MEMO_V1) out.memos.push(utf8.decode(data));
  };

  msg.instructions.forEach((ix) => visit(ix, true));
  for (const group of raw.meta?.innerInstructions ?? []) group.instructions.forEach((ix) => visit(ix, false));
  return out;
}
