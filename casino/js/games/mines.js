/**
 * Minas — pure game logic. No DOM, importable from node.
 *
 * Randomness comes exclusively from a `Round` (../core/rng.js). The whole
 * layout is decided by a single `round.pick(m, 25)` call **when the round is
 * opened**, before the player touches anything, so the mines are fixed by the
 * seed triple and cannot follow the cursor. Everything after that is
 * deterministic bookkeeping: `reveal()` only looks up whether the tile the
 * player chose happens to be in a list that already existed.
 *
 * ## Stream layout
 * A round reads its floats in a fixed, auditable order:
 *
 *   positions 0 … m−1        the mine positions (`pick` consumes one per mine)
 *   position  m + opened     the t-th "selección aleatoria" (see `randomHiddenTile`)
 *
 * Nothing else touches the stream, so replaying a nonce reproduces the board
 * exactly — including which tile the random button would have offered.
 *
 * ## Pricing
 * With `m` mines on 25 tiles, opening `k` tiles without hitting one has
 * probability `C(25−m, k) / C(25, k)`. Paying the inverse of that, minus the
 * house cut, gives a flat return:
 *
 *     mult(k) = (1 − ventaja) · C(25, k) / C(25 − m, k)
 *     RTP     = mult(k) · P(sobrevivir k) = 1 − ventaja  … para todo m y k ≥ 1
 *
 * The ratio of binomials is computed as an **iterative product of ratios**
 * rather than from factorials — `C(25, 12)` is only ~5 million, but the
 * intermediate `25!` is 1.5·10²⁵ and would already have lost integer precision
 * in a double:
 *
 *     C(25, k) / C(25 − m, k) = Π_{i=0}^{k−1} (25 − i) / (25 − m − i)
 *
 * Every factor is a small ratio, so the accumulated error stays around 1 ulp.
 *
 * ## The `mult(0)` case
 * The formula evaluates to `1 − ventaja` at k = 0: cashing out having opened
 * nothing would return 99 % of the stake, i.e. the house would charge its edge
 * for a bet that never happened. That is not a real state of the game — the
 * edge is paid *for taking a risk* — so it is handled in two places at once:
 *
 *   1. `multiplierFor(m, 0)` returns exactly **1**, so the "si te retiras
 *      ahora" figure equals the stake before the first tile.
 *   2. `cashOut()` refuses a round with zero tiles opened, and the UI keeps the
 *      cash-out button disabled until the first safe tile.
 *
 * So the edge is charged once, on the first reveal (`mult(1) = 0,99 · 25/(25−m)`
 * instead of `25/(25−m)`), and never again: from there on each extra tile
 * multiplies by exactly the inverse of its own survival probability.
 *
 * ## Money
 * Stakes and payouts are integer minor units (credits × 100); the multiplier is
 * a real number, so `payoutFor()` rounds once, at the end.
 */

/** 5×5 board. */
export const COLS = 5;
export const ROWS = 5;
export const GRID = COLS * ROWS;

/** At least one mine (otherwise there is no bet) and at most 24 (one safe tile). */
export const MIN_MINES = 1;
export const MAX_MINES = GRID - 1;

/** House advantage baked into every multiplier. */
export const HOUSE_EDGE = 0.01;
/** Return to player, identical for every mine count and every cash-out point. */
export const THEORETICAL_RTP = 1 - HOUSE_EDGE;

/** Round statuses. `cashed` covers both a voluntary cash-out and a cleared board. */
export const STATUS = Object.freeze({
  PLAYING: "playing",
  LOST: "lost",
  CASHED: "cashed",
});

/**
 * Clamp a mine count into [1, 24]. Runs at every entry point rather than
 * trusting the caller, because a count of 0 or 25 would make the pricing
 * degenerate (a free win, or a division by zero).
 * @param {number|string} mineCount
 * @returns {number}
 */
export function normalizeMineCount(mineCount) {
  const value = Math.round(Number(mineCount));
  if (!Number.isFinite(value)) return 3;
  return Math.min(MAX_MINES, Math.max(MIN_MINES, value));
}

/** Safe tiles left on the board for a given mine count. */
export const safeTilesFor = (mineCount) => GRID - normalizeMineCount(mineCount);

/**
 * Decide where the mines are. Called once per round, before the first click.
 *
 * @param {import('../core/rng.js').Round} round
 * @param {number} mineCount
 * @returns {number[]} distinct tile indices in [0, 25), ascending
 */
export function placeMines(round, mineCount) {
  const m = normalizeMineCount(mineCount);
  // `pick` is a partial Fisher–Yates over the 25 tiles: exact, no rejection
  // loop, and it consumes exactly one float per mine so the stream layout above
  // holds. Sorted for display and verification only — draw order is meaningless
  // once every mine is equally fatal.
  return round.pick(m, GRID).sort((a, b) => a - b);
}

/**
 * Payout multiplier after `revealed` safe tiles, stake included (2× means
 * "your stake back plus the same again").
 *
 * @param {number} mineCount
 * @param {number} revealed safe tiles already opened
 * @param {number} [houseEdge] 0.01 = 1 %
 * @returns {number}
 */
export function multiplierFor(mineCount, revealed, houseEdge = HOUSE_EDGE) {
  const m = normalizeMineCount(mineCount);
  const safe = GRID - m;
  const k = Math.max(0, Math.floor(Number(revealed) || 0));
  if (k > safe) {
    throw new RangeError(`no se pueden destapar ${k} casillas seguras con ${m} minas`);
  }
  // See "The mult(0) case" above: no risk taken, no edge charged.
  if (k === 0) return 1;

  let product = 1;
  for (let i = 0; i < k; i++) product *= (GRID - i) / (safe - i);
  return (1 - houseEdge) * product;
}

/**
 * What one more safe tile would pay.
 * @returns {number|null} null when the board is already cleared — there is no
 *   next tile to price, and returning 0 would read as "the next hit pays zero".
 */
export function nextMultiplier(mineCount, revealed, houseEdge = HOUSE_EDGE) {
  const m = normalizeMineCount(mineCount);
  const k = Math.max(0, Math.floor(Number(revealed) || 0));
  if (k >= GRID - m) return null;
  return multiplierFor(m, k + 1, houseEdge);
}

/**
 * Probability that the next tile opened is safe: safe tiles left over tiles
 * left. This is the number the player is actually betting against on each
 * click, and it *falls* as the board opens — which is exactly why the
 * multiplier has to rise.
 *
 * @returns {number} ratio in [0, 1]
 */
export function winChanceOfNext(mineCount, revealed) {
  const m = normalizeMineCount(mineCount);
  const k = Math.max(0, Math.floor(Number(revealed) || 0));
  const tilesLeft = GRID - k;
  if (tilesLeft <= 0) return 0;
  return Math.max(0, (GRID - m - k) / tilesLeft);
}

/**
 * Probability of getting `revealed` safe tiles in a row from a fresh board,
 * `C(25−m, k) / C(25, k)`. Exposed so the UI can prove the multiplier instead
 * of asserting it: `multiplierFor × survivalChance` is the RTP.
 */
export function survivalChance(mineCount, revealed) {
  const m = normalizeMineCount(mineCount);
  const safe = GRID - m;
  const k = Math.max(0, Math.floor(Number(revealed) || 0));
  if (k > safe) return 0;
  let product = 1;
  for (let i = 0; i < k; i++) product *= (safe - i) / (GRID - i);
  return product;
}

/** What clearing the whole board pays — the ceiling of the chosen mine count. */
export const maxMultiplier = (mineCount, houseEdge = HOUSE_EDGE) =>
  multiplierFor(mineCount, safeTilesFor(mineCount), houseEdge);

/**
 * Total return in minor units for cashing out now. Rounded once, here, so the
 * figure shown next to the cash-out button is the figure credited by it.
 * @param {number} stake minor units
 */
export function payoutFor(stake, mineCount, revealed, houseEdge = HOUSE_EDGE) {
  return Math.round(stake * multiplierFor(mineCount, revealed, houseEdge));
}

/**
 * The house edge actually delivered at a given cash-out point.
 * @returns {number} 0.01 for every k ≥ 1, and 0 at k = 0 (nothing was risked)
 */
export const edgeOf = (mineCount, revealed, houseEdge = HOUSE_EDGE) =>
  1 - multiplierFor(mineCount, revealed, houseEdge) * survivalChance(mineCount, revealed);

/* --- State machine --------------------------------------------------------- */

/**
 * @typedef {object} MinesState
 * @property {import('../core/rng.js').Round} round the stream that fixed the layout
 * @property {number} mineCount
 * @property {readonly number[]} mines tile indices holding a mine, ascending
 * @property {number} safeTotal tiles that can be opened safely
 * @property {readonly number[]} revealed safe tiles opened, in click order
 * @property {"playing"|"lost"|"cashed"} status
 * @property {number|null} hitMine the mine that ended the round, if any
 * @property {boolean} cleared every safe tile was opened
 * @property {number} multiplier current payout multiplier (0 once lost)
 */

/**
 * Open a board. The layout is decided here and never again.
 * @param {import('../core/rng.js').Round} round
 * @param {{mineCount?: number}} [opts]
 * @returns {MinesState}
 */
export function createBoard(round, { mineCount = 3 } = {}) {
  const m = normalizeMineCount(mineCount);
  return Object.freeze({
    round,
    mineCount: m,
    mines: Object.freeze(placeMines(round, m)),
    safeTotal: GRID - m,
    revealed: Object.freeze([]),
    status: STATUS.PLAYING,
    hitMine: null,
    cleared: false,
    multiplier: 1,
  });
}

/** Is this tile still face down? */
export function isHidden(state, index) {
  return index !== state.hitMine && !state.revealed.includes(index);
}

/** Tile indices still face down, ascending. */
export function hiddenTiles(state) {
  const out = [];
  for (let i = 0; i < GRID; i++) if (isHidden(state, i)) out.push(i);
  return out;
}

/**
 * Open one tile. Pure: returns a new state, never mutates the old one.
 *
 * Throws rather than no-oping on an illegal move — a double-click that silently
 * "worked" would desynchronise the board from the settled bet, so the UI is
 * expected to guard with `isHidden()` and this is the backstop.
 *
 * @param {MinesState} state
 * @param {number} index
 * @returns {MinesState}
 */
export function reveal(state, index) {
  if (state.status !== STATUS.PLAYING) throw new Error("la ronda ya ha terminado");

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= GRID) {
    throw new RangeError(`casilla fuera del tablero: ${index}`);
  }
  if (!isHidden(state, i)) throw new Error(`la casilla ${i} ya está destapada`);

  if (state.mines.includes(i)) {
    // Losing zeroes the multiplier: the stake is already debited, so a payout
    // of stake × 0 is the whole settlement.
    return Object.freeze({ ...state, status: STATUS.LOST, hitMine: i, multiplier: 0 });
  }

  const revealed = Object.freeze([...state.revealed, i]);
  // Opening the last safe tile ends the round by itself: there is nothing left
  // to risk, so the board is cashed at its ceiling rather than left "playing".
  const cleared = revealed.length === state.safeTotal;
  return Object.freeze({
    ...state,
    revealed,
    cleared,
    status: cleared ? STATUS.CASHED : STATUS.PLAYING,
    multiplier: multiplierFor(state.mineCount, revealed.length),
  });
}

/**
 * Take the money. Refuses a board with nothing opened — see "The `mult(0)`
 * case": there is no bet to settle yet, and paying `1 − ventaja` for it would
 * charge the edge on a risk never taken.
 * @param {MinesState} state
 * @returns {MinesState}
 */
export function cashOut(state) {
  if (state.status !== STATUS.PLAYING) throw new Error("la ronda ya ha terminado");
  if (state.revealed.length === 0) {
    throw new Error("destapa al menos una casilla antes de retirarte");
  }
  return Object.freeze({ ...state, status: STATUS.CASHED });
}

/**
 * A uniformly random face-down tile, drawn from the round's own stream — never
 * `Math.random()`, so the "selección aleatoria" button is as verifiable as the
 * board itself. Reads stream position `mineCount + tiles opened`, which is
 * distinct for every pick within a round and never collides with the mine
 * positions.
 *
 * @param {MinesState} state
 * @param {import('../core/rng.js').Round} [round] defaults to the state's own
 * @returns {number|null} tile index, or null if the board is full
 */
export function randomHiddenTile(state, round = state.round) {
  const hidden = hiddenTiles(state);
  if (hidden.length === 0) return null;
  const streamIndex = state.mineCount + state.revealed.length;
  return hidden[Math.min(hidden.length - 1, Math.floor(round.at(streamIndex) * hidden.length))];
}

/** Row/column of a tile, 1-based, for accessible labels. */
export const positionOf = (index) => ({
  row: Math.floor(index / COLS) + 1,
  col: (index % COLS) + 1,
});

// A sign slip or an off-by-one in the product would bias every payout in the
// game while still looking plausible on screen, so the flat-RTP invariant is
// checked once at import instead of trusted. The sweep covers both mine-count
// boundaries, both ends of each board, and the awkward middle.
(function assertFlatRtp() {
  for (let m = MIN_MINES; m <= MAX_MINES; m++) {
    for (let k = 1; k <= GRID - m; k++) {
      const rtp = multiplierFor(m, k) * survivalChance(m, k);
      if (Math.abs(rtp - THEORETICAL_RTP) > 1e-9) {
        throw new Error(`RTP roto con ${m} minas y ${k} aciertos: ${rtp} en lugar de ${THEORETICAL_RTP}`);
      }
    }
    // Each extra tile must multiply by exactly the inverse of its own survival
    // probability, or the edge would be charged more than once.
    for (let k = 1; k < GRID - m; k++) {
      const step = multiplierFor(m, k + 1) / multiplierFor(m, k);
      if (Math.abs(step - 1 / winChanceOfNext(m, k)) > 1e-9) {
        throw new Error(`El paso ${k}→${k + 1} con ${m} minas no cuadra con su probabilidad`);
      }
    }
  }
  if (multiplierFor(12, 0) !== 1) {
    throw new Error("mult(0) debe ser 1: sin riesgo no hay ventaja que cobrar");
  }
})();
