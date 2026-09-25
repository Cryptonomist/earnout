/* The evidence root a settlement carries: a Merkle root over the batch's
 * conversion transactions. Leaves are SHA-256 of each 64-byte signature,
 * sorted, so the root does not depend on the order they were found in; an
 * odd node at any level is carried up unchanged. Anybody holding the list
 * can recompute the root, compare it with the channel account, and look up
 * every transaction on chain. */

import { createHash } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";

const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export function evidenceRoot(signatures: string[]): Uint8Array {
  if (!signatures.length) throw new Error("A batch needs at least one conversion");
  const b58 = getBase58Encoder();
  let level: Uint8Array[] = signatures
    .map((s) => sha256(b58.encode(s) as Uint8Array))
    .sort((a, b) => hex(a).localeCompare(hex(b)));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? sha256(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

export const evidenceHex = (signatures: string[]) => hex(evidenceRoot(signatures));
