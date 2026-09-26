/* Social cards: the promise in large type and a payout receipt, for the
 * slots that crop a banner badly (Colosseum's update card, X posts, link
 * previews). Text is set in the site's own fonts (Geist, Geist Mono) and
 * converted to paths, so the files need no font.
 *
 *   npx tsx scripts/card.ts
 *
 * Writes public/brand/card-1200x800.png (3:2, for update cards and link
 * previews) and card-1200x1200.png (square, for X and avatars-with-text).
 * Everything that matters sits inside the middle of each, so a crop to
 * square or to 16:9 keeps the words. The headline is sized to fit its
 * column, so a longer word never runs into the receipt. */

import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const OUT = path.resolve("public/brand");
const FONTS = path.resolve("node_modules/geist/dist/fonts");
const semi = opentype.loadSync(path.join(FONTS, "geist-sans/Geist-SemiBold.ttf"));
const sans = fs.existsSync(path.join(FONTS, "geist-sans/Geist-Medium.ttf"))
  ? opentype.loadSync(path.join(FONTS, "geist-sans/Geist-Medium.ttf"))
  : semi;
const mono = opentype.loadSync(path.join(FONTS, "geist-mono/GeistMono-Regular.ttf"));
const monoBold = opentype.loadSync(path.join(FONTS, "geist-mono/GeistMono-SemiBold.ttf"));

const INK = "#16150f";
const PAPER = "#f4f2eb";
const CARD = "#fffdf6";
const LINE = "#e0dbcd";
const MUTED = "#625e53";
const PAID = "#0b7349";
const PAID_SOFT = "#e3efe8";
const UNPAID = "#a9412b";

// The mark, as scripts/brand.ts draws it.
const SLIP = "M5.5 2h13A1.5 1.5 0 0 1 20 3.5V22l-2.67-1.6L14.67 22 12 20.4 9.33 22l-2.66-1.6L4 22V3.5A1.5 1.5 0 0 1 5.5 2Z";
const TICK = "m8.25 11.25 2.5 2.5 5-5";

type Font = opentype.Font;
const opts = (tracking: number) => ({ kerning: true, letterSpacing: tracking });

/** Text as a path, left-aligned at x with its baseline at y. */
function text(font: Font, s: string, x: number, y: number, size: number, fill: string, tracking = 0): string {
  return `<path d="${font.getPath(s, x, y, size, opts(tracking)).toPathData(2)}" fill="${fill}"/>`;
}

function width(font: Font, s: string, size: number, tracking = 0): number {
  return font.getAdvanceWidth(s, size, opts(tracking));
}

/** Right-aligned: the text ends at xRight. */
function rtext(font: Font, s: string, xRight: number, y: number, size: number, fill: string): string {
  return text(font, s, xRight - width(font, s, size), y, size, fill);
}

function logo(x: number, y: number, h: number, fill: string): string {
  const scale = h / 24;
  const wordSize = 13.6 / (semi.tables.os2.sxHeight / semi.unitsPerEm);
  const word = semi.getPath("earnout", 30, 12 + 6.8, wordSize, opts(-0.015)).toPathData(2);
  return `<g transform="translate(${x} ${y}) scale(${scale})"><defs><mask id="lm"><path d="${SLIP}" fill="#fff"/><path d="${TICK}" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><rect width="24" height="24" fill="${fill}" mask="url(#lm)"/><path d="${word}" fill="${fill}"/></g>`;
}

/** A slip with a torn bottom edge. */
function slipPath(x: number, y: number, w: number, h: number): string {
  const tooth = 14;
  const depth = 8;
  let d = `M${x} ${y}h${w}v${h - depth}`;
  let cx = x + w;
  let up = true;
  while (cx > x) {
    cx = Math.max(x, cx - tooth);
    d += `L${cx} ${up ? y + h : y + h - depth}`;
    up = !up;
  }
  return `${d}Z`;
}

/** The example receipt from the site's hero: 412 users, 146 stayed. */
function receipt(x: number, y: number, w: number, tilt: number): string {
  const pad = 30;
  const size = 25;
  const lh = 42;
  const left = x + pad;
  const right = x + w - pad;
  let cy = y + pad + 30;
  const rows: string[] = [];
  const row = (label: string, value: string, fill = INK, font: Font = mono, labelFill = MUTED) => {
    rows.push(text(font, label, left, cy, size, labelFill), rtext(font, value, right, cy, size, fill));
    cy += lh;
  };
  const rule = () => {
    cy += 6;
    rows.push(`<path d="M${left} ${cy - 22}H${right}" stroke="${LINE}" stroke-width="2" stroke-dasharray="6 5"/>`);
  };

  rows.push(text(mono, "EARNOUT", left, cy - 28, 15, MUTED, 0.25));
  rows.push(text(monoBold, "Payout receipt", left, cy + 4, 28, INK));
  cy += 52;
  rule();
  row("Users sent", "412");
  row("Left early", "-225", UNPAID, mono, UNPAID);
  row("Flagged as bots", "-41", UNPAID, mono, UNPAID);
  rule();
  row("Stayed", "146", INK, monoBold, INK);
  row("x $4.00 per user", "");
  // The green bar: what the influencer was paid.
  const barY = cy - 30;
  rows.push(`<rect x="${left - 8}" y="${barY}" width="${right - left + 16}" height="${lh + 2}" rx="4" fill="${PAID_SOFT}"/>`);
  cy += 6;
  row("Paid out", "$584.00", PAID, monoBold, PAID);
  row("Not paid: 266", "$1,064.00", UNPAID, mono, UNPAID);
  const h = cy - y + pad - 10;

  // The stamp, over the stayed row. Tracking is in em.
  const sx = left + 150;
  const sy = y + pad + 30 + 52 + 6 + lh * 3 + 6 + 10;
  const stamp = `<g transform="rotate(-12 ${sx + 60} ${sy})"><rect x="${sx}" y="${sy - 24}" width="120" height="44" rx="6" fill="none" stroke="${PAID}" stroke-width="4" opacity="0.85"/>${text(monoBold, "PAID", sx + 18, sy + 9, 30, PAID, 0.12)}</g>`;

  const cx = x + w / 2;
  const cyc = y + h / 2;
  return `<g transform="rotate(${tilt} ${cx} ${cyc})"><path d="${slipPath(x, y, w, h)}" fill="${CARD}" stroke="${LINE}" stroke-width="2"/>${rows.join("")}${stamp}</g>`;
}

/** The headline at the largest size, up to `max`, at which every line fits
 * in `maxWidth`. Returns the paths and the height used. */
function headline(x: number, y: number, max: number, maxWidth: number, lines: string[]): { svg: string; height: number } {
  const size = Math.floor(Math.min(max, ...lines.map((l) => (max * maxWidth) / width(semi, l, max, -0.03))));
  const svg = lines.map((l, i) => text(semi, l, x, y + i * size * 1.02, size, INK, -0.03)).join("");
  return { svg, height: size * 1.02 * lines.length };
}

function wide(): string {
  const W = 1200;
  const H = 800;
  const h = headline(72, 300, 104, 640, ["Pay influencers", "for users", "who stay."]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${PAPER}"/>
${logo(72, 64, 44, INK)}
${h.svg}
${text(sans, "Results-driven influencer marketing on Solana", 72, 690, 30, MUTED)}
${text(mono, "earnout.dev", 72, 736, 24, MUTED)}
${receipt(728, 120, 412, 2)}
</svg>`;
}

function square(): string {
  const S = 1200;
  const h = headline(80, 280, 118, 1040, ["Pay influencers", "for users who stay."]);
  const below = 280 - 118 + h.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<rect width="${S}" height="${S}" fill="${PAPER}"/>
${logo(80, 72, 48, INK)}
${h.svg}
${text(sans, "Results-driven influencer marketing on Solana.", 80, below + 72, 32, MUTED)}
${receipt(380, below + 140, 440, -2)}
${text(mono, "earnout.dev", 80, 1128, 26, MUTED)}
</svg>`;
}

/** Centred text as a path. */
function ctext(font: Font, s: string, cx: number, y: number, size: number, fill: string, tracking = 0): string {
  return text(font, s, cx - width(font, s, size, tracking) / 2, y, size, fill, tracking);
}

/** 16:9, for video title cards and YouTube thumbnails: the promise and the
 * receipt, everything large enough to read in a 300-pixel-wide preview. */
function thumb(): string {
  const W = 1920;
  const H = 1080;
  const h = headline(120, 450, 168, 1040, ["Pay influencers", "for users", "who stay."]);
  const s = 1.45;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${PAPER}"/>
${logo(120, 100, 64, INK)}
${h.svg}
${text(sans, "Results-driven influencer marketing on Solana", 120, 930, 44, MUTED)}
${text(mono, "earnout.dev", 120, 992, 34, MUTED)}
<g transform="scale(${s})">${receipt(1230 / s, 170 / s, 610 / s, 2)}</g>
</svg>`;
}

/** The last frame of a video: where to go next. */
function endCard(): string {
  const W = 1920;
  const H = 1080;
  const cx = W / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${PAPER}"/>
${logo(cx - 118, 300, 72, INK)}
${ctext(semi, "earnout.dev", cx, 560, 150, INK, -0.03)}
${ctext(sans, "Pay influencers for users who stay.", cx, 650, 48, MUTED)}
${ctext(mono, "Live on Solana devnet  ·  open source at github.com/Cryptonomist/earnout", cx, 800, 30, MUTED)}
</svg>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files: [string, string][] = [
    ["card-1200x800", wide()],
    ["card-1200x1200", square()],
    ["card-1920x1080", thumb()],
    ["end-1920x1080", endCard()],
  ];
  for (const [name, svg] of files) {
    fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${name}.png`));
    console.log(`wrote public/brand/${name}.png`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
