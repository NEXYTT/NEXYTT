/**
 * WCAG contrast audit of the design tokens.
 *
 * Parses `assets/css/tokens.css` and checks every foreground token against
 * every surface token of the same theme. Reading the real file rather than a
 * copied list is the point: a palette tweak that quietly drops text below the
 * legibility threshold fails here instead of shipping.
 *
 *   node tests/contrast.mjs
 *   node tests/contrast.mjs --all   # also report passing pairs
 *
 * AA requires 4.5:1 for body text and 3:1 for large text and UI boundaries.
 */

import { readFile } from "node:fs/promises";

const TOKENS = new URL("../assets/css/tokens.css", import.meta.url);

const AA_TEXT = 4.5;
const AA_LARGE = 3;

/* --- Colour maths (WCAG 2.1) ---------------------------------------------- */

function parseColor(value) {
  const text = value.trim();

  const hexMatch = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  }

  const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return parts.slice(0, 3);
  }

  return null; // color-mix(), gradients, and anything else we cannot resolve
}

const channelLuminance = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* --- Token parsing --------------------------------------------------------- */

/**
 * Read every custom property, grouped by the selector block it sits in, with
 * `:root` values inherited into each theme.
 */
async function readThemes() {
  const css = await readFile(TOKENS, "utf8");
  // Strip comments so a hex inside prose is never mistaken for a declaration.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const blocks = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    declarations: Object.fromEntries(
      [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
    ),
  }));

  const base = blocks.find((b) => b.selector === ":root")?.declarations ?? {};
  const themes = {};
  for (const block of blocks) {
    if (block.selector === ":root") continue;
    themes[block.selector] = { ...base, ...block.declarations };
  }
  return themes;
}

/* --- The audit ------------------------------------------------------------- */

/** Text tokens paired with the surfaces they are allowed to sit on. */
const SURFACES = ["--bg", "--bg-elev-1", "--bg-elev-2", "--bg-elev-3", "--bg-inset"];

const TEXT_TOKENS = [
  { token: "--fg", min: AA_TEXT },
  { token: "--fg-muted", min: AA_TEXT },
  { token: "--fg-subtle", min: AA_TEXT },
  { token: "--accent", min: AA_TEXT },
  { token: "--win-ink", min: AA_TEXT },
  { token: "--loss-ink", min: AA_TEXT },
  { token: "--warn-ink", min: AA_TEXT },
  { token: "--info-ink", min: AA_TEXT },
];

/** Text that sits on a solid fill rather than on a page surface. */
const ON_FILL = [
  { fg: "--card-ink", bg: "--card-face", min: AA_TEXT },
  { fg: "--card-ink", bg: "--card-face-edge", min: AA_TEXT },
  { fg: "--card-ink-red", bg: "--card-face", min: AA_TEXT },
  { fg: "--card-ink-red", bg: "--card-face-edge", min: AA_TEXT },
  { fg: "--accent-fg", bg: "--accent", min: AA_TEXT },
  { fg: "--on-win", bg: "--win", min: AA_TEXT },
  { fg: "--on-loss", bg: "--loss", min: AA_TEXT },
  { fg: "--on-warn", bg: "--warn", min: AA_TEXT },
  { fg: "--on-info", bg: "--info", min: AA_TEXT },
];

const showAll = process.argv.includes("--all");
const themes = await readThemes();

let failures = 0;
let checked = 0;
let skipped = 0;

const report = (ok, line) => {
  checked++;
  if (!ok) failures++;
  if (!ok || showAll) console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${line}`);
};

for (const [selector, tokens] of Object.entries(themes)) {
  console.log(`\n${selector}`);

  for (const { token, min } of TEXT_TOKENS) {
    const fg = parseColor(tokens[token] ?? "");
    if (!fg) {
      if (tokens[token]) skipped++;
      continue;
    }

    for (const surface of SURFACES) {
      const bg = parseColor(tokens[surface] ?? "");
      if (!bg) continue;
      const ratio = contrast(fg, bg);
      report(
        ratio >= min,
        `${token} on ${surface}`.padEnd(34) + `${ratio.toFixed(2)}:1 (min ${min})`
      );
    }
  }

  for (const { fg, bg, min } of ON_FILL) {
    const f = parseColor(tokens[fg] ?? "");
    const b = parseColor(tokens[bg] ?? "");
    if (!f || !b) continue;
    const ratio = contrast(f, b);
    report(ratio >= min, `${fg} on ${bg}`.padEnd(34) + `${ratio.toFixed(2)}:1 (min ${min})`);
  }

  // Borders and other non-text boundaries only need 3:1, and --border is
  // deliberately a translucent rgba, so it is reported rather than enforced.
  const borderRaw = tokens["--border-strong"];
  if (borderRaw && !parseColor(borderRaw)) skipped++;
}

console.log(
  `\n${checked - failures}/${checked} pares cumplen AA` +
    (skipped ? ` · ${skipped} tokens no evaluables (color-mix o rgba translúcido)` : "")
);
process.exit(failures ? 1 : 0);
