"use client";

/* The demo faucets: one click for 0.02 devnet SOL, or for $1,000 of the
 * devnet test dollars campaigns pay in. Offered wherever a wallet is about
 * to pay rent, a fee or a budget on devnet and has too little. The Solana
 * faucet is the fallback for SOL whenever ours says no. */

import { useState } from "react";
import { sleep } from "@/lib/browser-rpc";
import { DEMO } from "@/lib/demo";

const KINDS = {
  sol: {
    endpoint: "/api/faucet",
    button: "Get 0.02 devnet SOL",
    sending: "Sending devnet SOL...",
    done: "0.02 devnet SOL is on its way.",
    refused: "The demo faucet said no.",
    silent: "The demo faucet did not answer.",
  },
  usd: {
    endpoint: "/api/faucet/usd",
    button: "Get $1,000 in test dollars",
    sending: "Minting test dollars...",
    done: "$1,000.00 in test dollars is on its way.",
    refused: "The test dollar faucet said no.",
    silent: "The test dollar faucet did not answer.",
  },
} as const;

export function Faucet({
  wallet,
  onFunded,
  need,
  kind = "sol",
}: {
  wallet: string;
  onFunded: () => Promise<void>;
  need: string;
  kind?: keyof typeof KINDS;
}) {
  const t = KINDS[kind];
  const [state, setState] = useState<{ kind: "idle" | "asking" } | { kind: "done" } | { kind: "refused"; message: string }>({
    kind: "idle",
  });

  async function ask() {
    setState({ kind: "asking" });
    try {
      const res = await fetch(t.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!body.ok) {
        setState({ kind: "refused", message: body.message ?? t.refused });
        return;
      }
      setState({ kind: "done" });
      for (let i = 0; i < 5; i++) {
        await onFunded();
        await sleep(1_500);
      }
    } catch {
      setState({ kind: "refused", message: t.silent });
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
          {t.done}
        </p>
      ) : (
        <button
          onClick={() => void ask()}
          disabled={state.kind === "asking"}
          className="mt-3 rounded-full border border-ink px-4 py-2 font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          {state.kind === "asking" ? t.sending : t.button}
        </button>
      )}
      {state.kind === "refused" && <p className="mt-2 text-unpaid">{state.message}</p>}
      <p className="mt-3 text-muted">
        {kind === "sol" ? (
          <>
            Or use the{" "}
            <a href={DEMO.faucet} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Solana faucet
            </a>
            , then{" "}
          </>
        ) : (
          <>Sent some from elsewhere? </>
        )}
        <button onClick={() => void onFunded()} className="underline underline-offset-2">
          check again
        </button>
        .
      </p>
    </div>
  );
}
