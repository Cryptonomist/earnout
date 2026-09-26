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

## Every channel is a verified person

A channel can only be created for a wallet that has linked an X account.
`link_x` writes "this wallet is this X account" under two signatures: the
wallet's, and a voucher's (the campaign identity, on the server) saying X's
own sign-in confirmed it. Neither alone writes anything, so nobody can hang a
stranger's name on their wallet, or their own on a stranger's. Links are
keyed per voucher, so a campaign trusts only its own identity's links and the
program still has no admin key.

The X account is written onto the channel for good (`ChannelIdentity`). The
payout wallet can move (`set_payee`), but only to a wallet linked to the same
account, and one X account is one wallet at a time (`XClaim`), so a creator's
record follows them and a bad one cannot be shed by changing wallets.
Channels made before verification existed have no identity and are shown as
unverified.

```bash
npx tsx --env-file=.env.local scripts/add-channel.ts \
  --campaign <address> --slug <slug> --payee <linked wallet>
```

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

The tag costs about 72,000 compute units, almost all of it the memo (Memo v2
checks every byte is valid UTF-8); `tag` itself is about 1,100. If you set a
compute unit limit, add that much.

On `/demo`, a wallet signs a 0.01 devnet SOL deposit with the tag on it; the
page sends it through `/api/rpc` itself (so a wallet left on mainnet cannot
misroute it), then finds it by its reference and checks the memo's
signature, as the settler will.

### Running the link service

Copy `.env.example` to `.env.local` and fill it in. To create a campaign with
the Earnout identity and register its slugs:

```bash
npx tsx --env-file=.env.local scripts/create-campaign.ts \
  --payout 5 --fund 500 --retention 600 --ends-in-days 60 \
  --destination /demo --channel demo-alice --channel demo-bob
```

## Settler

`scripts/settle.ts` turns tagged transactions into on-chain payouts. Each
pass, for every campaign in `registry/<cluster>.json`:

1. **Find** new transactions touching the campaign's address.
2. **Screen** each tag: the campaign's identity, a memo signature that
   verifies, a reference that opens under the campaign's key to a real
   channel, the first use of that reference, inside the campaign dates and
   the click's attribution window, carrying the campaign's qualifying action
   (for the demo: at least 0.01 SOL into the treasury), from a wallet that
   is not the advertiser or a channel's payee, and that has not converted
   before.
3. **Wait** out the retention window, then check the wallet stayed (for the
   demo: still holds 0.005 SOL; `token-balance` checks a position instead).
4. **Flag** wallets funded by a channel's payee, and clusters of more than N
   converting wallets funded by one quiet source. Busy sources (faucets,
   exchanges, a thousand transactions or more) are ignored.
5. **Settle** each channel's qualified conversions as its next numbered
   batch, oldest first, as far as the uncommitted budget goes, with a Merkle
   root of the conversion signatures as evidence.

Settling is exactly once: a batch is recorded as pending before it is sent,
the program refuses a batch number twice, and the next pass reads the
channel's batch count to see whether it landed. State lives in
`var/settler/<cluster>/<campaign>.json`, gitignored, because which wallet came
through which channel is exactly what the chain is kept from knowing.

In production the settler runs from GitHub Actions every ten minutes
(`.github/workflows/settle.yml`), one pass at a time, with three repository
secrets: a dedicated settler key that holds a little devnet SOL for fees and
can do nothing but settle, the reference secret, and the Supabase secret key.
It never gets the Earnout identity or the deploy wallet.

```bash
npx tsx --env-file=.env.local scripts/settle.ts --dry-run   # decide, send nothing
npx tsx --env-file=.env.local scripts/settle.ts             # one pass
npx tsx --env-file=.env.local scripts/settle.ts --watch 60  # a pass a minute
npx tsx scripts/claim.ts --slug demo-alice --signer <payee keyfile>
```

## Dashboard

`/dashboard` lists campaigns; `/dashboard/<campaign>` shows one: headline
numbers, the budget (claimed, owed, uncommitted), a receipt per channel, and
every settlement with its evidence root and transaction. `/c/<slug>` is a
creator's page: their link, their receipt, and a claim button for the
channel's payout wallet.

Money on these pages is read from Solana on each render (cached for 30
seconds), so it cannot drift from the truth. Tagged, gone and flagged counts
come from the report the settler publishes after every pass to the earnout
Supabase project: counts and settlement links only, never a wallet, which a
test holds it to. The settler's own ledger lives in a private table only its
secret key can reach; set `SUPABASE_SECRET_KEY` in `.env.local` for that
(without it, the settler keeps a local file and publishes nothing).

## Brand

`/brand` shows the logo family and offers every file for download. The
files in `public/brand` are generated by `npx tsx scripts/brand.ts` from the
mark's geometry and the wordmark (Geist SemiBold, converted to paths).

## Layout

| Path | What |
| --- | --- |
| `programs/earnout` | The Anchor program (Anchor 1.2.0) |
| `sdk/` | TypeScript SDK on `@solana/kit`: instruction builders, account decoders, the Action Identity memo, tag tokens |
| `sdk/reference.ts` | The reference cipher (server only) |
| `sdk/client.ts` | The partner's browser helper: capture, keep and clear a tag |
| `src/app` | The site: landing page, `/r/[slug]` links, `/demo` partner page |
| `src/server` | Link resolution, the registry, the one chain read a link needs |
| `registry/` | Per cluster: slugs to campaign and channel, and each campaign's settler rules |
| `settler/` | Parsing, screening, retention and cluster checks, batch planning, evidence |
| `scripts/` | Create a campaign, settle, claim, move a payee, the devnet smoke test |
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
2026). The whole loop runs on devnet: a click on `/r/demo-alice`, a tagged
deposit on `/demo`, the retention window, a settlement on chain and the
creator's claim. The dashboard is next.

## License

MIT
