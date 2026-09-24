import { ImageResponse } from "next/og";

/* The card X and Telegram show when someone shares earnout.dev: the promise
 * on the left, a slip of the receipt on the right. */

export const alt = "Earnout: pay for users who stay";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f4f2eb";
const CARD = "#fffdf6";
const INK = "#16150f";
const MUTED = "#625e53";
const PAID = "#0b7349";
const UNPAID = "#a9412b";

export default function OpengraphImage() {
  const row = (label: string, value: string, color = INK) => (
    <div style={{ display: "flex", justifyContent: "space-between", color, fontSize: 26 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: PAPER, padding: 72, gap: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1.2 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: INK }}>earnout</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 92, fontWeight: 700, color: INK, lineHeight: 1.02, letterSpacing: -3 }}>
              Pay for users who stay.
            </div>
            <div style={{ fontSize: 30, color: MUTED, marginTop: 28, lineHeight: 1.35 }}>
              On-chain attribution for Solana. Pay only for wallets that are still there when the window closes.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: MUTED }}>earnout.dev</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 0.8,
            background: CARD,
            padding: 40,
            gap: 10,
            fontFamily: "monospace",
            transform: "rotate(2deg)",
            boxShadow: "0 20px 40px rgba(22,21,15,0.15)",
          }}
        >
          <div style={{ display: "flex", fontSize: 20, color: MUTED, letterSpacing: 4 }}>SETTLEMENT RECEIPT</div>
          <div style={{ display: "flex", height: 16 }} />
          {row("Wallets tagged", "412")}
          {row("Gone by day 30", "-225", UNPAID)}
          {row("One cluster", "-41", UNPAID)}
          <div style={{ display: "flex", height: 2, background: "#e0dbcd", margin: "12px 0" }} />
          {row("Qualified", "146")}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: PAID,
              fontSize: 30,
              fontWeight: 700,
              marginTop: 18,
            }}
          >
            <span>PAID</span>
            <span>$584.00</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
