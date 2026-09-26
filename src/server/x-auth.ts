import "server-only";
import { cleanAvatar, isXId, type XProfile } from "./x-seal";
import { isHandle } from "../../sdk/program";

/* Signing in with X, the only way Earnout ever touches it.
 *
 * We ask to read a public profile and nothing else: no posting, no
 * messages, and no offline access, so X hands us no refresh token and we
 * cannot act as anybody later. The access token is used once, to read an id
 * and a handle, and dropped.
 *
 * Nothing is stored on a server. What survives the round trip is a cookie
 * x-seal.ts signs; the browser carries it and cannot change it. The chain
 * is what records the link, and only the wallet can sign that (api/x/link). */

export { COOKIE_PROFILE, PROFILE_TTL_SECS, openProfile, pkce, randomState, sealProfile } from "./x-seal";
export type { XProfile } from "./x-seal";

export type XConfig = { clientId: string; clientSecret: string };

export function xConfig(): XConfig | null {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const AUTHORIZE = "https://x.com/i/oauth2/authorize";
export const TOKEN = "https://api.x.com/2/oauth2/token";
export const ME = "https://api.x.com/2/users/me";

/** Read the profile, and that is the whole list. */
export const SCOPES = ["users.read", "tweet.read"];

export const COOKIE_STATE = "eo_x_state";
export const COOKIE_VERIFIER = "eo_x_verifier";

/** Where sign-in starts and ends: the KOL hub. */
export const RETURN_PATH = "/creators";

/** The callback X redirects to, which must match one registered on the app. */
export const redirectUri = (origin: string) => `${origin}/api/x/callback`;

/** Swap the code for a token, read the profile, and keep neither. */
export async function readProfile(cfg: XConfig, code: string, verifier: string, origin: string): Promise<XProfile> {
  const res = await fetch(TOKEN, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri(origin),
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`X would not exchange the code (HTTP ${res.status})`);
  const token = (await res.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("X returned no access token");

  const me = await fetch(`${ME}?user.fields=profile_image_url`, {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!me.ok) throw new Error(`X would not say who you are (HTTP ${me.status})`);
  const body = (await me.json()) as { data?: { id?: string; username?: string; profile_image_url?: string } };
  const id = body.data?.id;
  const handle = body.data?.username;
  if (!id || !handle) throw new Error("X returned no account");
  if (!isXId(id) || !isHandle(handle)) throw new Error("X returned an account this program will not take");
  return { xId: id, handle, avatar: cleanAvatar(body.data?.profile_image_url) };
}
