/**
 * Crash — pure game logic. No DOM, importable from node.
 *
 * Randomness comes exclusively from a `Round` (../core/rng.js). There is no
 * `Math.random()` in this file, and — the non-negotiable rule of the game — the
 * crash point is read from the stream *before* the animation starts. The curve
 * on screen only draws a number that was already fixed when the bet was
 * accepted, so nothing the player does (or how late they click) can move it.
 *
 * ## The crash point
 * From a uniform `u` in [0,1):
 *
 *     crashPoint = piso(99 / (1 − u)) / 100      (mínimo 1,00×)
 *
 * Read it in hundredths and the distribution is exact. Let `c = piso(99/(1−u))`,
 * an integer ≥ 99. For any integer `k ≥ 99`:
 *
 *     P(c ≥ k) = P(1 − u ≤ 99/k) = 99/k
 *
 * A player who always cashes out at `m` (that is, at `M = 100·m` hundredths)
 * wins exactly when `c ≥ M`, so
 *
 *     RTP(m) = P(c ≥ M) × m = (99/M) × (M/100) = 0,99
 *
 * — 99 % for **every** target, from 1,01× to 1000×. The whole 1 % edge lives in
 * the single tick `c = 99`, i.e. `u < 0,01`: one round in a hundred crashes at
 * 1,00× before it ever leaves the ground, and that round pays nothing.
 *
 * ## Why the tie pays
 * The win condition is `crashPoint ≥ cashoutAt`, not `>`. Reaching the crash
 * multiplier *is* reaching it: the round ends at that instant with the money
 * already out. Making the tie a loss would shift the RTP to 99·m/(M+1), which
 * at 1,50× is 98,34 % — a second, hidden edge. The comparison runs on integer
 * hundredths so it can never depend on binary rounding of 1,43 or 2,07.
 *
 * ## Money
 * Stakes and payouts are integer minor units (credits × 100); the multiplier is
 * a real number, so the payout is rounded once, at the end.
 */

/** House advantage baked into the crash distribution. */
export const HOUSE_EDGE = 0.01;
/** Return to player, identical for every cash-out target. */
export const THEORETICAL_RTP = 1 - HOUSE_EDGE;

/**
 * Numerator of the crash formula, in hundredths: 100 × (1 − ventaja) = 99.
 * Kept as an exact integer because `100 * (1 - 0.01)` is only *incidentally*
 * exact in binary floating point, and a numerator off by one ulp would move
 * every crash point at the boundaries.
 */
export const EDGE_NUMERATOR = 99;

/** The rocket never crashes below its starting multiplier. */
export const MIN_CRASH = 1;
/**
 * Ceiling for a crash point, in multiplier units. Purely an animation guard:
 * `Round` floats have ~2^-32 resolution, so an astronomically unlucky `u` could
 * produce a 4·10⁹× round that would take minutes to draw. P(crash ≥ 10⁶) is
 * 99/10⁸ ≈ 1 en 10⁶ rondas, and the cap sits three orders of magnitude above
 * `MAX_CASHOUT`, so no bet this table accepts is ever affected by it.
 */
export const MAX_CRASH = 1_000_000;

/** Bounds the table accepts for an automatic cash-out target. */
export const MIN_CASHOUT = 1.01;
export const MAX_CASHOUT = 1000;

/**
 * Growth constant of the curve, per millisecond: `m(t) = e^(k·t)`.
 *
 * k = 0,00018 makes the multiplier e-fold every 5,6 s and *double* every
 * ln2/k ≈ 3,85 s. That is the whole feel of the game: fast enough that a 2×
 * round is over in under four seconds and the cash-out button is a real
 * reflex test, slow enough that 1,20× is not a coin flip against the frame
 * rate. 10× lands at 12,8 s and 100× at 25,6 s, which are the rare rounds
 * everyone stays to watch.
 */
export const GROWTH_RATE = 0.00018;

/** Where the history strip changes colour. Below 2× red, above 10× gold. */
export const LOW_BRACKET = 2;
export const HIGH_BRACKET = 10;

/** A multiplier expressed in integer hundredths — the unit every comparison uses. */
const ticksOf = (multiplier) => Math.round(multiplier * 100);

/**
 * The crash point of a seeded round, with two decimals.
 * Consumes stream position 0 and nothing else, so a player can verify it with
 * one division: the round's first float is all it takes.
 *
 * @param {import('../core/rng.js').Round} round
 * @returns {number} multiplier ≥ 1,00
 */
export function crashPointFrom(round) {
  return crashPointFromFloat(round.at(0));
}

/**
 * Same formula, straight from a uniform float. Split out so the RTP simulation
 * and the fairness page can replay a round without minting a `Round`.
 * @param {number} u uniform in [0,1)
 * @returns {number}
 */
export function crashPointFromFloat(u) {
  // Integer hundredths first: the division by 100 happens once, at the end, so
  // the result is always the nearest double to a two-decimal value.
  const hundredths = Math.floor(EDGE_NUMERATOR / (1 - u));
  const capped = Math.min(hundredths, MAX_CRASH * 100);
  return Math.max(MIN_CRASH, capped / 100);
}

/**
 * The multiplier the curve shows at `elapsedMs` after take-off.
 * Exponential, exact — the UI floors it to two decimals for display so the
 * number on screen is never ahead of the curve.
 *
 * @param {number} elapsedMs
 * @returns {number} ≥ 1
 */
export function multiplierAt(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  return Math.exp(GROWTH_RATE * elapsedMs);
}

/**
 * Inverse of `multiplierAt`: when the curve reaches `multiplier`.
 * The animation needs this rather than "stop when the frame says so": the
 * crash instant is `timeToReach(crashPoint)`, fixed before the first frame, so
 * a slow frame or a stalled tab can never shift where the round ends.
 *
 * @param {number} multiplier
 * @returns {number} milliseconds since take-off
 */
export function timeToReach(multiplier) {
  if (!Number.isFinite(multiplier) || multiplier <= 1) return 0;
  return Math.log(multiplier) / GROWTH_RATE;
}

/**
 * Total return for cashing out `stake` at `multiplier`, in minor units.
 * Rounded exactly like the settlement, so the figure on the button is the
 * figure credited.
 * @param {number} stake minor units
 * @param {number} multiplier
 * @returns {number} minor units
 */
export function payoutAt(stake, multiplier) {
  return Math.round(stake * multiplier);
}

/**
 * Probability that a round reaches `cashoutAt` — the closed form derived in the
 * header, not a simulation. Exposed so the UI can state the odds of an
 * automatic target instead of asserting them.
 * @param {number} cashoutAt
 * @returns {number} ratio in (0, 1]
 */
export function winProbability(cashoutAt) {
  const target = ticksOf(cashoutAt);
  if (target <= EDGE_NUMERATOR) return 1;
  return EDGE_NUMERATOR / target;
}

/**
 * Settle one crash bet.
 *
 * @param {{crashPoint:number, cashoutAt:number|null, stake:number}} input
 *   `cashoutAt` is the multiplier the player actually left at (manual or
 *   automatic), or null/0 if they never cashed out.
 * @returns {{win:boolean, payout:number, multiplier:number}}
 *   `payout` is the total return (0 on a loss); `multiplier` is what was paid,
 *   0 when the round was lost.
 */
export function resolve({ crashPoint, cashoutAt, stake = 0 }) {
  const crashTicks = ticksOf(crashPoint);
  const outTicks = cashoutAt == null ? 0 : ticksOf(cashoutAt);

  // Integer comparison: `2,07 <= 2,07` must never be decided by binary rounding.
  // A player who never cashed out (outTicks 0) always loses; the tie wins.
  const win = outTicks >= 100 && outTicks <= crashTicks;
  const multiplier = win ? outTicks / 100 : 0;

  return { win, payout: win ? payoutAt(stake, multiplier) : 0, multiplier };
}

/**
 * Clamp an automatic cash-out target into [1,01 – 1000] and snap it to a
 * hundredth, matching the granularity of the crash point itself.
 * @param {number|string} value
 * @returns {number}
 */
export function normalizeCashout(value) {
  // A Spanish keyboard produces "2,50"; `Number("2,50")` is NaN, which would
  // silently turn a deliberate target into the minimum.
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(parsed)) return MIN_CASHOUT;
  return ticksOf(Math.min(MAX_CASHOUT, Math.max(MIN_CASHOUT, parsed))) / 100;
}

/** Colour bracket of a crash point, for the history strip. */
export function bracketOf(crashPoint) {
  if (crashPoint < LOW_BRACKET) return "low";
  return crashPoint > HIGH_BRACKET ? "high" : "mid";
}

/* --- Simulated lobby -------------------------------------------------------- */

/**
 * Nicknames for the fake lobby. Fixed list, shuffled per round: the names are
 * decoration, and the UI says out loud that these players are simulated.
 */
export const BOT_NAMES = Object.freeze([
  "Lucía_88", "elTitoRafa", "Bergara", "NocheEnVegas", "Mireia", "cohete_azul",
  "Paco Turbo", "Iván R.", "La Chispa", "kbza_dura", "Marta V.", "Sirocco",
  "elGatoNegro", "Aitana", "Rulo", "PisoDeArriba", "Nuria_7", "Chema",
  "Bombín", "Salou", "Txema", "doña_suerte", "Kike", "Valdés",
]);

/** Stream positions reserved for the lobby. Position 0 is the crash point. */
const BOT_COUNT_INDEX = 1;
const BOT_FIELDS_INDEX = 2;
/** Fixed slot for the name shuffle, past the widest possible bot block. */
const BOT_NAMES_INDEX = 32;
const MIN_BOTS = 5;
const MAX_BOTS = 9;

/** Stake range of a simulated bet, in minor units, snapped to whole credits. */
const BOT_MIN_STAKE = 200;
const BOT_STAKE_SPAN = 9800;
/** Bounds of a simulated cash-out target. */
const BOT_MIN_TARGET = 1.05;
const BOT_MAX_TARGET = 20;

/**
 * Build the round's simulated lobby.
 *
 * Every decision is derived from the *same* seeded round as the crash point,
 * just from different stream positions, so the lobby replays identically from
 * the seed triple — no `Math.random()`, no divergence between two people
 * verifying the same nonce. The slots are fixed rather than sequential so that
 * changing the bot count can never shift which float feeds which decision.
 *
 * A bot's target is `1,05 + 0,5 · u/(1−u)`, capped at `BOT_MAX_TARGET`. The
 * odds ratio `u/(1−u)` gives the same heavy tail as the game itself: median
 * 1,55×, a quarter of the lobby past 3× and the occasional nerve of steel
 * holding to 20×. It is cosmetic and has no bearing on the player's odds.
 *
 * @param {import('../core/rng.js').Round} round
 * @param {{crashPoint:number}} input
 * @returns {{name:string, stake:number, cashoutAt:number, win:boolean, payout:number, at:number}[]}
 *   `at` is the millisecond the bot leaves the round (its own target time), or
 *   the crash instant for the ones that never make it.
 */
export function simulatedPlayers(round, { crashPoint }) {
  const count = MIN_BOTS + round.int(MAX_BOTS - MIN_BOTS + 1, BOT_COUNT_INDEX);
  const names = round.shuffle(BOT_NAMES, BOT_NAMES_INDEX);
  const crashTicks = ticksOf(crashPoint);

  return Array.from({ length: count }, (_, i) => {
    const stakeFloat = round.at(BOT_FIELDS_INDEX + i * 2);
    const targetFloat = round.at(BOT_FIELDS_INDEX + i * 2 + 1);

    const stake = BOT_MIN_STAKE + Math.floor((stakeFloat * BOT_STAKE_SPAN) / 100) * 100;
    const target = BOT_MIN_TARGET + (0.5 * targetFloat) / (1 - targetFloat);
    const cashoutAt = ticksOf(Math.min(BOT_MAX_TARGET, target)) / 100;
    const win = ticksOf(cashoutAt) <= crashTicks;

    return {
      name: names[i % names.length],
      stake,
      cashoutAt,
      win,
      payout: win ? payoutAt(stake, cashoutAt) : 0,
      at: timeToReach(win ? cashoutAt : crashPoint),
    };
  });
}

// A stray offset in the tick maths would bias every payout in the game while
// still looking plausible on screen, so the flat-RTP invariant is checked once
// at import instead of trusted. `winProbability` is the closed form; the sweep
// covers the table's bounds and the awkward values in between.
(function assertFlatRtp() {
  if (Math.round(100 * (1 - HOUSE_EDGE)) !== EDGE_NUMERATOR) {
    throw new Error(`EDGE_NUMERATOR debe ser 100 × (1 − ventaja), no ${EDGE_NUMERATOR}`);
  }
  const samples = [1, MIN_CASHOUT, 1.5, 2, 2.07, 3.33, 5, 10, 20, 99.99, 500, MAX_CASHOUT];
  for (const target of samples) {
    const rtp = winProbability(target) * target;
    if (Math.abs(rtp - THEORETICAL_RTP) > 1e-12) {
      throw new Error(`RTP roto en el objetivo ${target}: ${rtp} en lugar de ${THEORETICAL_RTP}`);
    }
  }
  // The curve and its inverse must agree, or the animation would crash at a
  // different multiplier from the one the round committed to.
  for (const m of [1.01, 2, 7.5, 1000]) {
    if (Math.abs(multiplierAt(timeToReach(m)) - m) > 1e-9) {
      throw new Error(`timeToReach no invierte multiplierAt en ${m}`);
    }
  }
})();
