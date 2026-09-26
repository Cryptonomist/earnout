/* What a person is told when a wallet or devnet says no. Kit keeps the
 * useful part of an RPC failure in the error's context, and the message it
 * shows by default is "Solana error #-32002; Decode this error by
 * running...", which nobody can act on. */

import { expect } from "chai";
import { describeError } from "../src/lib/browser-rpc.ts";

class KitLikeError extends Error {
  constructor(
    message: string,
    public context: Record<string, unknown>,
  ) {
    super(message);
  }
}

describe("describeError", () => {
  it("reads a preflight failure for an unfunded wallet out of the error context", () => {
    const e = new KitLikeError("Solana error #-32002; Decode this error by running `npx @solana/errors decode -- -32002 'X19...'`", {
      __code: -32002,
      __serverMessage: "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.",
      accounts: null,
      logs: [],
    });
    expect(describeError(e)).to.equal("This wallet does not have enough devnet SOL for the rent and fee.");
    expect(describeError(new KitLikeError("Solana error #-32002", { err: "AccountNotFound" }))).to.include("devnet SOL");
  });

  it("still recognises a wallet's refusal and an expired blockhash", () => {
    expect(describeError(new Error("User rejected the request."))).to.include("declined");
    expect(describeError(new Error("Blockhash not found"))).to.include("expired");
    expect(describeError(new Error("HTTP 429 Too Many Requests"))).to.include("rate-limiting");
    expect(describeError(new Error("something odd"))).to.equal("something odd");
    expect(describeError("plain string")).to.equal("Something went wrong. Try again.");
  });
});
