# Earnout

[![ci](https://github.com/Cryptonomist/earnout/actions/workflows/ci.yml/badge.svg)](https://github.com/Cryptonomist/earnout/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

Marketing budgets that pay out only for users who stay.

Crypto projects spend on influencers, newsletters, quests and partner apps with
no way to tie that spend to what happens on-chain, and they pay for farmers
who leave the day rewards land. Earnout pays each channel only for wallets it
provably sent that are still around when the retention window closes.

Live on Solana devnet at **[earnout.dev](https://earnout.dev)**. Built for
the Colosseum Crypto World's Fair, September to October 2026.

## Words

The site speaks to people and the code speaks to the chain, so two
vocabularies meet here:

| On the site            | In the code                | Meaning                                                                        |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| project                | `advertiser`               | Whoever funds a campaign and gets the refund                                   |
| influencer             | `channel`                  | Whoever is paid for the users their link sends: a person, a newsletter, an app |
| user joins             | `conversion`               | The transaction that counts, tagged with the link's reference                  |
| stay period            | `retention_secs`, "window" | How long a user must still be active before the influencer is paid             |
| Earnout checks         | `settler`                  | The service that screens conversions and settles batches on chain              |
| `earnout.dev/r/<slug>` | `LinkEntry`, `registry`    | An influencer's link; `/c/<slug>` is their page, `/r/<slug>` the disclosure    |

"Creator" was the site's earlier word for influencer; it survives only in
the `/creators` redirects that keep old links working.

## Try it in three minutes

No wallet or devnet SOL needed.

1. Open an influencer's link: **[earnout.dev/r/cryptonomist](https://earnout.dev/r/cryptonomist)**.
   It discloses who is paid, by whom and for what before anything happens.
   Continue.
2. On the demo partner page, choose **Use a guest wallet**, then **Get 0.02
   devnet SOL**, then **Deposit 0.01 devnet SOL**. Your deposit now carries a
   signed, single-use tag, and the page shows how the settler will find it.
3. Watch the **[campaign dashboard](https://earnout.dev/dashboard)**. After
   the 10-minute window the settler checks you stayed, settles on chain, and
   the influencer's receipt shows one more user paid for. Their public record is
   at **[earnout.dev/influencers/CRYPT0NOMIST](https://earnout.dev/influencers/CRYPT0NOMIST)**.

Two demo channels already show what the settler catches: users who left
before the window closed, and a four-wallet farm flagged as one cluster, none
of them paid for.

To become an influencer yourself: **[earnout.dev/influencers](https://earnout.dev/influencers)**,
sign in with X, link a wallet. Every channel is a verified X account, and an
influencer's record follows that account whatever wallet it pays to.

To run a campaign yourself: **[earnout.dev/dashboard/new](https://earnout.dev/dashboard/new)**.
Pick what counts as a conversion and what "stayed" means, set a price per
user who stays, fund the vault with test dollars from the faucet, and sign
once. On the campaign's page, add influencers by X handle (each gets a link),
top up the budget, and take the refund when settlement closes. The rules are
hashed into the transaction that creates the campaign, so nobody, including
the advertiser, can change them once influencers start sending people.

For how the pieces fit, trust boundaries and what is on chain versus off,
see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How it works

1. An advertiser funds a **campaign** in USDC: a price per conversion, a
   retention window, an end date. Budget sits in a program-owned vault.
2. Each **channel** (an influencer, a newsletter, a partner app) gets a link. The
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
- Nothing is settled before the first wallet could have stayed the whole
  window, nor after the deadline; nothing is refunded before the deadline.
- Tokens leave the vault only to a channel's payee (`claim`) or back to the
  advertiser (`refund`). No admin, no fee, no sweep. A refund is counted
  from the vault's balance, so tokens that reached the vault by hand come
  back too instead of being locked.
- A Token-2022 mint with a permanent delegate, a transfer hook or the
  non-transferable extension is refused when the campaign is made, so no
  channel has to vet the mint.
- `tag` reads and writes nothing, so a stale link can never break a user's
  transaction.

The settler is trusted to count honestly; the program holds it to the budget
and the evidence makes overcounting detectable. The one power above the
instruction set is the program's upgrade authority: on devnet the deploy
wallet; a mainnet deployment would hand it to a multisig, and give it up
once the program has been audited.

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
account, and one X account is one wallet at a time (`XClaim`), so an influencer's
record follows them and a bad one cannot be shed by changing wallets.
The program has required this since before the first hub campaign; the two
demo channels (`demo-alice`, `demo-bob`) predate it, have no identity, and
are shown as unverified. Nothing made since can be.

Influencers link at `/influencers`: sign in with X (read-only, PKCE, nothing
stored on a server; the profile rides in a cookie the server signs for
fifteen minutes), connect a wallet, and link. `/api/x/link` builds the
`link_x` transaction and signs it as the Earnout identity; the wallet
completes it in the browser and the page sends it. `X_CLIENT_ID` and
`X_CLIENT_SECRET` come from an app at console.x.com with
`https://earnout.dev/api/x/callback` as a callback.

```bash
npx tsx --env-file=.env.local scripts/add-channel.ts \
  --campaign <address> --slug <slug> --payee <linked wallet>
```

## Links

`earnout.dev/r/<slug>` is a channel's link. It opens on a disclosure: who is
paid, by whom, how much per user who stays, and that nothing is paid for a
click. Only when the visitor continues (`/r/<slug>/go`) is a fresh reference
minted, encrypted to the campaign and signed by the Earnout identity, and
the visitor redirected to the partner with it in `?eo=`:

```
e1.<campaign>.<identity>.<reference>.<signature>
```

The token carries everything needed to tag a transaction, so a partner needs
no configuration and no RPC call. Slugs live in the registry: the pilots in
`registry/<cluster>.json`, campaigns made from the dashboard in the
`campaigns` and `links` tables in Supabase (see below). Destinations come
only from there, never from the request. If a campaign has ended or the
service is misconfigured, the link still redirects, untagged.

Try it on devnet: `/r/demo-alice` or `/r/demo-bob` lands on `/demo`, which
plays the partner.

### For partner apps

```ts
import { captureTag, pendingTag, tagInstructions, clearTag } from "./earnout/sdk";

captureTag(); // on page load: keeps ?eo=, cleans the URL

const tag = pendingTag(); // when the user deposits
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

Copy `.env.example` to `.env.local` and fill it in. To create a pilot
campaign from the command line, with the Earnout identity, and register its
slugs in the file (one `--payee` per `--channel`, each a wallet that has
linked its X account at `/influencers`):

```bash
npx tsx --env-file=.env.local scripts/create-campaign.ts \
  --payout 5 --fund 500 --retention 600 --ends-in-days 60 \
  --destination /demo --channel alice --payee <alice's linked wallet>
```

## Campaigns from the dashboard

`/dashboard/new` creates a campaign from the browser, and `/dashboard/<campaign>`
manages it: fund, add an influencer by X handle, refund after the deadline. The
wallet that signs is the advertiser, and the guest wallet works, so a judge
can run the whole loop without installing anything.

The rules (what counts as a conversion, what "stayed" means, the attribution
window, the cluster limit) live off chain, so their hash goes on chain. The
transaction that creates the campaign carries `earnout:rules:v1:<sha256>` in
a memo, over the canonical form in `src/lib/rules.ts`; adding an influencer
carries `earnout:link:v1:<campaign>:<channel>:<slug>`. The site records a
campaign or a link only from a confirmed transaction the advertiser paid for
whose memo matches (`src/server/campaign-registry.ts`), and the settler
trusts a row only while its rules still hash to what was committed
(`settler/registry.ts`). Rules are final: there is no update. Anyone can
recompute the hash from a campaign page and check it against the transaction
linked there.

The rows live in Supabase (`campaigns`, `links`), public to read. Writing
them needs `SUPABASE_SECRET_KEY` on the site's host; without it the hub is
read-only and says so. Test dollars come from `/api/faucet/usd`, minted by
the faucet key, which holds the test token's mint authority.

To send a few test users through a link (fresh wallets, funded by the demo
faucet key, clicking the live link and depositing with the tag), give it the
slug from the influencer's page on that campaign:

```bash
npx tsx --env-file=.env.local scripts/convert.ts --slug <slug> --stay 2 --leave 1
```

## Settler

`scripts/settle.ts` turns tagged transactions into on-chain payouts. Each
pass, for every campaign in the registry (the file and the dashboard's rows):

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
channel's batch count to see whether it landed. Whether a failed send was
refused (drop the batch, replan) or is unknown (keep it pending for the
chain to say) is decided from kit's error codes, never from message text.
A node that is a few slots behind is asked again before a transaction is
believed missing, and one wallet the RPC will not answer for waits for the
next pass without holding up the rest.

The ledger, which wallet came through which channel, is exactly what the
chain is kept from knowing. It lives in the earnout Supabase project's
private `ledgers` table, saved under a version so two overlapping passes
cannot overwrite each other (`supabase/migrations` has the schema and the
`save_ledger` function); without `SUPABASE_SECRET_KEY` it is a file under
`var/settler/`, gitignored, with the same versioning.

In production the settler runs from GitHub Actions every ten minutes
(`.github/workflows/settle.yml`, kicked on time by a pg_cron job in the same
Supabase project), one pass at a time, with three repository secrets: a
dedicated settler key that holds a little devnet SOL for fees and can do
nothing but settle, the reference secret, and the Supabase secret key. It
never gets the Earnout identity or the deploy wallet.

```bash
npx tsx --env-file=.env.local scripts/settle.ts --dry-run   # decide, send nothing
npx tsx --env-file=.env.local scripts/settle.ts             # one pass
npx tsx --env-file=.env.local scripts/settle.ts --watch 60  # a pass a minute
npx tsx scripts/claim.ts --slug demo-alice --signer <payee keyfile>
```

## Dashboard

`/dashboard` lists campaigns; `/dashboard/<campaign>` shows one: headline
numbers, the budget (claimed, owed, uncommitted), a receipt per channel, and
every settlement with its evidence root and transaction. Connect the
advertiser's wallet there to fund it, add influencers and refund. `/c/<slug>`
is an influencer's page: their link, their receipt, and a claim button for the
channel's payout wallet.

Money on these pages is read from Solana on each render, so it cannot drift
from the truth. Tagged, gone and flagged counts
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

| Path                  | What                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/earnout`    | The Anchor program (Anchor 1.2.0)                                                                                                                                |
| `sdk/`                | TypeScript SDK on `@solana/kit`: instruction builders, account decoders, the Action Identity memo, tag tokens                                                    |
| `sdk/reference.ts`    | The reference cipher (server only)                                                                                                                               |
| `sdk/client.ts`       | The partner's browser helper: capture, keep and clear a tag                                                                                                      |
| `src/app`             | The site: landing page, `/r/[slug]` links, `/demo` partner page, the dashboard, the advertiser hub, the influencer hub                                           |
| `src/lib/rules.ts`    | A campaign's rules: validation, the canonical form that is hashed, the memo formats                                                                              |
| `src/server`          | Link resolution, the registry (file plus database), registering campaigns from their transactions, the faucets                                                   |
| `registry/`           | Per cluster: the pilots' slugs and settler rules; dashboard campaigns live in Supabase                                                                           |
| `settler/`            | Parsing, screening, retention and cluster checks, batch planning, evidence, the ledger store                                                                     |
| `scripts/`            | `settle`, `create-campaign`, `add-channel`, `set-payee`, `claim`, `convert`, `simulate`, `devnet-smoke`, `gen-sdk`, `brand`, `card`; `lib.ts` is what they share |
| `supabase/migrations` | The database: the ledger and its `save_ledger` function, the public report, the registry tables, the settler ticker                                              |
| `tests/`              | 119 tests: the program in LiteSVM against the built binary, the SDK against `@solana/actions`, the settler with the chain faked                                  |
| `.github/workflows`   | `ci.yml` (every push: build, lint, format, test) and `settle.yml` (the settler, every ten minutes)                                                               |

## Build and test

You need Node 24, Rust 1.89 (rust-toolchain.toml installs it through
rustup), the Solana CLI 3.1.10 and Anchor 1.2.0, the versions Anchor.toml
pins and CI uses.

```bash
npm install
npm run build:program   # anchor build --arch v0, then regenerate sdk/generated.ts
npm test                # 119 tests, most of them against the freshly built binary in LiteSVM
npm run check           # typecheck, lint, format check and the tests, as CI runs them
```

`build:program` targets SBPF v0 because Anchor 1.2 defaults to v3, which
devnet does not accept yet. The suite refuses to run against a stale binary
or a stale `sdk/generated.ts` and says which command to run.

## Security

Every key, what it can do and where it lives is in
[Trust boundaries](docs/ARCHITECTURE.md#trust-boundaries); what the program
enforces and what it cannot, in
[What the program guarantees, and what it cannot](docs/ARCHITECTURE.md#what-the-program-guarantees-and-what-it-cannot).
The site's own attack surface (the RPC relay, the faucets, sign-in with X,
the registry writes) is described where each lives, in the header comment of
the file. The program carries a
[security.txt](https://github.com/neodyme-labs/solana-security-txt) with the
same contacts, readable from the binary on chain, and the same record is
published as the program's `security` metadata account from
`programs/earnout/security.json`, which is what explorers read first. To
report something, open an issue or write to hello@earnout.dev.

## Deployed

| Cluster | Program                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| devnet  | [`EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU`](https://explorer.solana.com/address/EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU?cluster=devnet) |

`npx tsx scripts/devnet-smoke.ts` runs one whole campaign against it: a test
token, create, fund, a channel, a real tagged transaction found by its
reference and verified, then settle and claim.

The deployed bytes are a reproducible build: the on-chain verification
record (the otter-verify PDA) names this repository and the commit, and
`solana-verify verify-from-repo` rebuilds that commit in Docker and gets
the same hash. Explorers colour a program "verified" only once OtterSec's
own worker has repeated that build; its devnet worker currently fails every
job before building (its registry lists no verified program at all), so on
devnet the badge stays grey however sound the build. On mainnet the same
steps light it up. To upgrade the program, build the binary the way the
verifier does (Docker and
[solana-verify](https://github.com/Ellipsis-Labs/solana-verifiable-build);
`anchor build` embeds local paths, so its output never matches a
verifier's), deploy it with Anchor's IDL step skipped, verify against the
pushed commit, and ask the verifier to confirm:

```bash
solana-verify build --library-name earnout
anchor deploy --provider.cluster devnet --no-idl
solana-verify verify-from-repo -u https://api.devnet.solana.com --program-id EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU https://github.com/Cryptonomist/earnout --library-name earnout --commit-hash $(git rev-parse HEAD) -k ~/.config/solana/id.json
curl -X POST https://verify-devnet.osec.io/verify-with-signer -H "content-type: application/json" -d '{"program_id":"EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU","signer":"HoYb6BCszJUY89WhKt2itTpxtLHMJKuoEwXwQPdbhtVu","repository":"","commit_hash":""}'
```

The last line is what `solana-verify remote submit-job` sends, aimed at the
devnet registry, which the CLI refuses to do itself; the job's progress is
at `https://verify-devnet.osec.io/status/<program id>`. The deploy wallet is
the upgrade authority and needs about 2.1 devnet SOL free for the upload
buffer, returned afterwards. Then the IDL on its own, since Anchor's own
upload step fails against the metadata account on devnet:

```bash
npx @solana-program/program-metadata write idl EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU target/idl/earnout.json -k ~/.config/solana/id.json --rpc https://api.devnet.solana.com
```

After changing `programs/earnout/security.json` (put the new commit in
`source_revision`), publish it the same way with `write security` in place
of `write idl` and the JSON file in place of the IDL.

## Status

Built for the Colosseum Crypto World's Fair hackathon (September to October
2026). The whole loop runs on devnet: a campaign created from the dashboard,
an influencer added by X handle, a click on their link, a tagged deposit on
`/demo`, the retention window, a settlement on chain, the influencer's claim and
the advertiser's refund.

Next, in order: a real pilot with Stonk Wars, a live Solana app, paying
its influencers from a hub campaign; a `close_campaign` instruction so rent
comes back once a campaign is settled and claimed; a per-batch settlement
account, so every evidence root is readable from an account and not only
from its transaction; an audit, then mainnet with USDC and the upgrade
authority behind a multisig.

## License

MIT
