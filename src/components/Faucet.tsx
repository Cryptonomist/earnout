"use client";

/* The demo faucet: one click for 0.02 devnet SOL, and the Solana faucet as
 * the fallback whenever it says no. Offered wherever a wallet on devnet is
 * about to pay rent or a fee and has too little. */

import { useState } from "react";
import { sleep } from "@/lib/browser-rpc";
import { DEMO } from "@/lib/demo";

export function Faucet({ wallet, onFunded, need }: { wallet: string; onFunded: () => Promise<void>; need: string }) {
  const [state, setState] = useState<{ kind: "idle" | "asking" } | { kind: "done" } | { kind: "refused"; message: string }>({
    kind: "idle",
  });

  async function ask() {
    setState({ kind: "asking" });
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!body.ok) {
        setState({ kind: "refused", message: body.message ?? "The demo faucet said no." });
        return;
      }
      setState({ kind: "done" });
      for (let i = 0; i < 5; i++) {
        await onFunded();
        await sleep(1_500);
      }
    } catch {
      setState({ kind: "refused", message: "The demo faucet did not answer." });
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-4 text-sm leading-6">
      <p>{need}</p>
      {state.kind === "done" ? (
        <p className="mt-2">
          <span className="text-paid" aria-hidden="true">
            ✓{" "}
          </span>
          0.02 devnet SOL is on its way.
        </p>
      ) : (
        <button
          onClick={() => void ask()}
          disabled={state.kind === "asking"}
          className="mt-3 rounded-full border border-ink px-4 py-2 font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          {state.kind === "asking" ? "Sending devnet SOL..." : "Get 0.02 devnet SOL"}
        </button>
      )}
      {state.kind === "refused" && <p className="mt-2 text-unpaid">{state.message}</p>}
      <p className="mt-3 text-muted">
        Or use the{" "}
        <a href={DEMO.faucet} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Solana faucet
        </a>
        , then{" "}
        <button onClick={() => void onFunded()} className="underline underline-offset-2">
          check again
        </button>
        .
      </p>
    </div>
  );
}
