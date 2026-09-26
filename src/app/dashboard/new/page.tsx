import type { Metadata } from "next";
import { NewCampaign } from "@/components/advertiser/NewCampaign";
import { SiteHeader } from "@/components/dashboard/Pieces";
import { SiteFooter } from "@/components/SiteShell";
import { TEST_USD } from "@/lib/test-usd";
import { canWriteRegistry } from "@/server/db-admin";
import { settlerAddress } from "@/server/defaults";
import { loadSecrets } from "@/server/links";
import { CLUSTER } from "@/server/registry";

export const metadata: Metadata = {
  title: "Start a campaign",
  description: "Create an Earnout campaign on devnet: set the price per user who stays, fund it, and add creators by X handle.",
};

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const identity = await loadSecrets()
    .then((s) => s.identityAddress as string)
    .catch(() => null);
  const reason = !identity
    ? "The Earnout identity is not configured on this deployment, so links could not be signed."
    : !canWriteRegistry()
      ? "Registering campaigns is not enabled on this deployment."
      : null;

  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">For projects</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Start a campaign <span className="font-serif font-normal italic">on results.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          Set the price per user, how long they must stay, and the budget. Add creators by X handle. Sign once, and the
          rules are locked on-chain, for you too. Devnet, with test dollars from the faucet.
        </p>
        <NewCampaign identity={identity} settler={settlerAddress(CLUSTER)} mint={TEST_USD.mint} decimals={TEST_USD.decimals} reason={reason} />
      </main>
      <SiteFooter />
    </>
  );
}
