import Link from "next/link";

/* The hero picture: one influencer's payout, printed. With `live` it is a
 * real one from devnet (server/hero.ts picks it), and the slip says LIVE.
 * Without it, the printed example: 412 users came through the link, 225
 * had left by day 30 and 41 more were one bot farm, which leaves 146 who
 * stayed at $4.00 each. The other 266 cost nothing. */

export type LiveReceipt = {
  campaign: string;
  influencer: string;
  mustStay: string;
  sent: number;
  gone: number;
  flagged: number;
  stayed: number;
  price: string;
  paid: string;
  notPaidUsers: number;
  notPaid: string;
  proof: string;
  payouts: number;
  href: string;
};

const EXAMPLE: LiveReceipt = {
  campaign: "Perps launch, wk 1",
  influencer: "@sol_sarah",
  mustStay: "30 days",
  sent: 412,
  gone: 225,
  flagged: 41,
  stayed: 146,
  price: "$4.00",
  paid: "$584.00",
  notPaidUsers: 266,
  notPaid: "$1,064.00",
  proof: "7f3a...c91e",
  payouts: 3,
  href: "/dashboard",
};

export function Receipt({ live }: { live?: LiveReceipt | null }) {
  const r = live ?? EXAMPLE;
  return (
    <figure className="relative mx-auto w-full max-w-[380px] rotate-[1.25deg] drop-shadow-[0_18px_30px_rgba(22,21,15,0.14)]">
      <div className="torn bg-card px-7 pt-7 pb-12 font-mono text-[13px] leading-6 text-ink">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-[0.2em] text-muted">EARNOUT</div>
            <div className="text-base font-semibold tracking-tight">Payout receipt</div>
          </div>
          {live ? (
            <Link
              href={live.href}
              className="flex items-center gap-1.5 rounded-sm border border-paid px-1.5 text-[10px] tracking-[0.15em] text-paid"
            >
              <span className="live-dot size-1.5 rounded-full bg-paid" aria-hidden="true" />
              LIVE
            </Link>
          ) : (
            <span className="rounded-sm border border-line px-1.5 text-[10px] tracking-[0.15em] text-muted">
              EXAMPLE
            </span>
          )}
        </div>

        <dl className="mt-5 space-y-0.5">
          <Row label="Campaign" value={r.campaign} />
          <Row label="Influencer" value={r.influencer} />
          <Row label="Must stay" value={r.mustStay} />
        </dl>

        <hr className="rule my-4" />

        <dl className="space-y-0.5">
          <Row label="Users sent" value={String(r.sent)} />
          <Row label="Left early" value={r.gone ? `-${r.gone}` : "0"} tone={r.gone ? "unpaid" : undefined} />
          <Row
            label="Flagged as bots"
            value={r.flagged ? `-${r.flagged}` : "0"}
            tone={r.flagged ? "unpaid" : undefined}
          />
        </dl>

        <hr className="rule my-4" />

        <div className="relative">
          <dl className="space-y-0.5">
            <Row label="Stayed" value={String(r.stayed)} strong />
            <Row label={`x ${r.price} per user`} value="" />
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
          <span className="font-semibold">Paid to influencer</span>
          <span className="text-base font-semibold">{r.paid}</span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between px-2 text-unpaid">
          <span>
            Not paid, {r.notPaidUsers} user{r.notPaidUsers === 1 ? "" : "s"}
          </span>
          <span>{r.notPaid}</span>
        </div>

        <hr className="rule my-4" />

        <dl className="space-y-0.5 text-[11px] text-muted">
          <Row label="Proof" value={r.proof} />
          <Row label="Paid on" value={`Solana, ${r.payouts} payout${r.payouts === 1 ? "" : "s"}`} />
        </dl>
      </div>
      <figcaption className="sr-only">
        {live ? "A live payout on Solana devnet" : "An example payout"}: {r.sent} users sent, {r.stayed} still active
        and not bots after {r.mustStay}, {r.paid} paid to the influencer and {r.notPaid} never spent.
      </figcaption>
    </figure>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: "unpaid"; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-4 ${tone === "unpaid" ? "text-unpaid" : ""} ${strong ? "font-semibold" : ""}`}
    >
      <dt className={tone || strong ? "" : "text-muted"}>{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}
