/**
 * Dados — pure game logic. No DOM, importable from node.
 *
 * Randomness comes exclusively from a `Round` (../core/rng.js): a roll reads a
 * single float from stream position 0, so a result is reproducible from its
 * seed triple and there is no `Math.random()` in this file. Reading only
 * position 0 is deliberate — it makes this the easiest game in the casino to
 * verify by hand: one float, one multiplication, one floor.
 *
 * ## The result space
 * A roll is `floor(f × 10 000) / 100`, i.e. one of the 10 000 equally likely
 * values 0,00 · 0,01 · … · 99,99. Working in hundredths ("ticks") instead of
 * decimals is what keeps every probability exact:
 *
 *   - MENOR QUE t wins on ticks 0 … t−1        → t outcomes
 *   - MAYOR QUE t wins on ticks t+1 … 9 999    → 9 999 − t outcomes
 *
 * Landing exactly on the target loses either way, which is why the two
 * directions add up to 99,99 % and not 100 %. That tie is *not* where the house
 * edge lives — see below.
 *
 * ## Where the edge lives, and why the RTP is flat
 * The multiplier is priced as `(100 − ventaja) / probabilidad`, so
 *
 *     RTP = multiplicador × probabilidad / 100 = (100 − ventaja) / 100
 *
 * regardless of the target or the direction chosen. With a 1 % edge that is
 * exactly 99 %, from the 2,00 boundary (49,50×) to the 98,00 one (1,0102×).
 * A player picking a wild target is buying variance, never a better deal — the
 * invariant is asserted at import time so a typo cannot quietly break it.
 *
 * ## Money
 * Stakes and payouts are integer minor units (credits × 100). The multiplier is
 * a real number, so the payout is rounded once, at the end. That rounding is
 * the only deviation from a perfect 99 % and it is worth ~0,005 % on a 10,00
 * credit stake — invisible next to the edge itself.
 */

/** Distinct results: 0,00 … 99,99. */
export const FACES = 10_000;
/** Tightest and widest targets the table accepts, in the 0–100 scale. */
export const MIN_TARGET = 2;
export const MAX_TARGET = 98;
/** Targets move in hundredths, the same granularity as the roll. */
export const TARGET_STEP = 0.01;
/** House advantage baked into every multiplier. */
export const HOUSE_EDGE = 0.01;
/** Return to player, identical for every target and direction. */
export const THEORETICAL_RTP = 1 - HOUSE_EDGE;

/** The two bets available. `under` wins below the target, `over` above it. */
export const DIRECTIONS = Object.freeze(["under", "over"]);

/** Human labels, kept next to the logic so the UI cannot invent a third one. */
export const DIRECTION_LABELS = Object.freeze({
  under: "Menor que",
  over: "Mayor que",
});

/** Opposite direction, for the invert button. */
export const oppositeDirection = (direction) => (direction === "over" ? "under" : "over");

/** Coerce anything to one of the two legal directions. */
const normalizeDirection = (direction) => (direction === "over" ? "over" : "under");

/**
 * Clamp a target into [2, 98] and snap it to a hundredth.
 * Everything downstream assumes a normalized target, so this runs at every
 * entry point rather than trusting the caller.
 * @param {number|string} target
 * @returns {number}
 */
export function normalizeTarget(target) {
  // Accepts the Spanish decimal comma: this is the entry point a typed target
  // arrives through, and `Number("45,7")` is NaN, which would silently snap a
  // deliberate 45,70 back to the 2,00 minimum.
  const value = typeof target === "string" ? Number(target.replace(",", ".")) : Number(target);
  if (!Number.isFinite(value)) return MIN_TARGET;
  const clamped = Math.min(MAX_TARGET, Math.max(MIN_TARGET, value));
  // Both this and `roll()` produce `integer / 100`, which makes the strict
  // comparison in `resolve()` exact: identical integers divided by 100 yield
  // bit-identical doubles, so a roll can never "almost" equal its target.
  return Math.round(clamped * 100) / 100;
}

/** The target expressed in hundredths — the unit every count below is in. */
const ticksOf = (target) => Math.round(normalizeTarget(target) * 100);

/**
 * Roll the dice: a number with two decimals in [0,00 – 99,99].
 * Consumes stream position 0 and nothing else.
 * @param {import('../core/rng.js').Round} round
 * @returns {number}
 */
export function roll(round) {
  // `Round` floats are strictly below 1, so the product never reaches 10 000
  // and the result never exceeds 99,99.
  return Math.floor(round.at(0) * FACES) / 100;
}

/**
 * Probability of winning, as a percentage (not a ratio).
 * @param {number} target
 * @param {"under"|"over"} direction
 * @returns {number} percentage in (0, 100)
 */
export function winChance(target, direction) {
  const ticks = ticksOf(target);
  // `under` wins on ticks below the target; `over` on ticks above it. The tick
  // that equals the target belongs to neither, hence the −1.
  const winning = normalizeDirection(direction) === "over" ? FACES - 1 - ticks : ticks;
  return winning / 100;
}

/**
 * Payout multiplier for a bet, including the stake itself (2× means "get your
 * stake back plus the same again").
 * @param {number} target
 * @param {"under"|"over"} direction
 * @param {number} [houseEdge] 0.01 = 1 %
 * @returns {number}
 */
export function multiplierFor(target, direction, houseEdge = HOUSE_EDGE) {
  const chance = winChance(target, direction);
  if (chance <= 0) return 0;
  return (100 * (1 - houseEdge)) / chance;
}

/**
 * Net profit on a winning bet, in minor units — what the player actually gains
 * on top of the returned stake. Rounded exactly like the real payout, so the
 * figure shown before the roll is the figure credited after it.
 * @param {number} stake minor units
 * @param {number} target
 * @param {"under"|"over"} direction
 * @param {number} [houseEdge]
 * @returns {number} minor units
 */
export function profitFor(stake, target, direction, houseEdge = HOUSE_EDGE) {
  return Math.round(stake * multiplierFor(target, direction, houseEdge)) - stake;
}

/**
 * Resolve one bet against a round.
 *
 * @param {import('../core/rng.js').Round} round
 * @param {{target: number, direction?: "under"|"over", stake?: number}} bet
 * @returns {{roll: number, win: boolean, multiplier: number, payout: number, chance: number}}
 *   `payout` is the total return (0 on a loss), not the profit.
 */
export function resolve(round, { target, direction = "under", stake = 0 }) {
  const t = normalizeTarget(target);
  const dir = normalizeDirection(direction);
  const value = roll(round);
  const multiplier = multiplierFor(t, dir);
  // Strict on both sides: an exact hit on the target is a loss either way.
  const win = dir === "under" ? value < t : value > t;

  return {
    roll: value,
    win,
    multiplier,
    payout: win ? Math.round(stake * multiplier) : 0,
    chance: winChance(t, dir),
  };
}

/**
 * Plain-language statement of the winning condition, for the UI and for
 * screen readers ("Gana si el número es menor que 45,23").
 * @param {number} target
 * @param {"under"|"over"} direction
 */
export function conditionLabel(target, direction) {
  const t = normalizeTarget(target).toFixed(2).replace(".", ",");
  return `Gana si el número es ${normalizeDirection(direction) === "over" ? "mayor" : "menor"} que ${t}`;
}

/**
 * The house edge actually delivered by a target/direction pair.
 * Exposed so the UI can prove the number rather than assert it.
 * @returns {number} 0.01 for every legal bet
 */
export function edgeOf(target, direction, houseEdge = HOUSE_EDGE) {
  return 1 - (multiplierFor(target, direction, houseEdge) * winChance(target, direction)) / 100;
}

// A wrong sign or a stray offset in the tick maths would bias every payout in
// the game while still "looking right" on screen, so the flat-RTP invariant is
// checked once at import instead of trusted. The sweep covers both boundaries,
// both directions and a spread of awkward fractional targets.
(function assertFlatRtp() {
  const samples = [MIN_TARGET, 2.01, 4.37, 25.5, 49.99, 50, 50.01, 75.25, 97.99, MAX_TARGET];
  for (const target of samples) {
    for (const direction of DIRECTIONS) {
      const rtp = (multiplierFor(target, direction) * winChance(target, direction)) / 100;
      if (Math.abs(rtp - THEORETICAL_RTP) > 1e-9) {
        throw new Error(
          `RTP roto en objetivo ${target} ${direction}: ${rtp} en lugar de ${THEORETICAL_RTP}`
        );
      }
    }
  }
  // The two directions partition every outcome except the exact tie.
  const complement = winChance(37.42, "under") + winChance(37.42, "over");
  if (Math.abs(complement - 99.99) > 1e-9) {
    throw new Error(`Las dos direcciones deben sumar 99,99 %, suman ${complement}`);
  }
})();
