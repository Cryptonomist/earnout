import "server-only";
import { createSolanaRpc, getBase64Encoder, type Signature } from "@solana/kit";
import { revalidatePath } from "next/cache";
import { decodeCampaign } from "../../sdk/program";
import { parseTransaction, type RawTx } from "../../settler/parse";
import type { RegistryDeps } from "./campaign-registry";
import { rpcUrl } from "./chain";
import { adminDb } from "./db-admin";
import { loadSecrets, type Secrets } from "./links";
import { CLUSTER, fileLinks, forgetRegistry } from "./registry";

/* The live wiring for campaign-registry.ts: devnet through RPC_URL, the
 * registry tables through the secret key. Every insert also drops the
 * registry's cache and the pages that showed the old state, so the
 * advertiser sees the campaign the moment its row lands. */

let secrets: Promise<Secrets | null> | null = null;
const getSecrets = () => (secrets ??= loadSecrets().catch(() => null));

type DbError = { message: string } | null;
function check(what: string, error: DbError): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function liveRegistryDeps(): Promise<{ deps: RegistryDeps; reason?: undefined } | { deps: null; reason: string }> {
  const db = adminDb();
  if (!db) return { deps: null, reason: "Registering campaigns is not enabled on this deployment." };
  const s = await getSecrets();
  if (!s) return { deps: null, reason: "The Earnout identity is not configured on this deployment." };
  const rpc = createSolanaRpc(rpcUrl());

  return {
    deps: {
      cluster: CLUSTER,
      identity: s.identityAddress,
      async fetchTransaction(signature) {
        const raw = await rpc
          .getTransaction(signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
          .send();
        return raw ? parseTransaction(raw as unknown as RawTx) : null;
      },
      async fetchCampaign(campaign) {
        const { value } = await rpc.getAccountInfo(campaign, { encoding: "base64", commitment: "confirmed" }).send();
        return value ? decodeCampaign(getBase64Encoder().encode(value.data[0]) as Uint8Array) : null;
      },
      fileSlugs: new Set(Object.keys(fileLinks())),
      async findCampaign(campaign) {
        const { data, error } = await db.from("campaigns").select("rules_hash").eq("campaign", campaign).maybeSingle();
        check("read campaign", error);
        return data ? { rules_hash: String(data.rules_hash) } : null;
      },
      async findLink(slug) {
        const { data, error } = await db.from("links").select("campaign, channel").eq("slug", slug).maybeSingle();
        check("read link", error);
        return data ? { campaign: String(data.campaign), channel: Number(data.channel) } : null;
      },
      async findChannelLink(campaign, channel) {
        const { data, error } = await db.from("links").select("slug").eq("campaign", campaign).eq("channel", channel).maybeSingle();
        check("read channel link", error);
        return data ? String(data.slug) : null;
      },
      async insertCampaign(row) {
        const { error } = await db.from("campaigns").insert(row);
        check("insert campaign", error);
        forgetRegistry();
        revalidatePath("/dashboard");
        revalidatePath(`/dashboard/${row.campaign}`);
      },
      async insertLink(row) {
        const { error } = await db.from("links").insert(row);
        check("insert link", error);
        forgetRegistry();
        revalidatePath(`/dashboard/${row.campaign}`);
        revalidatePath(`/r/${row.slug}`);
        revalidatePath(`/c/${row.slug}`);
      },
    },
  };
}
