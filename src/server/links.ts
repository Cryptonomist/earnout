/* What an Earnout link does when it is clicked, as a plain function so it
 * can be tested without Next.
 *
 * A slug names one channel of one campaign and where to send people. Every
 * click mints a fresh reference (encrypted to the campaign, so only we can
 * tell which channel it belongs to), has the Earnout identity sign it, and
 * sends the visitor on with the token in `?eo=`.
 *
 * The destination only ever comes from the registry, never from the request,
 * so a link cannot be turned into a redirect to somewhere else.
 *
 * A link must always get the visitor to the partner. If the campaign has
 * ended, or the secrets are missing, the visitor still goes; the redirect
 * just carries no tag. */

import { createKeyPairFromBytes, createKeyPairSignerFromBytes, getAddressFromPublicKey, type Address, type KeyPairSigner } from "@solana/kit";
import { encodeTagToken, signReference } from "../../sdk/identity.ts";
import { TAG_PARAM } from "../../sdk/client.ts";
import { issueReference, referenceKeys } from "../../sdk/reference.ts";

export type LinkEntry = {
  campaign: Address;
  channel: number;
  /** Absolute, or a path on this site (for the demo partner page). */
  destination: string;
  label?: string;
};

export type Registry = Record<string, LinkEntry>;

export type Secrets = {
  identity: CryptoKeyPair;
  /** The same key as a signer, for co-signing X links. */
  identitySigner: KeyPairSigner;
  identityAddress: Address;
  referenceSecret: Uint8Array;
};

export type Resolution =
  | { status: 302; location: string; tagged: boolean }
  | { status: 404 };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function resolveLink(
  slug: string,
  deps: {
    registry: Registry;
    secrets: Secrets | null;
    origin: string;
    now: number;
    /** The campaign's end time, or null if it cannot be read right now. */
    campaignEndsAt?: (campaign: Address) => Promise<number | null>;
  },
): Promise<Resolution> {
  if (!SLUG.test(slug) || !Object.hasOwn(deps.registry, slug)) return { status: 404 };
  const entry = deps.registry[slug];
  const destination = new URL(entry.destination, deps.origin);

  const untagged = (): Resolution => ({ status: 302, location: destination.toString(), tagged: false });
  if (!deps.secrets) return untagged();

  const endsAt = deps.campaignEndsAt ? await deps.campaignEndsAt(entry.campaign).catch(() => null) : null;
  if (endsAt !== null && deps.now >= endsAt) return untagged();

  const reference = issueReference(referenceKeys(deps.secrets.referenceSecret, entry.campaign), entry.channel, deps.now);
  const signature = await signReference(deps.secrets.identity, reference);
  destination.searchParams.set(
    TAG_PARAM,
    encodeTagToken({ campaign: entry.campaign, identity: deps.secrets.identityAddress, reference, signature }),
  );
  return { status: 302, location: destination.toString(), tagged: true };
}

/** Read the two secrets from the environment:
 *
 *   EARNOUT_IDENTITY_KEYPAIR   the identity, as a solana-keygen JSON array
 *   EARNOUT_REFERENCE_SECRET   at least 32 bytes, as hex */
export async function loadSecrets(env: Record<string, string | undefined> = process.env): Promise<Secrets> {
  const rawKeypair = env.EARNOUT_IDENTITY_KEYPAIR;
  const rawSecret = env.EARNOUT_REFERENCE_SECRET;
  if (!rawKeypair || !rawSecret) throw new Error("EARNOUT_IDENTITY_KEYPAIR and EARNOUT_REFERENCE_SECRET must both be set");

  const bytes = Uint8Array.from(JSON.parse(rawKeypair) as number[]);
  if (bytes.length !== 64) throw new Error("EARNOUT_IDENTITY_KEYPAIR must be a 64-byte keypair");
  const identity = await createKeyPairFromBytes(bytes);
  const identitySigner = await createKeyPairSignerFromBytes(bytes);

  const referenceSecret = loadReferenceSecret(env);
  return { identity, identitySigner, identityAddress: await getAddressFromPublicKey(identity.publicKey), referenceSecret };
}

/** Just the reference secret: all the settler needs to open references. It
 * never signs one, so it is never given the identity. */
export function loadReferenceSecret(env: Record<string, string | undefined> = process.env): Uint8Array {
  const raw = env.EARNOUT_REFERENCE_SECRET?.trim();
  if (!raw || !/^([0-9a-f]{2}){32,}$/i.test(raw)) throw new Error("EARNOUT_REFERENCE_SECRET must be at least 32 bytes of hex");
  return Uint8Array.from(Buffer.from(raw, "hex"));
}
