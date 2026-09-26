# How Earnout fits together

Earnout pays marketing channels only for users who provably came through
them and stayed. This page is the map: the pieces, what each one is trusted
with, what lives on chain and what does not, and why.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Program (`programs/earnout`) | Solana, Anchor 1.2 | Holds each campaign's budget in a vault; records X links, verified channels and settlements; pays claims and refunds. |
| SDK (`sdk/`) | Browser and server, `@solana/kit` | Builds every instruction, writes and verifies the Solana Actions identity memo, encrypts references, keeps a tag in the browser for partners. |
| Link service (`src/app/r`) | Vercel | A disclosure page per link, then a redirect that mints a signed, single-use reference. |
| Demo partner (`src/app/demo`) | Vercel | Stands in for a partner app: a deposit with the tag on it, a guest wallet, a devnet faucet. |
| Settler (`settler/`, `scripts/settle.ts`) | GitHub Actions, every ten minutes | Finds tagged transactions, screens them, waits out retention, flags clusters, settles batches on chain, publishes counts. |
| Dashboard and records (`src/app/dashboard`, `src/app/creators`) | Vercel | Money read live from the chain; counts from the settler's published report; scorecards grouped by X account. |
| Creator hub (`src/app/creators`, `src/app/api/x`) | Vercel | Sign in with X, then link that account to a wallet under two signatures. |
| State | Supabase | The settler's private ledger (service role only) and its public report (counts only). |

## One conversion, start to finish

1. A creator's link, `/r/<slug>`, opens on a disclosure: who is paid, by
   whom, how much per user who stays, $0.00 for the click.
2. On Continue, the server mints a **reference**: 32 bytes of ciphertext
   only the campaign's key can open (AES, keyed per campaign from one
   master secret, with a MAC). It signs the reference with the **Earnout
   identity** and redirects to the partner with a token carrying campaign,
   identity, reference and signature.
3. The partner's page keeps the token (`captureTag`), and when the user
   makes the transaction that counts, appends two instructions
   (`tagInstructions`): the program's `tag`, which reads and writes nothing
   and so can never fail the user's transaction, and a Solana Actions
   identity memo, `solana-action:<identity>:<reference>:<signature>`. Any
   spec-following indexer can read it.
4. The settler finds the transaction by the campaign's address, checks the
   memo signature, opens the reference to its channel, confirms it is the
   reference's first use, inside the campaign dates and the click's
   attribution window, that it carries the campaign's qualifying action,
   and that the wallet is not an insider and has not converted before.
5. After the retention window it checks the wallet stayed, and flags wallets
   funded by a channel's payee or clusters funded by one quiet source.
6. Qualified conversions settle as a numbered batch per channel with a
   Merkle root of their signatures as evidence. The channel's payee claims;
   after the deadline the advertiser refunds what was never committed.

## What the program guarantees, and what it cannot

The program holds the money and the numbers that constrain it:

- a settlement pays exactly `conversions * payout`, never more than the
  budget left uncommitted; batches are numbered, so none can be recorded
  twice; nothing settles after the deadline or refunds before it;
- tokens leave the vault only to a channel's payee (`claim`) or back to the
  advertiser (`refund`); there is no admin, no fee, no sweep;
- every channel is a verified X account: `add_channel` requires the payee's
  `XLink` under the campaign's identity and that the account still belongs
  to that wallet (`XClaim`); the account is written onto the channel for good
  (`ChannelIdentity`), and payouts can only move to a wallet linked to the
  same account.

It cannot read the chain to check the settler's counting. The settler is
trusted to count honestly; the program holds it to the budget and the
deadline, and every batch ships with evidence the advertiser can check, so
overcounting is detectable if not preventable. That is the honest shape of
the trust: money is enforced, judgement is auditable.

## Trust boundaries

| Key | Held by | Can do |
| --- | --- | --- |
| Earnout identity | The site (Vercel) | Sign references; vouch for X links. Never holds funds. |
| Reference secret | The site and the settler | Mint and open references. Changing it orphans every link already clicked. |
| Settler key | GitHub Actions | Settle batches for campaigns that name it. Holds a little devnet SOL for fees. |
| Advertiser wallet | The advertiser | Create and fund campaigns, add channels, refund after the deadline. |
| Payee wallet | The creator | Claim, move payouts to another wallet linked to the same X account, unlink. |

Trust is per campaign: a campaign names its identity and its settler, and
trusts only X links its own identity vouched for. Nothing is global, so
nothing global can be captured.

## On chain, off chain, and why

**Public on chain:** that a wallet converted for a campaign; each channel's
counts of settled conversions and money earned and claimed; the X account
behind each channel; every settlement's evidence root.

**Deliberately not on chain:** which channel sent which wallet. The
reference is ciphertext, so the chain cannot link a user's wallet to a
creator. Under EU guidance a wallet address can be personal data, and a
public wallet-to-creator map would be a liability for everyone involved.
The settler's ledger, which holds that map, lives in a private table only
its own key can reach. Its published report carries counts and settlement
links, never a wallet, and a test holds it to that.

**Disclosure without leakage:** the disclosure page runs on earnout.dev, so
the visitor learns who is paid while the partner learns nothing about which
creator sent them.

## Exactly once

A batch is written to the ledger as pending before it is sent. The program
refuses a batch number it has seen, and the next pass reads the channel's
batch count from the chain to see whether the pending batch landed or must
be sent again, unchanged. A crash mid-send cannot pay anyone twice.

## Testing

- `tests/program.test.ts`: the program, against the real binary, in
  LiteSVM, through the same SDK the site uses. Every money path and guard,
  X links moving between wallets, the tag riding in a stranger's
  transaction.
- `tests/sdk.test.ts`: the reference cipher and the identity memo, checked
  both ways against the official `@solana/actions` package.
- `tests/settler.test.ts`: every rejection reason, retention and cluster
  decisions, budget caps, a simulated crash between write and send, and the
  report's privacy.
- `tests/links.test.ts`, `tests/x.test.ts`, `tests/faucet.test.ts`,
  `tests/scorecard.test.ts`, `tests/errors.test.ts`: the link service, the
  sealed X profile and the half-signed link transaction, the faucet's
  limits, scorecard aggregation, and what people are told when devnet says
  no.

`scripts/devnet-smoke.ts` runs one campaign end to end against the deployed
program.
