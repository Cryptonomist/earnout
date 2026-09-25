"use client";

/* The partner side of a link, live: capture the token on arrival, show what
 * was kept, and check its signature in the browser. */

import { useEffect, useState } from "react";
import { captureTag, clearTag, pendingTagEntry } from "../../sdk/client";
import { verifyTag, type Tag } from "../../sdk/identity";

type State =
  | { phase: "loading" }
  | { phase: "none" }
  | { phase: "kept"; tag: Tag; savedAt: number; expiresAt: number; justArrived: boolean; valid: boolean | null };

const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
const explorer = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

/* Capture once per page load. The first capture takes the token out of the
 * URL, so a second one (React runs effects twice in development) would
 * report no arrival and overwrite the first. */
let arrivedThisLoad: boolean | null = null;

export function DemoTag() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    arrivedThisLoad ??= captureTag() !== null;
    const arrived = arrivedThisLoad;
    const entry = pendingTagEntry();
    if (!entry) {
      setState({ phase: "none" });
      return;
    }
    setState({ phase: "kept", ...entry, justArrived: arrived, valid: null });
    verifyTag(entry.tag).then((valid) => setState((s) => (s.phase === "kept" ? { ...s, valid } : s)));
  }, []);

  if (state.phase === "loading") return <div className="mt-10 h-64 animate-pulse rounded-2xl border border-line" />;

  if (state.phase === "none") {
    return (
      <section className="mt-10 rounded-2xl border border-line bg-card p-7">
        <h2 className="text-xl font-semibold tracking-tight">No Earnout tag on this device.</h2>
        <p className="mt-2 leading-7 text-muted">Come in through one of the demo campaign&apos;s links:</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {["demo-alice", "demo-bob"].map((slug) => (
            <a key={slug} href={`/r/${slug}`} className="rounded-full bg-ink px-5 py-2.5 font-mono text-sm text-paper hover:opacity-90">
              earnout.dev/r/{slug}
            </a>
          ))}
        </div>
      </section>
    );
  }

  const { tag, savedAt, expiresAt, justArrived, valid } = state;
  return (
    <>
      <section className="mt-10 rounded-2xl border border-line bg-card p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {justArrived ? "You arrived through an Earnout link." : "An Earnout tag is waiting on this device."}
          </h2>
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs ${
              valid === null ? "bg-line text-muted" : valid ? "bg-paid-soft text-paid" : "bg-unpaid-soft text-unpaid"
            }`}
          >
            {valid === null ? "checking signature" : valid ? "signature valid" : "signature invalid"}
          </span>
        </div>
        {justArrived && (
          <p className="mt-2 text-sm leading-6 text-muted">
            The token has already been taken out of the address bar, so it will not travel with a copied link.
          </p>
        )}

        <dl className="mt-6 divide-y divide-line border-y border-line font-mono text-sm">
          <Row label="Campaign">
            <a href={explorer(tag.campaign)} className="underline decoration-line underline-offset-2 hover:decoration-ink">
              {short(tag.campaign)}
            </a>
          </Row>
          <Row label="Signed by">
            <a href={explorer(tag.identity)} className="underline decoration-line underline-offset-2 hover:decoration-ink">
              {short(tag.identity)}
            </a>
          </Row>
          <Row label="Reference">{short(tag.reference)}</Row>
          <Row label="Channel">
            <span className="text-muted">sealed: only the campaign can read it</span>
          </Row>
          <Row label="Kept">{new Date(savedAt * 1000).toLocaleString()}</Row>
          <Row label="Lapses">{new Date(expiresAt * 1000).toLocaleString()}</Row>
        </dl>

        <button
          onClick={() => {
            clearTag();
            setState({ phase: "none" });
          }}
          className="mt-5 text-sm text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          Forget this tag
        </button>
      </section>

      <section className="mt-6 rounded-2xl border border-line p-7">
        <h2 className="text-lg font-semibold tracking-tight">What rides along with your deposit</h2>
        <ol className="mt-4 space-y-3 leading-7 text-muted">
          <li>
            <span className="font-mono text-ink">tag</span> on the Earnout program, carrying the campaign, the identity and
            the reference as read-only keys. It reads and writes nothing, so it cannot make the deposit fail.
          </li>
          <li>
            <span className="font-mono text-ink">memo</span> in the Solana Actions format:{" "}
            <span className="font-mono text-xs break-all text-ink">
              solana-action:{short(tag.identity)}:{short(tag.reference)}:&lt;signature&gt;
            </span>
          </li>
        </ol>
        <p className="mt-5 text-sm leading-6 text-muted">
          Making a tagged devnet deposit from this page is the next piece being built.
        </p>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
