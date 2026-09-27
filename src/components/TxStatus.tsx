"use client";

/* Where a wallet action stands, shared by every button on the site that
 * sends a transaction: the label while it works, and the line under it
 * once it is done or has failed. */

import { explorerTx } from "@/lib/explorer";

export type TxStatus =
  | { kind: "idle" }
  | { kind: "working"; what: string }
  | { kind: "done"; text: string; tx: string }
  | { kind: "error"; message: string };

export const IDLE: TxStatus = { kind: "idle" };

export function TxStatusLine({ status }: { status: TxStatus }) {
  if (status.kind === "done") {
    return (
      <p className="mt-3 text-sm leading-6">
        <span className="text-paid" aria-hidden="true">
          ✓{" "}
        </span>
        {status.text}{" "}
        <a href={explorerTx(status.tx)} className="underline decoration-line underline-offset-2 hover:decoration-ink">
          Transaction
        </a>
      </p>
    );
  }
  if (status.kind === "error") return <p className="mt-3 text-sm leading-6 text-unpaid">{status.message}</p>;
  return null;
}
