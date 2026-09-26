/* A creator's record across every campaign, from counts only.
 *
 * Each verified channel contributes what the chain says (users paid for,
 * money earned and claimed) and what the settler's public report says
 * (users tagged, gone, flagged). Channels are grouped by the X account they
 * were created for, not by wallet, so the record follows the person. No
 * wallet of a user appears anywhere in it. Pure, so it can be tested. */

export type ChannelFacts = {
  campaign: string;
  campaignName: string;
  slug: string | null;
  index: number;
  /** The X account the channel was created for. */
  xId: string;
  handle: string;
  payee: string;
  decimals: number;
  payout: bigint;
  /** From the chain: conversions settled, and the money. */
  stayed: bigint;
  earned: bigint;
  claimed: bigint;
  /** From the settler's report; zeros when it has not reported yet. */
  reported: boolean;
  tagged: number;
  waiting: number;
  qualified: number;
  gone: number;
  flagged: number;
  otherRejected: number;
};

export type Scorecard = {
  xId: string;
  handle: string;
  /** Every wallet the person has been paid to, latest first. */
  payees: string[];
  campaigns: number;
  tagged: number;
  pending: number;
  stayed: number;
  gone: number;
  flagged: number;
  otherRejected: number;
  /** Of the users whose window has closed, the share who stayed; null
   * until anyone has. */
  stayRate: number | null;
  /** Of the users whose window has closed, the share flagged. */
  flagRate: number | null;
  /** Money, summed only when every campaign pays in the same decimals;
   * otherwise null and the rows carry it. */
  earned: bigint | null;
  claimed: bigint | null;
  decimals: number | null;
  rows: ChannelFacts[];
};

export function buildScorecards(facts: ChannelFacts[]): Scorecard[] {
  const byX = new Map<string, ChannelFacts[]>();
  for (const f of facts) byX.set(f.xId, [...(byX.get(f.xId) ?? []), f]);

  const cards: Scorecard[] = [];
  for (const [xId, rows] of byX) {
    const sum = (pick: (r: ChannelFacts) => number) => rows.reduce((n, r) => n + pick(r), 0);
    const stayed = Number(rows.reduce((n, r) => n + r.stayed, 0n));
    const gone = sum((r) => r.gone);
    const flagged = sum((r) => r.flagged);
    const otherRejected = sum((r) => r.otherRejected);
    const decided = stayed + gone + flagged + otherRejected;
    const decimals = new Set(rows.map((r) => r.decimals));
    const oneToken = decimals.size === 1;
    cards.push({
      xId,
      handle: rows[rows.length - 1].handle,
      payees: [...new Set(rows.map((r) => r.payee).reverse())],
      campaigns: new Set(rows.map((r) => r.campaign)).size,
      tagged: sum((r) => r.tagged),
      pending: sum((r) => r.waiting + r.qualified),
      stayed,
      gone,
      flagged,
      otherRejected,
      stayRate: decided ? stayed / decided : null,
      flagRate: decided ? flagged / decided : null,
      earned: oneToken ? rows.reduce((n, r) => n + r.earned, 0n) : null,
      claimed: oneToken ? rows.reduce((n, r) => n + r.claimed, 0n) : null,
      decimals: oneToken ? rows[0].decimals : null,
      rows,
    });
  }
  return cards.sort((a, b) => b.stayed - a.stayed || b.tagged - a.tagged || a.handle.localeCompare(b.handle));
}

/** By handle, ignoring case, or by X id. */
export function findScorecard(cards: Scorecard[], key: string): Scorecard | null {
  const k = key.replace(/^@/, "").toLowerCase();
  return cards.find((c) => c.handle.toLowerCase() === k || c.xId === k) ?? null;
}
