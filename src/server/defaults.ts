/* What the hub fills in for every campaign it creates. The settler is the
 * key Earnout runs (scripts/settle.ts on a schedule); an advertiser who
 * wants to run their own names it with the SDK instead. Public keys only. */

const DEFAULT_SETTLER: Record<string, string> = {
  devnet: "2j1NH7DS7jYKxSPXgTWapqdq5SytkzwpQZ8vYJRG7hpz",
};

export function settlerAddress(cluster: string): string {
  return process.env.EARNOUT_SETTLER_ADDRESS ?? DEFAULT_SETTLER[cluster] ?? DEFAULT_SETTLER.devnet;
}
