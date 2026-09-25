/* The link service's decision, without Next: which slug goes where, what the
 * token in the redirect carries, and that a visitor always gets through. */

import { expect } from "chai";
import { randomBytes } from "node:crypto";
import { address, generateKeyPairSigner, getAddressFromPublicKey } from "@solana/kit";
import { decodeTagToken, verifyTag } from "../sdk/identity.ts";
import { captureTag, pendingTag } from "../sdk/client.ts";
import { openReference, referenceKeys } from "../sdk/reference.ts";
import { loadSecrets, resolveLink, type Registry, type Secrets } from "../src/server/links.ts";

const NOW = 1_800_000_000;
const ORIGIN = "https://earnout.dev";
const CAMPAIGN = address("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");

async function makeSecrets(): Promise<{ secrets: Secrets; env: Record<string, string> }> {
  const signer = await generateKeyPairSigner(true);
  const raw = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signer.keyPair.privateKey)).slice(-32);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", signer.keyPair.publicKey));
  const env = {
    EARNOUT_IDENTITY_KEYPAIR: JSON.stringify([...raw, ...pub]),
    EARNOUT_REFERENCE_SECRET: randomBytes(32).toString("hex"),
  };
  return { secrets: await loadSecrets(env), env };
}

const REGISTRY: Registry = {
  "demo-alice": { campaign: CAMPAIGN, channel: 3, destination: "/demo?utm_source=x" },
  "partner-abs": { campaign: CAMPAIGN, channel: 4, destination: "https://app.example.com/deposit" },
};

describe("links", () => {
  let secrets: Secrets;
  let env: Record<string, string>;
  before(async () => {
    ({ secrets, env } = await makeSecrets());
  });

  const resolve = (slug: string, extra: Partial<Parameters<typeof resolveLink>[1]> = {}) =>
    resolveLink(slug, { registry: REGISTRY, secrets, origin: ORIGIN, now: NOW, ...extra });

  it("redirects to the destination with a token that opens to the right channel", async () => {
    const r = await resolve("demo-alice");
    if (r.status !== 302) throw new Error("expected a redirect");
    expect(r.tagged).to.equal(true);

    const url = new URL(r.location);
    expect(url.origin + url.pathname).to.equal(`${ORIGIN}/demo`);
    expect(url.searchParams.get("utm_source")).to.equal("x");

    const tag = decodeTagToken(url.searchParams.get("eo")!)!;
    expect(tag.campaign).to.equal(CAMPAIGN);
    expect(tag.identity).to.equal(secrets.identityAddress);
    expect(await verifyTag(tag)).to.equal(true);
    const keys = referenceKeys(secrets.referenceSecret, CAMPAIGN);
    expect(openReference(keys, tag.reference)).to.deep.equal({ channel: 3, issuedAt: NOW });
  });

  it("mints a new reference on every click", async () => {
    const refs = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = await resolve("demo-alice");
      if (r.status === 302) refs.add(decodeTagToken(new URL(r.location).searchParams.get("eo")!)!.reference);
    }
    expect(refs.size).to.equal(20);
  });

  it("sends people to absolute destinations as they are", async () => {
    const r = await resolve("partner-abs");
    expect(r.status === 302 && r.location.startsWith("https://app.example.com/deposit?eo=e1.")).to.equal(true);
  });

  it("knows nothing but registered slugs", async () => {
    for (const slug of ["nope", "", "Demo-Alice", "../demo-alice", "__proto__", "constructor", "toString", "a".repeat(80)]) {
      expect(await resolve(slug), slug).to.deep.equal({ status: 404 });
    }
  });

  it("still gets the visitor there, untagged, once the campaign has ended", async () => {
    const r = await resolve("demo-alice", { campaignEndsAt: async () => NOW });
    expect(r).to.deep.equal({ status: 302, location: `${ORIGIN}/demo?utm_source=x`, tagged: false });
    const before = await resolve("demo-alice", { campaignEndsAt: async () => NOW + 1 });
    expect(before.status === 302 && before.tagged).to.equal(true);
  });

  it("tags anyway when the chain cannot be read", async () => {
    const r = await resolve("demo-alice", {
      campaignEndsAt: async () => {
        throw new Error("rpc down");
      },
    });
    expect(r.status === 302 && r.tagged).to.equal(true);
  });

  it("still gets the visitor there, untagged, without secrets", async () => {
    const r = await resolve("demo-alice", { secrets: null });
    expect(r).to.deep.equal({ status: 302, location: `${ORIGIN}/demo?utm_source=x`, tagged: false });
  });

  it("refuses malformed secrets", async () => {
    const bad = [
      { ...env, EARNOUT_IDENTITY_KEYPAIR: "[1,2,3]" },
      { ...env, EARNOUT_REFERENCE_SECRET: "abcd" },
      { ...env, EARNOUT_REFERENCE_SECRET: "zz".repeat(32) },
      { EARNOUT_REFERENCE_SECRET: env.EARNOUT_REFERENCE_SECRET },
    ];
    for (const e of bad) {
      let threw = false;
      await loadSecrets(e).catch(() => (threw = true));
      expect(threw, JSON.stringify(Object.keys(e))).to.equal(true);
    }
  });

  it("hands over to the partner page: captured, stripped from the URL, pending", async () => {
    const r = await resolve("demo-alice");
    if (r.status !== 302) throw new Error("expected a redirect");
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    let shown = "";
    const tag = captureTag({ url: r.location, store: storage, now: NOW, replaceUrl: (u) => (shown = u) });
    expect(tag?.campaign).to.equal(CAMPAIGN);
    expect(shown).to.equal(`${ORIGIN}/demo?utm_source=x`);
    expect(pendingTag({ store: storage, now: NOW + 60 })?.reference).to.equal(tag?.reference);
  });
});

describe("registry file", () => {
  it("parses, with valid slugs and addresses", async () => {
    const fs = await import("node:fs");
    const { parseRegistry } = await import("../src/server/registry.ts");
    const raw = JSON.parse(fs.readFileSync("registry/devnet.json", "utf8"));
    const reg = parseRegistry(raw.links);
    for (const [slug, e] of Object.entries(reg)) {
      expect(slug, slug).to.match(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(e.destination.startsWith("/") || e.destination.startsWith("https://"), slug).to.equal(true);
    }
  });

  it("rejects a bad address or channel", async () => {
    const { parseRegistry } = await import("../src/server/registry.ts");
    expect(() => parseRegistry({ x: { campaign: "nope", channel: 0, destination: "/demo" } })).to.throw();
    expect(() => parseRegistry({ x: { campaign: CAMPAIGN, channel: -1, destination: "/demo" } })).to.throw("bad channel");
  });
});

describe("partner client", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  const noop = () => {};

  async function token(channel = 0) {
    const { secrets } = await makeSecrets();
    const r = await resolveLink("demo-alice", {
      registry: { "demo-alice": { campaign: CAMPAIGN, channel, destination: "/demo" } },
      secrets,
      origin: ORIGIN,
      now: NOW,
    });
    if (r.status !== 302) throw new Error("expected a redirect");
    return new URL(r.location).searchParams.get("eo")!;
  }

  it("keeps a tag for seven days, then forgets it", async () => {
    const store = memory();
    captureTag({ url: `${ORIGIN}/demo?eo=${await token()}`, store, now: NOW, replaceUrl: noop });
    expect(pendingTag({ store, now: NOW + 7 * 86_400 })).to.not.equal(null);
    expect(pendingTag({ store, now: NOW + 7 * 86_400 + 1 })).to.equal(null);
    expect(pendingTag({ store, now: NOW })).to.equal(null); // expiry removed it
  });

  it("lets the last click win", async () => {
    const store = memory();
    const first = captureTag({ url: `${ORIGIN}/?eo=${await token()}`, store, now: NOW, replaceUrl: noop });
    const second = captureTag({ url: `${ORIGIN}/?eo=${await token()}`, store, now: NOW + 5, replaceUrl: noop });
    expect(pendingTag({ store, now: NOW + 10 })?.reference).to.equal(second?.reference);
    expect(first?.reference).to.not.equal(second?.reference);
  });

  it("keeps the old tag when a new URL carries a broken one, and still cleans the URL", async () => {
    const store = memory();
    const good = captureTag({ url: `${ORIGIN}/?eo=${await token()}`, store, now: NOW, replaceUrl: noop });
    let shown = "";
    expect(captureTag({ url: `${ORIGIN}/?eo=garbage&x=1`, store, now: NOW, replaceUrl: (u) => (shown = u) })).to.equal(null);
    expect(shown).to.equal(`${ORIGIN}/?x=1`);
    expect(pendingTag({ store, now: NOW })?.reference).to.equal(good?.reference);
  });

  it("does nothing without a tag, and never throws on broken storage", async () => {
    let replaced = false;
    expect(captureTag({ url: `${ORIGIN}/`, store: memory(), replaceUrl: () => (replaced = true) })).to.equal(null);
    expect(replaced).to.equal(false);

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(captureTag({ url: `${ORIGIN}/?eo=${await token()}`, store: broken, replaceUrl: noop })).to.equal(null);
    expect(pendingTag({ store: broken })).to.equal(null);
    expect(pendingTag({ store: memory() })).to.equal(null);
    const store = memory();
    store.setItem("earnout:tag", "{not json");
    expect(pendingTag({ store })).to.equal(null);
  });
});
