// Next's own rules (core-web-vitals and TypeScript) over the whole repo,
// including the settler, SDK and scripts, which Next would otherwise skip.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "target/**", "node_modules/**", "var/**", "sdk/generated.ts", "next-env.d.ts"],
  },
];

export default config;
