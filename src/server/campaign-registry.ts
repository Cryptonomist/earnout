/* Recording a dashboard-made campaign and its links, from the transactions
 * that made them.
 *
 * The site holds the only key that writes the registry, so the question is
 * what earns a write. Never a session or a form: a confirmed transaction,
 * paid for and signed by the campaign's advertiser, carrying what is to be
 * written in a memo. For a campaign that is the hash of its rules
 * (src/lib/rules.ts), in the same transaction that created it; for a link it
 * is the slug, in the transaction that added the channel. So the registry
 * can only ever say what the advertiser said on chain, and anyone can check
 * it there.
 *
 * Pure: the chain and the database come in as functions, so the tests can
 * hand it any transaction they like. */

import { address, isAddress, type Address } from "@solana/kit";
import type { Campaign } from "../../sdk/program";
import type { ParsedTx } from "../../settler/parse";
import { parseLinkMemo, parseRulesMemo, rulesHash, RulesError, validateRules, type Rules } from "../lib/rules";

export type CampaignRow = {
  campaign: string;
  cluster: string;
  advertiser: string;
  name: string;
  description: string | null;
  destination: string;
  rules: Rules;
  rules_hash: string;
  rules_tx: string;
};

export type LinkRow = { slug: string; campaign: string; channel: number; link_tx: string };

export type RegistryDeps = {
  cluster: string;
  /** The Earnout identity; a campaign that names another cannot get links here. */
  identity: Address;
  fetchTransaction(signature: string): Promise<ParsedTx | null>;
  fetchCampaign(campaign: Address): Promise<Campaign | null>;
  /** Slugs the repo's registry file owns; never handed out here. */
  fileSlugs: Set<string>;
  findCampaign(campaign: string): Promise<{ rules_hash: string } | null>;
  findLink(slug: string): Promise<{ campaign: string; channel: number } | null>;
  findChannelLink(campaign: string, channel: number): Promise<string | null>;
  insertCampaign(row: CampaignRow): Promise<void>;
  insertLink(row: LinkRow): Promise<void>;
};

export type Outcome<T> = { ok: true; created: boolean; value: T } | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): Outcome<never> => ({ ok: false, status, error });

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** A confirmed transaction the campaign's advertiser paid for, or why not. */
async function signedByAdvertiser(
  signature: string,
  campaignAddr: Address,
  deps: RegistryDeps,
): Promise<{ tx: ParsedTx; campaign: Campaign } | Outcome<never>> {
  const [tx, campaign] = await Promise.all([deps.fetchTransaction(signature), deps.fetchCampaign(campaignAddr)]);
  if (!tx) return refuse(404, "That transaction is not on chain yet. Try again in a moment.");
  if (tx.failed) return refuse(400, "That transaction failed on chain.");
  if (!campaign) return refuse(404, "There is no campaign at that address yet.");
  if (tx.feePayer !== campaign.advertiser) return refuse(403, "Only the campaign's advertiser can register it.");
  return { tx, campaign };
}

export async function registerCampaign(input: Record<string, unknown>, deps: RegistryDeps): Promise<Outcome<CampaignRow>> {
  const signature = String(input.signature ?? "");
  if (!SIGNATURE.test(signature)) return refuse(400, "Send the signature of the transaction that created the campaign.");
  const campaignAddr = String(input.campaign ?? "");
  if (!isAddress(campaignAddr)) return refuse(400, "Send the campaign's address.");
  let rules: Rules;
  try {
    rules = validateRules(input.rules);
  } catch (e) {
    return refuse(400, e instanceof RulesError ? e.message : "Those rules could not be read.");
  }
  const hash = await rulesHash(rules);

  const checked = await signedByAdvertiser(signature, address(campaignAddr), deps);
  if ("ok" in checked) return checked;
  const { tx, campaign } = checked;
  if (campaign.identity !== deps.identity) {
    return refuse(400, "That campaign does not name Earnout's identity, so its links could not be signed here.");
  }
  if (!tx.memos.some((m) => parseRulesMemo(m) === hash)) return refuse(400, "That transaction does not commit to these rules.");

  const row: CampaignRow = {
    campaign: campaignAddr,
    cluster: deps.cluster,
    advertiser: campaign.advertiser,
    name: rules.name,
    description: rules.description || null,
    destination: rules.destination,
    rules,
    rules_hash: hash,
    rules_tx: signature,
  };
  const existing = await deps.findCampaign(campaignAddr);
  if (existing) {
    if (existing.rules_hash === hash) return { ok: true, created: false, value: row };
    return refuse(409, "This campaign is already registered, with different rules.");
  }
  await deps.insertCampaign(row);
  return { ok: true, created: true, value: row };
}

export async function registerLink(input: Record<string, unknown>, deps: RegistryDeps): Promise<Outcome<LinkRow>> {
  const signature = String(input.signature ?? "");
  if (!SIGNATURE.test(signature)) return refuse(400, "Send the signature of the transaction that named the link.");
  const tx = await deps.fetchTransaction(signature);
  if (!tx) return refuse(404, "That transaction is not on chain yet. Try again in a moment.");
  if (tx.failed) return refuse(400, "That transaction failed on chain.");
  const named = tx.memos.map(parseLinkMemo).filter((m) => m !== null);
  if (named.length !== 1) return refuse(400, "That transaction does not name exactly one link.");
  const { campaign: campaignAddr, index, slug } = named[0];

  const checked = await signedByAdvertiser(signature, address(campaignAddr), deps);
  if ("ok" in checked) return checked;
  if (index >= checked.campaign.channels) {
    return refuse(400, `The campaign has ${checked.campaign.channels} channel(s); there is no channel ${index} yet.`);
  }
  if (deps.fileSlugs.has(slug)) return refuse(409, `/r/${slug} is taken.`);
  if (!(await deps.findCampaign(campaignAddr))) return refuse(400, "Register the campaign before its links.");

  const row: LinkRow = { slug, campaign: campaignAddr, channel: index, link_tx: signature };
  const existing = await deps.findLink(slug);
  if (existing) {
    if (existing.campaign === campaignAddr && existing.channel === index) return { ok: true, created: false, value: row };
    return refuse(409, `/r/${slug} is taken.`);
  }
  const current = await deps.findChannelLink(campaignAddr, index);
  if (current) return refuse(409, `Channel ${index} already has the link /r/${current}.`);
  await deps.insertLink(row);
  return { ok: true, created: true, value: row };
}
