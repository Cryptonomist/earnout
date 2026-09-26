export const SITE = {
  name: "Earnout",
  url: "https://earnout.dev",
  tagline: "Pay for users who stay",
  description:
    "Creator marketing on Solana that pays only for users who stay. Every creator gets a link; the project pays for each user who joins through it and is still active later. Unspent budget comes back.",
  github: "https://github.com/Cryptonomist/earnout",
  contact: "mailto:hello@earnout.dev?subject=Earnout%20pilot",
};

/* Every number on the landing page, with where it came from. A figure that
 * is a company's own claim says so. */
export const STATS = [
  {
    figure: "88%",
    text: "of 62 airdropped tokens fell in price, most within 15 days of launch.",
    source: "Keyrock, 2024",
    href: "https://keyrock.com/airdrops-in-the-barren-desert/",
  },
  {
    figure: "<5 of 160+",
    text: "paid crypto influencers in one leaked 2025 campaign disclosed the deal.",
    source: "The Block, on ZachXBT's leak",
    href: "https://www.theblock.co/news/business/2025-09-01-zachxbt-says-over-100-crypto-influencers-accepted-promo-deals-without-disclosing-paid-ads-368956",
  },
  {
    figure: "$150 to $350",
    text: "is what a crypto ad network quotes per first-time depositor.",
    source: "Blockchain-Ads, self-reported",
    href: "https://www.blockchain-ads.com/blockchain-advertising",
  },
  {
    figure: "Jan 2026",
    text: "X cut off apps that pay people to post. Paying for attention stopped working.",
    source: "CoinDesk",
    href: "https://www.coindesk.com/business/2026/01/15/kaito-to-sunset-yaps-as-x-cracks-down-on-infofi-apps-token-falls-17",
  },
] as const;
