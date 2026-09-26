import type { NextConfig } from "next";

/* The same security headers Stonk Wars ships. Framing is refused outright,
 * since the app side of this site will ask wallets to sign. A full
 * Content-Security-Policy is not here yet; the directives below constrain
 * nothing the pages need. */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  /* The hub lived at /creators until the site settled on the word
   * influencer. Links already shared, and the builder updates, keep working. */
  async redirects() {
    return [
      { source: "/creators", destination: "/influencers", permanent: true },
      { source: "/creators/:path*", destination: "/influencers/:path*", permanent: true },
      { source: "/api/creators/:path*", destination: "/api/influencers/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
