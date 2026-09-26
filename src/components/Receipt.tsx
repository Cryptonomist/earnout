/* The hero picture: one KOL's payout, printed. The numbers are an
 * example and the slip says so; they are chosen to add up. 412 users came
 * through the link, 225 had left by day 30 and 41 more were one bot farm,
 * which leaves 146 who stayed at $4.00 each. The other 266 cost nothing. */

const ROWS: { label: string; value: string; tone?: "unpaid" }[] = [
  { label: "Users sent", value: "412" },
  { label: "Left before day 30", value: "-225", tone: "unpaid" },
  { label: "Flagged as bots", value: "-41", tone: "unpaid" },
];

export function Receipt() {
  return (
    <figure className="relative mx-auto w-full max-w-[380px] rotate-[1.25deg] drop-shadow-[0_18px_30px_rgba(22,21,15,0.14)]">
      <div className="torn bg-card px-7 pt-7 pb-12 font-mono text-[13px] leading-6 text-ink">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-[0.2em] text-muted">EARNOUT</div>
            <div className="text-base font-semibold tracking-tight">Payout receipt</div>
          </div>
          <span className="rounded-sm border border-line px-1.5 text-[10px] tracking-[0.15em] text-muted">EXAMPLE</span>
        </div>

        <dl className="mt-5 space-y-0.5">
          <Row label="Campaign" value="Perps launch, wk 1" />
          <Row label="KOL" value="@sol_sarah" />
          <Row label="Must stay" value="30 days" />
        </dl>

        <hr className="rule my-4" />

        <dl className="space-y-0.5">
          {ROWS.map((r) => (
            <Row key={r.label} {...r} />
          ))}
        </dl>

        <hr className="rule my-4" />

        <div className="relative">
          <dl className="space-y-0.5">
            <Row label="Stayed" value="146" strong />
            <Row label="x $4.00 per user" value="" />
          </dl>
          {/* In the gap between labels and figures, where it hides nothing. */}
          <div
            aria-hidden="true"
            className="absolute top-1 left-[46%] -rotate-12 rounded-md border-2 border-paid px-2 text-base font-bold tracking-[0.2em] text-paid opacity-80"
          >
            PAID
          </div>
        </div>

        <div className="mt-4 flex items-baseline justify-between rounded-sm bg-paid-soft px-2 py-1.5 text-paid">
          <span className="font-semibold">Paid to KOL</span>
          <span className="text-base font-semibold">$584.00</span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between px-2 text-unpaid">
          <span>Not paid, 266 users</span>
          <span>$1,064.00</span>
        </div>

        <hr className="rule my-4" />

        <dl className="space-y-0.5 text-[11px] text-muted">
          <Row label="Proof" value="7f3a...c91e" />
          <Row label="Paid on" value="Solana" />
        </dl>
      </div>
      <figcaption className="sr-only">
        An example payout: 412 users sent, 146 still active and not bots after 30 days, $584 paid to the KOL and
        $1,064 never spent.
      </figcaption>
    </figure>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: "unpaid"; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${tone === "unpaid" ? "text-unpaid" : ""} ${strong ? "font-semibold" : ""}`}>
      <dt className={tone || strong ? "" : "text-muted"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
