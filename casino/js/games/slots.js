/**
 * Neon Reels — 5×3 video slot, 20 fixed paylines. Pure logic, no DOM.
 *
 * Everything here is a deterministic function of a `Round` (casino/js/core/rng.js),
 * so a result can be recomputed from its seed triple. No `Math.random()`.
 *
 * ## Units
 * Every payout in this module is a **multiplier**, never an amount:
 *   - line pays and `win.amount` are multiples of the **line bet**
 *   - `PAYTABLE.scatter` is quoted in multiples of the **total bet**, because
 *     that is how a scatter is advertised to players; `evaluateGrid` converts it
 *     to line-bet units (× 20) before adding it to the total, so the caller only
 *     ever deals with one unit.
 * The controller multiplies `totalMultiplier` by the line bet in minor units,
 * which is why the total stake is always snapped to a multiple of 20: the line
 * bet stays an integer and no money is ever held in a float.
 *
 * ## Reel strips
 * `REELS` are real strips, not weight tables: a spin picks one stop per reel and
 * reads three consecutive symbols, so symbols that sit next to each other on a
 * strip tend to land in the same window. Strips are built so that the two
 * scatters on each reel are ~33 stops apart — over a 3-row window that makes at
 * most one scatter per reel, which keeps the feature frequency exactly
 * computable (P = 3 · scatters / stops per reel).
 */

/** Rows visible per reel. */
export const ROWS = 3;
/** Number of reels. */
export const REEL_COUNT = 5;
/** Free spins granted by 3+ scatters, and the multiplier applied to them. */
export const FREE_SPINS = 10;
export const FREE_SPIN_MULTIPLIER = 2;
/** Scatters needed to trigger the feature. */
export const SCATTER_TRIGGER = 3;

/**
 * The symbol set, ordered from most to least valuable.
 * `glyph` is the character the UI draws when there is no icon for the symbol;
 * `icon` names an entry of assets/js/icons.js.
 */
export const SYMBOLS = [
  { id: "wild",    label: "Comodín",  short: "W", icon: "bolt",    tier: "wild",    substitutes: true },
  { id: "scatter", label: "Estrella", short: "S", icon: "sparkle", tier: "scatter", scatter: true },
  { id: "trophy",  label: "Trofeo",   short: "T", icon: "trophy",  tier: "premium" },
  { id: "seven",   label: "Siete",    short: "7", glyph: "7",      tier: "premium" },
  { id: "flame",   label: "Llama",    short: "F", icon: "flame",   tier: "premium" },
  { id: "chip",    label: "Ficha",    short: "C", icon: "chip",    tier: "premium" },
  { id: "ace",     label: "As",       short: "A", glyph: "A",      tier: "low" },
  { id: "king",    label: "Rey",      short: "K", glyph: "K",      tier: "low" },
  { id: "queen",   label: "Dama",     short: "Q", glyph: "Q",      tier: "low" },
  { id: "jack",    label: "Jota",     short: "J", glyph: "J",      tier: "low" },
];

/** Symbol id by index, and the reverse lookup used by `strip()`. */
export const SYMBOL_BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
const BY_SHORT = Object.fromEntries(SYMBOLS.map((s) => [s.short, s.id]));

/** Expand a compact strip literal ("SWAKJ…") into symbol ids. */
const strip = (codes) =>
  [...codes].map((c) => {
    const id = BY_SHORT[c];
    if (!id) throw new Error(`Unknown symbol code in reel strip: ${c}`);
    return id;
  });

/**
 * The five reel strips. Composition per reel (stops):
 *   wild 4/5/6/5/4 · scatter 2 · trophy 4 · seven 5 · flame 6 · chip 7
 *   ace 8 · king 9 · queen 10 · jack 10
 * Wilds cluster towards the middle reels, the classic shape that makes
 * four- and five-of-a-kind possible without making them cheap.
 */
export const REELS = [
  // reel 1 — 65 stops
  strip(
    "SWAKJQJ7TFCAK" +
    "QJJWFCA7KQJTA" +
    "CKFQJKQSW7CAQ" +
    "FKTAJCQ7KJWFA" +
    "QKCJJTA7KFQCQ"
  ),
  // reel 2 — 66 stops
  strip(
    "JWJJCFT7AKQJA" +
    "KWCFQJK7ASTCQ" +
    "QWFAKJCQ7KJAF" +
    "TWKCQJAQ7JFKC" +
    "QWASTKQJ7FCAK" +
    "Q"
  ),
  // reel 3 — 67 stops
  strip(
    "CAKQWQJ7JCFAT" +
    "KQJWKAC7FQJQK" +
    "AWCSTQFK7AJQW" +
    "CKJJAFTQ7CWKA" +
    "QJKFJCQJ7WSTA" +
    "KF"
  ),
  // reel 4 — 66 stops
  strip(
    "QWFAKJCQ7KJAF" +
    "TWKCQJAQ7JFKC" +
    "QWASTKQJ7FCAK" +
    "QJWJJCFT7AKQJ" +
    "AKWCFQJK7ASTC" +
    "Q"
  ),
  // reel 5 — 65 stops
  strip(
    "QJKQSW7CAQFKT" +
    "AJCQ7KJWFAQKC" +
    "JJTA7KFQCQSWA" +
    "KJQJ7TFCAKQJJ" +
    "WFCA7KQJTACKF"
  ),
];

/**
 * The 20 fixed paylines. Each entry lists the row (0 = top, 2 = bottom) the line
 * visits on reels 1…5. All 20 have the same marginal symbol distribution, so the
 * per-line expectation is identical and the maths below stays tractable.
 */
export const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1], [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [0, 2, 0, 2, 0],
];

/** Active lines. The stake is divided by this before reaching the game. */
export const LINES = PAYLINES.length;

/**
 * Pays by symbol and match count.
 * Line symbols pay multiples of the **line bet**; `scatter` pays multiples of
 * the **total bet** (see the units note at the top of the file).
 * Only the top symbol pays from two, which is what makes it the top symbol.
 */
export const PAYTABLE = {
  trophy: { 2: 2, 3: 25, 4: 125, 5: 600 },
  seven: { 3: 20, 4: 80, 5: 350 },
  flame: { 3: 15, 4: 55, 5: 225 },
  chip: { 3: 10, 4: 40, 5: 165 },
  ace: { 3: 6, 4: 22, 5: 95 },
  king: { 3: 5, 4: 20, 5: 85 },
  queen: { 3: 4, 4: 16, 5: 60 },
  jack: { 3: 3, 4: 13, 5: 55 },
  scatter: { 3: 2, 4: 10, 5: 50 },
};

/** Symbols that can head a payline: everything except the wild and the scatter. */
const PAYING_SYMBOLS = SYMBOLS.filter((s) => !s.substitutes && !s.scatter).map((s) => s.id);

/**
 * Longest left-to-right run of `symbolId` on a line, counting wilds as matches.
 * @param {string[]} cells the five symbols the line visits, reel 1 → reel 5
 */
function runLength(cells, symbolId) {
  let n = 0;
  for (const cell of cells) {
    if (cell === symbolId || cell === "wild") n++;
    else break;
  }
  return n;
}

/**
 * Evaluate one payline.
 *
 * A line pays **once**, for its longest run — never for the 3-, 4- and 5-of-a-kind
 * it contains at the same time. When two symbols reach the same run length (only
 * possible when the run starts with wilds, since wilds match everything) the
 * higher-paying one is paid. That tie-break is also what makes an all-wild line
 * pay the top symbol instead of nothing.
 *
 * @returns {{symbol: string, count: number, amount: number}|null}
 */
function evaluateLine(cells) {
  let bestCount = 0;
  let bestSymbol = null;
  let bestAmount = 0;

  for (const symbolId of PAYING_SYMBOLS) {
    const count = runLength(cells, symbolId);
    const amount = PAYTABLE[symbolId][count] ?? 0;
    // Longest run first; equal length is settled by value.
    if (count > bestCount || (count === bestCount && amount > bestAmount)) {
      bestCount = count;
      bestSymbol = symbolId;
      bestAmount = amount;
    }
  }

  return bestAmount > 0 ? { symbol: bestSymbol, count: bestCount, amount: bestAmount } : null;
}

/**
 * Score a 5×3 grid.
 *
 * @param {string[][]} grid `grid[reel][row]` — five columns of three symbol ids.
 * @param {{freeSpin?: boolean}} [opts] a free spin doubles everything it wins
 *   and cannot retrigger the feature (see `freeSpinsAwarded`).
 * @returns {{wins: Array<{line: number|null, symbol: string, count: number, amount: number, cells: Array<[number, number]>}>,
 *            scatterCount: number, totalMultiplier: number, freeSpinsAwarded: number, multiplier: number}}
 */
export function evaluateGrid(grid, { freeSpin = false } = {}) {
  const wins = [];

  PAYLINES.forEach((rows, index) => {
    const cells = rows.map((row, reel) => grid[reel][row]);
    const hit = evaluateLine(cells);
    if (!hit) return;
    wins.push({
      line: index,
      symbol: hit.symbol,
      count: hit.count,
      amount: hit.amount,
      // Coordinates of the winning cells, so the UI can light them up.
      cells: rows.slice(0, hit.count).map((row, reel) => [reel, row]),
    });
  });

  // Scatters pay on total count anywhere on screen, ignoring the paylines.
  const scatterCells = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel][row] === "scatter") scatterCells.push([reel, row]);
    }
  }
  const scatterCount = scatterCells.length;
  const scatterPay = PAYTABLE.scatter[scatterCount] ?? 0;
  if (scatterPay > 0) {
    wins.push({
      // `line: null` marks a win that belongs to no payline.
      line: null,
      symbol: "scatter",
      count: scatterCount,
      // Quoted per total bet in the paytable, converted to line-bet units here.
      amount: scatterPay * LINES,
      cells: scatterCells,
    });
  }

  const multiplier = freeSpin ? FREE_SPIN_MULTIPLIER : 1;
  const totalMultiplier = wins.reduce((sum, w) => sum + w.amount, 0) * multiplier;

  return {
    wins,
    scatterCount,
    totalMultiplier,
    // No retrigger: a free spin never grants more free spins, which is what keeps
    // the feature's contribution to the RTP a closed form instead of a series.
    freeSpinsAwarded: !freeSpin && scatterCount >= SCATTER_TRIGGER ? FREE_SPINS : 0,
    multiplier,
  };
}

/**
 * Spin the reels.
 *
 * Each reel is positioned with a single number from the round — `round.int(len, i)`
 * for reel `i` — and shows that stop plus the two below it, wrapping around the
 * strip. A round therefore consumes exactly five numbers, so a free spin is given
 * its own round rather than reusing offsets of this one.
 *
 * @param {import('../core/rng.js').Round} round
 * @param {{freeSpin?: boolean}} [opts]
 */
export function spin(round, { freeSpin = false } = {}) {
  const positions = REELS.map((reel, i) => round.int(reel.length, i));
  const grid = REELS.map((reel, i) =>
    Array.from({ length: ROWS }, (_, row) => reel[(positions[i] + row) % reel.length])
  );

  return { grid, positions, ...evaluateGrid(grid, { freeSpin }) };
}

/** Probability that a given reel shows a scatter, given the ≥3-stop spacing. */
const scatterChance = (reel) => (ROWS * reel.filter((s) => s === "scatter").length) / reel.length;

/**
 * Exact feature frequency, derived from the strips rather than measured.
 * Exposed so the paytable UI can quote it without hardcoding a number.
 * @returns {number} probability that a spin lands 3 or more scatters
 */
export function featureChance() {
  // Poisson binomial over the five independent reels.
  let dist = [1];
  for (const reel of REELS) {
    const q = scatterChance(reel);
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((p, k) => {
      next[k] += p * (1 - q);
      next[k + 1] += p * q;
    });
    dist = next;
  }
  return dist.slice(SCATTER_TRIGGER).reduce((a, b) => a + b, 0);
}
