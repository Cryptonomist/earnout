/* Generates the Earnout logo family into public/brand from two things: the
 * mark's geometry (a receipt slip with a tick, the same one the site's icon
 * uses) and the wordmark, "earnout" set in Geist SemiBold and converted to
 * paths so the files need no font.
 *
 *   npx tsx scripts/brand.ts
 *
 * The tick is cut out of the slip (an SVG mask), so on any background the
 * tick shows the background through the slip. Ink for light backgrounds,
 * paper for dark ones, and one accent version in the paid green, which on
 * this site only ever means "paid": a receipt that was honoured. */

import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const OUT = path.resolve("public/brand");
const FONT = path.resolve("node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf");

const INK = "#16150f";
const PAPER = "#f4f2eb";
const PAID = "#0b7349";

// The mark, on a 24-unit grid. Bottom edge torn like a slip off a roll.
const SLIP = "M5.5 2h13A1.5 1.5 0 0 1 20 3.5V22l-2.67-1.6L14.67 22 12 20.4 9.33 22l-2.66-1.6L4 22V3.5A1.5 1.5 0 0 1 5.5 2Z";
const TICK = "m8.25 11.25 2.5 2.5 5-5";
const TICK_WIDTH = 2.2;

// The wordmark sits to the right of the mark, its x-height 13.6 of the
// mark's 24 units, centred on the mark's optical centre (y 12).
const MARK = 24;
const GAP = 6;
const X_HEIGHT = 13.6;
const BASELINE = 12 + X_HEIGHT / 2;

const font = opentype.loadSync(FONT);
const xHeightEm = font.tables.os2.sxHeight / font.unitsPerEm;
const SIZE = X_HEIGHT / xHeightEm;
const TEXT_OPTS = { kerning: true, letterSpacing: -0.015 };

function wordPath(atX: number): { d: string; width: number; y1: number; y2: number } {
  const probe = font.getPath("earnout", 0, BASELINE, SIZE, TEXT_OPTS).getBoundingBox();
  const p = font.getPath("earnout", atX - probe.x1, BASELINE, SIZE, TEXT_OPTS);
  const bb = p.getBoundingBox();
  return { d: p.toPathData(3), width: bb.x2 - bb.x1, y1: bb.y1, y2: bb.y2 };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function markSvg(fill: string, id = "m"): string {
  return `<defs><mask id="${id}"><path d="${SLIP}" fill="#fff"/><path d="${TICK}" fill="none" stroke="#000" stroke-width="${TICK_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><rect width="${MARK}" height="${MARK}" fill="${fill}" mask="url(#${id})"/>`;
}

const svg = (viewBox: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;

function mark(fill: string): string {
  return svg(`0 0 ${MARK} ${MARK}`, markSvg(fill));
}

function logo(fill: string): string {
  const w = wordPath(MARK + GAP);
  const width = round(MARK + GAP + w.width);
  return svg(`0 0 ${width} ${MARK}`, `${markSvg(fill)}<path d="${w.d}" fill="${fill}"/>`);
}

function wordmark(fill: string): string {
  const w = wordPath(0);
  const h = round(w.y2 - w.y1);
  return svg(`0 ${round(w.y1)} ${round(w.width)} ${h}`, `<path d="${w.d}" fill="${fill}"/>`);
}

/** A square tile: the mark on a rounded background, for avatars. */
function avatar(bg: string, fill: string): string {
  const s = 96;
  return svg(
    `0 0 ${s} ${s}`,
    `<rect width="${s}" height="${s}" rx="20" fill="${bg}"/><g transform="translate(${(s - 62) / 2} ${(s - 62) / 2}) scale(${62 / MARK})">${markSvg(fill, "a")}</g>`,
  );
}

/** A wide banner: the logo centred on paper, for an X or Colosseum header. */
function banner(bg: string, fill: string): string {
  const w = wordPath(MARK + GAP);
  const lw = MARK + GAP + w.width;
  const W = 1500;
  const H = 500;
  const scale = 7;
  return svg(
    `0 0 ${W} ${H}`,
    `<rect width="${W}" height="${H}" fill="${bg}"/><g transform="translate(${round((W - lw * scale) / 2)} ${round((H - MARK * scale) / 2)}) scale(${scale})">${markSvg(fill, "b")}<path d="${w.d}" fill="${fill}"/></g>`,
  );
}

async function png(name: string, source: string, width: number) {
  await sharp(Buffer.from(source), { density: 600 }).resize({ width }).png().toFile(path.join(OUT, name));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files: Record<string, string> = {
    "mark.svg": mark(INK),
    "mark-inverse.svg": mark(PAPER),
    "mark-paid.svg": mark(PAID),
    "logo.svg": logo(INK),
    "logo-inverse.svg": logo(PAPER),
    "wordmark.svg": wordmark(INK),
    "wordmark-inverse.svg": wordmark(PAPER),
    "avatar.svg": avatar(PAPER, INK),
    "avatar-dark.svg": avatar(INK, PAPER),
    "banner.svg": banner(PAPER, INK),
    "banner-dark.svg": banner(INK, PAPER),
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), body);

  await png("mark-512.png", files["mark.svg"], 512);
  await png("mark-inverse-512.png", files["mark-inverse.svg"], 512);
  await png("mark-paid-512.png", files["mark-paid.svg"], 512);
  await png("logo-2048.png", files["logo.svg"], 2048);
  await png("logo-inverse-2048.png", files["logo-inverse.svg"], 2048);
  await png("avatar-1024.png", files["avatar.svg"], 1024);
  await png("avatar-dark-1024.png", files["avatar-dark.svg"], 1024);
  await png("banner-1500x500.png", files["banner.svg"], 1500);
  await png("banner-dark-1500x500.png", files["banner-dark.svg"], 1500);

  const lw = wordPath(MARK + GAP);
  console.log(`Wrote ${Object.keys(files).length} SVGs and 9 PNGs to public/brand`);
  console.log(`  wordmark: Geist SemiBold at ${SIZE.toFixed(2)} units, x-height ${X_HEIGHT}; lockup ${round(MARK + GAP + lw.width)} x ${MARK}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
