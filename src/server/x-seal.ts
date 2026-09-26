/* The pure parts of signing in with X: PKCE, and the sealed cookie that
 * carries a profile from X's callback to the link. No server-only import,
 * so tests can exercise them. */

import crypto from "node:crypto";
import { isHandle } from "../../sdk/program";

export type XProfile = { xId: string; handle: string; avatar: string | null };

/** The signed-in profile, sealed, for fifteen minutes. */
export const COOKIE_PROFILE = "eo_x";
export const PROFILE_TTL_SECS = 900;

const b64url = (b: Buffer) => b.toString("base64url");

/** PKCE: a secret, and the hash of it that goes out in the open. */
export function pkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export const randomState = () => b64url(crypto.randomBytes(32));

/** X account ids are decimal strings; anything that fits a u64 is taken. */
export const isXId = (id: string) => /^\d{1,20}$/.test(id) && BigInt(id) > 0n && BigInt(id) < 1n << 64n;

/** Only X's own image host, and only over https. */
export function cleanAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "pbs.twimg.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

const hmac = (secret: string, body: string) => b64url(crypto.createHmac("sha256", secret).update(body).digest());

/* A cookie the browser carries but cannot forge: HMAC-SHA256 keyed by the X
 * client secret, which is already on the server and nowhere else. A payload
 * whose expiry has passed is refused even with a good signature. */
export function sealProfile(secret: string, value: XProfile, ttlSecs = PROFILE_TTL_SECS, now = Date.now()): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...value, exp: Math.floor(now / 1000) + ttlSecs })));
  return `${body}.${hmac(secret, body)}`;
}

export function openProfile(secret: string, token: string | undefined, now = Date.now()): XProfile | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(secret, body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<XProfile> & { exp?: number };
    if (!v.xId || !v.handle || !v.exp) return null;
    if (!isXId(v.xId) || !isHandle(v.handle)) return null;
    if (v.exp < Math.floor(now / 1000)) return null;
    return { xId: v.xId, handle: v.handle, avatar: cleanAvatar(v.avatar) };
  } catch {
    return null;
  }
}
