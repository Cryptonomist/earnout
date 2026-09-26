"use client";

import { useEffect, useState } from "react";

/* How long until a retention window closes, ticking. When it has, say who
 * decides next. */
export function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, endsAt - now);
  if (left === 0) {
    return (
      <p className="mt-6 rounded-xl bg-paid-soft px-4 py-3 text-sm leading-6 text-paid">
        Your stay period has ended. Earnout&apos;s next check decides, and the KOL&apos;s receipt updates on the dashboard.
      </p>
    );
  }
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <p className="mt-6 rounded-xl border border-line px-4 py-3 text-sm leading-6" aria-live="off">
      Your stay period ends in <span className="font-mono text-base tabular-nums">{m}:{String(s).padStart(2, "0")}</span>. Keep at
      least 0.005 SOL in the wallet until then and you count as stayed.
    </p>
  );
}
