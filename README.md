# Earnout

Marketing budgets that pay out only for users who stay.

Crypto projects spend on creators, newsletters, quests and partner apps with
no way to tie that spend to what happens on-chain, and they pay for farmers
who leave the day rewards land. Earnout pays each channel only for wallets it
provably sent that are still around when the retention window closes.

## How it works

1. An advertiser funds a **campaign** in USDC: a price per conversion, a
   retention window, an end date. Budget sits in a program-owned vault.
2. Each **channel** (a creator, a newsletter, a partner app) gets a link. The
   link hands out a single-use **reference** signed by the campaign's Action
   Identity.
3. The user's conversion transaction (a deposit, a swap, a mint) carries that
   reference the way the [Solana Actions spec](https://solana.com/docs/tools/actions)
   defines: a `solana-action:<identity>:<reference>:<signature>` memo, plus the
   program's `tag` instruction holding the identity and reference as read-only
   keys. Only the first transaction to use a reference counts. Any
   spec-following indexer can read these tags.
4. After the retention window, the **settler** checks each converted wallet is
   still active and not part of an obvious sybil cluster, then records the
   channel's qualified conversions on-chain with a Merkle root of the evidence.
5. Channels **claim** what they earned. After the settle deadline the
   advertiser **refunds** whatever was never committed.

Channels stay private: a reference is ciphertext only the campaign's key can
open, so the chain shows that a wallet converted, not who sent it. The
advertiser gets the full evidence and can check every entry against the chain.

## What the program guarantees

- A settlement pays exactly `conversions * payout` and never more than the
  campaign has left uncommitted.
- Batches are numbered per channel, so none can be recorded twice.
- Nothing is settled after the deadline, and nothing is refunded before it.
- Tokens leave the vault only to a channel's payee (`claim`) or back to the
  advertiser (`refund`). No admin, no fee, no sweep.
- `tag` reads and writes nothing, so a stale link can never break a user's
  transaction.

The settler is trusted to count honestly; the program holds it to the budget
and the evidence makes overcounting detectable.

## Links

`earnout.dev/r/<slug>` is a channel's link. Each click mints a fresh
reference, encrypted to the campaign and signed by the Earnout identity, and
redirects to the partner with it in `?eo=`:

```
e1.<campaign>.<identity>.<reference>.<signature>
```

The token carries everything needed to tag a transaction, so a partner needs
no configuration and no RPC call. Slugs live in `registry/<cluster>.json`;
destinations come only from there, never from the request. If a campaign has
ended or the service is misconfigured, the link still redirects, untagged.

Try it on devnet: `/r/demo-alice` or `/r/demo-bob` lands on `/demo`, which
plays the partner.

### For partner apps

```ts
import { captureTag, pendingTag, tagInstructions, clearTag } from "./earnout/sdk";

captureTag();                 // on page load: keeps ?eo=, cleans the URL

const tag = pendingTag();     // when the user deposits
const ixs = [...yourInstructions, ...(tag ? tagInstructions(tag) : [])];
// send, confirm, then
clearTag();
```

Last click wins, and a tag is kept for seven days. Nothing in the client
throws; blocked storage just means no tag.

### Running the link service

Copy `.env.example` to `.env.local` and fill it in. To create a campaign with
the Earnout identity and register its slugs:

```bash
npx tsx --env-file=.env.local scripts/create-campaign.ts \
  --payout 5 --fund 500 --retention 600 --ends-in-days 60 \
  --destination /demo --channel demo-alice --channel demo-bob
```

## Layout

| Path | What |
| --- | --- |
| `programs/earnout` | The Anchor program (Anchor 1.2.0) |
| `sdk/` | TypeScript SDK on `@solana/kit`: instruction builders, account decoders, the Action Identity memo, tag tokens |
| `sdk/reference.ts` | The reference cipher (server only) |
| `sdk/client.ts` | The partner's browser helper: capture, keep and clear a tag |
| `src/app` | The site: landing page, `/r/[slug]` links, `/demo` partner page |
| `src/server` | Link resolution, the registry, the one chain read a link needs |
| `registry/` | Slug to campaign and channel, per cluster |
| `tests/` | LiteSVM tests against the built binary, and SDK tests checked against `@solana/actions` |

## Build and test

```bash
npm install
npm run build:program   # anchor build --arch v0, then regenerate sdk/generated.ts
npm test
```

`build:program` targets SBPF v0 because Anchor 1.2 defaults to v3, which
devnet does not accept yet.

## Deployed

| Cluster | Program |
| --- | --- |
| devnet | [`EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU`](https://explorer.solana.com/address/EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU?cluster=devnet) |

`npx tsx scripts/devnet-smoke.ts` runs one whole campaign against it: a test
token, create, fund, a channel, a real tagged transaction found by its
reference and verified, then settle and claim.

## Status

Built for the Colosseum Crypto World's Fair hackathon (September to October
2026). The program, SDK and link service are in place; tagged deposits on the
demo page, the indexer and settler, and the dashboard are next.

## License

MIT
