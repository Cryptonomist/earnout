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

## Layout

| Path | What |
| --- | --- |
| `programs/earnout` | The Anchor program (Anchor 1.2.0) |
| `sdk/` | TypeScript SDK on `@solana/kit`: instruction builders, account decoders, the Action Identity memo, tag tokens |
| `sdk/reference.ts` | The reference cipher (server only) |
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
2026). Program and SDK are in place; the link service, indexer, settler and
dashboard are next.

## License

MIT
