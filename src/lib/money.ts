/* Amounts and durations, the same on the server and in the browser. */

export function money(n: bigint, decimals: number): string {
  const v = Number(n) / 10 ** decimals;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function duration(secs: number): string {
  if (secs % 86_400 === 0) return `${secs / 86_400} day${secs === 86_400 ? "" : "s"}`;
  if (secs % 3_600 === 0) return `${secs / 3_600} hour${secs === 3_600 ? "" : "s"}`;
  return `${Math.round(secs / 60)} minute${secs === 60 ? "" : "s"}`;
}

/** "12.5" with 6 decimals is 12500000n; null for anything that is not a
 * plain positive decimal with at most `decimals` places. */
export function toBaseUnits(textAmount: string, decimals: number): bigint | null {
  const m = /^\s*([0-9]+)(?:\.([0-9]*))?\s*$/.exec(textAmount);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals) return null;
  const n = BigInt(m[1] + frac);
  return n > 0n ? n : null;
}

/** 12500000n with 6 decimals is "12.5". */
export function fromBaseUnits(n: bigint, decimals: number): string {
  const s = n.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
