/* References: the single-use 32 bytes each campaign link hands out.
 *
 * A reference has to do two things that pull against each other. The
 * settler must be able to tell which channel sent a conversion, and nobody
 * else should, since the chain would otherwise publish which wallets each
 * creator brought in. So a reference is ciphertext:
 *
 *   bytes  0..16  AES-256 of  channel (u32 LE) | issued_at (u32 LE) | nonce (8 random bytes)
 *   bytes 16..32  the first 16 bytes of HMAC-SHA256 over bytes 0..16
 *
 * It is one AES block, never two, so the ECB mode below is just the block
 * cipher applied once; the random nonce makes every block unique. The MAC
 * means a reference we did not issue is rejected outright instead of
 * decrypting to a random channel.
 *
 * Both keys come from one master secret per deployment, stretched with HKDF
 * and salted with the campaign's address, so each campaign has its own keys
 * and a reference from one campaign opens under no other.
 *
 * Server only: this uses node:crypto, and the master secret must never reach
 * a browser. */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

export type ReferenceKeys = { enc: Buffer; mac: Buffer };

export type OpenedReference = { channel: number; issuedAt: number };

export function referenceKeys(master: Uint8Array, campaign: Address): ReferenceKeys {
  if (master.length < 32) throw new Error("The master secret must be at least 32 bytes");
  const salt = getAddressEncoder().encode(campaign) as Uint8Array;
  const okm = Buffer.from(hkdfSync("sha256", master, salt, "earnout/reference/v1", 64));
  return { enc: okm.subarray(0, 32), mac: okm.subarray(32, 64) };
}

function mac(keys: ReferenceKeys, ct: Uint8Array): Buffer {
  return createHmac("sha256", keys.mac).update(ct).digest().subarray(0, 16);
}

export function issueReference(
  keys: ReferenceKeys,
  channel: number,
  issuedAt: number,
  nonce: Uint8Array = randomBytes(8),
): Address {
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffffffff) throw new Error("Bad channel index");
  if (!Number.isInteger(issuedAt) || issuedAt < 0 || issuedAt > 0xffffffff) throw new Error("Bad issue time");
  if (nonce.length !== 8) throw new Error("The nonce must be 8 bytes");

  const block = Buffer.alloc(16);
  block.writeUInt32LE(channel, 0);
  block.writeUInt32LE(issuedAt, 4);
  block.set(nonce, 8);

  const cipher = createCipheriv("aes-256-ecb", keys.enc, null);
  cipher.setAutoPadding(false);
  const ct = Buffer.concat([cipher.update(block), cipher.final()]);
  return getAddressDecoder().decode(Buffer.concat([ct, mac(keys, ct)]));
}

/** The channel and issue time inside `reference`, or null if this campaign's
 * keys did not issue it. */
export function openReference(keys: ReferenceKeys, reference: Address): OpenedReference | null {
  const bytes = Buffer.from(getAddressEncoder().encode(reference));
  const ct = bytes.subarray(0, 16);
  if (!timingSafeEqual(mac(keys, ct), bytes.subarray(16, 32))) return null;

  const decipher = createDecipheriv("aes-256-ecb", keys.enc, null);
  decipher.setAutoPadding(false);
  const block = Buffer.concat([decipher.update(ct), decipher.final()]);
  return { channel: block.readUInt32LE(0), issuedAt: block.readUInt32LE(4) };
}
