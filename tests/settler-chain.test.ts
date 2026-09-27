/* The settler's chain reader against a fake RPC: what it does when a node
 * is behind, how it pages through a wallet's history, and how it tells a
 * refused settlement from one whose fate is unknown. */

import { expect } from "chai";
import {
  SolanaError,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  address,
  type Address,
} from "@solana/kit";
import { fetchParsed, programActivity, refusedByProgram, withRetry, type Rpc } from "../settler/chain.ts";

const PROGRAM = address("EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU");
const WALLET = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");

/** A getTransaction answer with the fields the parser reads. */
const rawTx = (signature: string, program: Address) => ({
  slot: 1,
  blockTime: 1_800_000_000,
  meta: { err: null },
  transaction: {
    signatures: [signature],
    message: { accountKeys: [WALLET, program], instructions: [{ programIdIndex: 1, accounts: [], data: "" }] },
  },
});

/** The two RPC methods under test, scripted. `getTransaction` answers from
 * a queue per signature; `getSignaturesForAddress` from pages. */
function fakeRpc(opts: { transactions?: Record<string, unknown[]>; pages?: unknown[][] }) {
  const calls = { getTransaction: 0, getSignaturesForAddress: [] as unknown[] };
  const rpc = {
    getTransaction(signature: string) {
      return {
        async send() {
          calls.getTransaction++;
          const queue = opts.transactions?.[signature] ?? [null];
          return queue.length > 1 ? queue.shift() : queue[0];
        },
      };
    },
    getSignaturesForAddress(_addr: Address, config: unknown) {
      return {
        async send() {
          calls.getSignaturesForAddress.push(config);
          const page = calls.getSignaturesForAddress.length - 1;
          return opts.pages?.[page] ?? [];
        },
      };
    },
  };
  return { rpc: rpc as unknown as Rpc, calls };
}

describe("settler chain reader", () => {
  it("asks again for a transaction the node does not have yet, then gives up", async () => {
    const sig = "5".repeat(87);
    const behind = fakeRpc({ transactions: { [sig]: [null, rawTx(sig, PROGRAM)] } });
    const tx = await fetchParsed(behind.rpc, sig, 2);
    expect(tx?.signature).to.equal(sig);
    expect(behind.calls.getTransaction).to.equal(2);

    const never = fakeRpc({});
    expect(await fetchParsed(never.rpc, sig, 2)).to.equal(null);
    expect(never.calls.getTransaction).to.equal(2);
  }).timeout(10_000);

  it("retries only what a later try could fix", async () => {
    let tries = 0;
    const flaky = async () => {
      if (++tries < 3) throw new Error("429 Too Many Requests");
      return "ok";
    };
    expect(await withRetry(flaky, 5)).to.equal("ok");
    expect(tries).to.equal(3);

    tries = 0;
    const broken = async () => {
      tries++;
      throw new Error("bad request");
    };
    await withRetry(broken, 5).catch(() => {});
    expect(tries).to.equal(1);
  }).timeout(10_000);

  it("counts program activity inside the window, paging back, and stops when it has enough", async () => {
    const OTHER = address("11111111111111111111111111111111");
    const after = 1_800_000_000;
    const until = after + 7 * 86_400;
    const sigs = Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(87));
    // Newest first, as the RPC returns them: one too new, three in the
    // window (two on the program), one failed, one too old.
    const entry = (signature: string, blockTime: number, err: unknown = null) => ({ signature, blockTime, err });
    const page1 = [
      entry(sigs[0], until + 1),
      entry(sigs[1], until - 10),
      entry(sigs[2], until - 20),
      entry(sigs[3], until - 30, "failed"),
    ];
    const page2 = [entry(sigs[4], after + 1), entry(sigs[5], after - 1)];
    const transactions = {
      [sigs[1]]: [rawTx(sigs[1], PROGRAM)],
      [sigs[2]]: [rawTx(sigs[2], OTHER)],
      [sigs[3]]: [rawTx(sigs[3], PROGRAM)],
      [sigs[4]]: [rawTx(sigs[4], PROGRAM)],
      [sigs[5]]: [rawTx(sigs[5], PROGRAM)],
    };

    // Pages are 1000 long in production; here a full first page is faked
    // by padding it, so the reader asks for a second one.
    const padding = Array.from({ length: 1000 - page1.length }, (_, i) => entry(`p${i}`, until - 40, "failed"));
    const full = fakeRpc({ transactions, pages: [[...page1, ...padding], page2] });
    expect(await programActivity(full.rpc, WALLET, PROGRAM, after, until)).to.equal(2);
    expect(full.calls.getSignaturesForAddress.length).to.equal(2);
    expect((full.calls.getSignaturesForAddress[1] as { before: string }).before).to.equal("p995");

    const enough = fakeRpc({ transactions, pages: [[...page1, ...padding], page2] });
    expect(await programActivity(enough.rpc, WALLET, PROGRAM, after, until, 1)).to.equal(1);
    expect(enough.calls.getSignaturesForAddress.length).to.equal(1);
  });

  it("tells a settlement the program refused from one whose fate is unknown", () => {
    const custom = new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, { code: 6009, index: 1 });
    const preflight = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
      __serverMessage: "Transaction simulation failed",
    } as never);
    const wrapped = new Error("Transaction failed", { cause: custom });
    const blockhash = new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND);
    for (const refused of [custom, preflight, wrapped, blockhash])
      expect(refusedByProgram(refused), String(refused)).to.equal(true);

    const expired = new SolanaError(SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, {
      currentBlockHeight: 2n,
      lastValidBlockHeight: 1n,
    });
    const duplicate = new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED);
    const network = new Error("fetch failed");
    for (const unknown of [expired, duplicate, network, null, undefined])
      expect(refusedByProgram(unknown), String(unknown)).to.equal(false);
  });
});
