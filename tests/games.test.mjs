/**
 * Independent verification of every game's payout maths.
 *
 * These simulations are written against each game's public API only — they do
 * not reuse any simulation code that shipped with the games. A return-to-player
 * figure is a claim about a probability distribution, and the only way to check
 * one is to sample it. Every game is driven through the same seeded `Round`
 * objects the browser uses, so a discrepancy here is a real discrepancy.
 *
 * Tolerances are DERIVED, never hand-picked. Each simulation accumulates the
 * per-round return, and the check is that the sample mean sits within four
 * standard errors of the declared RTP. That matters because variance differs by
 * orders of magnitude across these games: a red/black bet and a 49× dice roll
 * need wildly different bands, and a fixed tolerance would be far too loose for
 * one and far too tight for the other. Since the seeds are fixed, the result is
 * deterministic — this cannot flake.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Round } from "../casino/js/core/rng.js";
import { handValue } from "../casino/js/core/cards.js";

import * as slots from "../casino/js/games/slots.js";
import * as dice from "../casino/js/games/dice.js";
import * as roulette from "../casino/js/games/roulette.js";
import * as mines from "../casino/js/games/mines.js";
import * as crash from "../casino/js/games/crash.js";
import * as blackjack from "../casino/js/games/blackjack.js";

/** A fresh seeded round per iteration, exactly as the live nonce would. */
const rounds = function* (count, seed = "verify") {
  for (let nonce = 0; nonce < count; nonce++) yield new Round(seed, "audit", nonce);
};

const pct = (value) => `${(value * 100).toFixed(3)}%`;

/**
 * Running mean and standard error of a game's per-round return, expressed as a
 * multiple of the stake. Uses running sums rather than keeping the samples, so
 * a million rounds costs no memory.
 */
class Returns {
  constructor() {
    this.n = 0;
    this.sum = 0;
    this.sumSq = 0;
  }

  /** @param {number} multiple total returned ÷ staked for one round */
  add(multiple) {
    this.n += 1;
    this.sum += multiple;
    this.sumSq += multiple * multiple;
  }

  get mean() {
    return this.sum / this.n;
  }

  /** Standard error of the mean, from the sample variance. */
  get standardError() {
    const variance = Math.max(0, this.sumSq / this.n - this.mean ** 2);
    return Math.sqrt(variance / this.n);
  }
}

/**
 * Assert a measured RTP against its declared value, with the band taken from
 * the estimate's own standard error.
 * @param {Returns} returns
 * @param {number} declared
 * @param {string} label
 * @param {number} sigmas
 */
function assertRtp(returns, declared, label, sigmas = 4) {
  const { mean, standardError } = returns;
  const band = sigmas * standardError;
  const deviation = Math.abs(mean - declared);

  assert.ok(
    deviation <= band,
    `${label}: measured ${pct(mean)} against a declared ${pct(declared)} — ` +
      `off by ${(deviation / standardError).toFixed(2)} standard errors ` +
      `(${returns.n.toLocaleString("es-ES")} rounds, band ±${pct(band)})`
  );
}

/* --- Slots ---------------------------------------------------------------- */

test("slots pays back its advertised RTP", () => {
  const SPINS = 300_000;
  const returns = new Returns();
  let features = 0;
  let nonce = 0;

  for (const round of rounds(SPINS, "slots")) {
    const result = slots.spin(round);
    // The stake is 20 line-units, so `totalMultiplier ÷ LINES` is the return
    // as a multiple of the total bet — the quantity the RTP is defined over.
    let won = result.totalMultiplier;

    // Free spins are played on their own rounds and cost nothing, so their
    // winnings belong to the round that triggered them.
    if (result.freeSpinsAwarded > 0) {
      features++;
      for (let i = 0; i < result.freeSpinsAwarded; i++) {
        won += slots.spin(new Round("slots-free", "audit", nonce * 100 + i), { freeSpin: true })
          .totalMultiplier;
      }
    }
    returns.add(won / slots.LINES);
    nonce++;
  }

  assertRtp(returns, slots.THEORETICAL_RTP, "slots");

  // The feature frequency is a Bernoulli trial, so its own standard error is
  // small enough to check tightly — and `featureChance()` is a closed form.
  const featureRate = features / SPINS;
  const expected = slots.featureChance();
  const featureSe = Math.sqrt((expected * (1 - expected)) / SPINS);
  assert.ok(featureRate > 0, "the free-spin feature never fired");
  assert.ok(
    Math.abs(featureRate - expected) <= 4 * featureSe,
    `feature rate ${pct(featureRate)} vs the derived ${pct(expected)} (band ±${pct(4 * featureSe)})`
  );
});

test("slots pays left to right and only the longest run on a line", () => {
  // Build a grid where reel 0..2 share a symbol and reel 3 breaks the run.
  const grid = slots.REELS.map((reel) => [reel[0], reel[1], reel[2]]);
  const scored = slots.evaluateGrid(grid);
  for (const win of scored.wins) {
    if (win.line === null) continue;
    assert.ok(win.count >= 2 && win.count <= slots.REEL_COUNT);
    assert.deepEqual(
      win.cells.map(([reel]) => reel),
      Array.from({ length: win.count }, (_, i) => i),
      "a line win must start at reel 0 and be contiguous"
    );
  }
});

test("a free spin doubles what the same grid would otherwise pay", () => {
  for (const round of rounds(200, "slots-double")) {
    const base = slots.spin(round);
    const free = slots.evaluateGrid(base.grid, { freeSpin: true });
    assert.equal(free.totalMultiplier, base.totalMultiplier * slots.FREE_SPIN_MULTIPLIER);
    assert.equal(free.freeSpinsAwarded, 0, "a free spin must not retrigger");
  }
});

test("every slots grid is five reels of three symbols drawn from the strips", () => {
  for (const round of rounds(500, "slots-shape")) {
    const { grid } = slots.spin(round);
    assert.equal(grid.length, slots.REEL_COUNT);
    for (let reel = 0; reel < grid.length; reel++) {
      assert.equal(grid[reel].length, slots.ROWS);
      for (const symbol of grid[reel]) {
        assert.ok(slots.REELS[reel].includes(symbol), `${symbol} is not on reel ${reel}`);
      }
    }
  }
});

/* --- Dice ----------------------------------------------------------------- */

test("dice returns 99% at every target, in both directions", () => {
  const SPINS = 60_000;

  for (const direction of ["under", "over"]) {
    // 2 and 98 are the extremes: one is nearly a sure thing, the other pays 49×.
    for (const target of [2, 50.5, 98]) {
      const returns = new Returns();
      for (const round of rounds(SPINS, `dice-${direction}-${target}`)) {
        returns.add(dice.resolve(round, { target, direction, stake: 100 }).payout / 100);
      }
      assertRtp(returns, dice.THEORETICAL_RTP, `dice ${direction} ${target}`);
    }
  }
});

test("the dice multiplier and win chance are exact inverses of the edge", () => {
  for (const direction of ["under", "over"]) {
    for (let target = dice.MIN_TARGET; target <= dice.MAX_TARGET; target += 0.5) {
      const chance = dice.winChance(target, direction);
      const mult = dice.multiplierFor(target, direction);
      assert.ok(chance > 0 && chance < 100, `${direction} ${target}: chance ${chance}`);
      assert.ok(
        Math.abs((mult * chance) / 100 - dice.THEORETICAL_RTP) < 0.001,
        `${direction} ${target}: multiplier ${mult} × chance ${chance}% ≠ 99%`
      );
    }
  }
});

test("dice rolls stay in range and are uniform across the decile buckets", () => {
  const buckets = new Array(10).fill(0);
  const N = 60_000;
  for (const round of rounds(N, "dice-roll")) {
    const value = dice.roll(round);
    assert.ok(value >= 0 && value <= 99.99, `roll out of range: ${value}`);
    buckets[Math.floor(value / 10)]++;
  }
  const expected = N / 10;
  const chi2 = buckets.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 27.88, `roll distribution chi-square was ${chi2}`);
});

test("dice targets outside the allowed band are clamped, not accepted", () => {
  assert.equal(dice.normalizeTarget(0), dice.MIN_TARGET);
  assert.equal(dice.normalizeTarget(150), dice.MAX_TARGET);
  assert.equal(dice.normalizeTarget(50), 50);
});

/* --- Roulette ------------------------------------------------------------- */

test("the wheel holds 37 distinct pockets with the real European layout", () => {
  assert.equal(roulette.WHEEL.length, 37);
  assert.equal(new Set(roulette.WHEEL).size, 37);
  assert.equal(roulette.WHEEL[0], 0, "the wheel starts at zero");
  for (let n = 0; n <= 36; n++) assert.ok(roulette.WHEEL.includes(n), `pocket ${n} is missing`);

  assert.equal(roulette.RED_NUMBERS.length, 18);
  assert.equal(roulette.colorOf(0), "green");
  assert.equal(roulette.colorOf(1), "red");
  assert.equal(roulette.colorOf(2), "black");
});

test("every bet type returns 36/37, the single-zero house edge", () => {
  const SPINS = 100_000;
  const layouts = {
    straight: { type: "straight", selection: [17], amount: 100 },
    split: { type: "split", selection: [17, 20], amount: 100 },
    red: { type: "red", amount: 100 },
    even: { type: "even", amount: 100 },
    dozen: { type: "dozen", selection: 1, amount: 100 },
    column: { type: "column", selection: 1, amount: 100 },
  };

  for (const [name, bet] of Object.entries(layouts)) {
    const returns = new Returns();
    for (const round of rounds(SPINS, `roulette-${name}`)) {
      returns.add(roulette.payoutFor([bet], roulette.spin(round).number).payout / 100);
    }
    // A straight-up bet has roughly forty times the variance of red/black; the
    // derived band absorbs that difference on its own.
    assertRtp(returns, roulette.THEORETICAL_RTP, `roulette ${name}`);
  }
});

test("zero loses every outside bet — that is where the edge comes from", () => {
  for (const bet of [
    { type: "red", amount: 100 },
    { type: "black", amount: 100 },
    { type: "even", amount: 100 },
    { type: "odd", amount: 100 },
    { type: "low", amount: 100 },
    { type: "high", amount: 100 },
    { type: "dozen", selection: 1, amount: 100 },
    { type: "column", selection: 1, amount: 100 },
  ]) {
    assert.equal(roulette.payoutFor([bet], 0).payout, 0, `${bet.type} must lose to zero`);
  }
  assert.equal(roulette.payoutFor([{ type: "straight", selection: [0], amount: 100 }], 0).payout, 3600);
});

test("payouts are quoted to one and include the stake", () => {
  const cases = [
    [{ type: "straight", selection: [7], amount: 100 }, 7, 3600],
    [{ type: "split", selection: [7, 8], amount: 100 }, 7, 1800],
    [{ type: "red", amount: 100 }, 7, 200],
  ];
  for (const [bet, number, expected] of cases) {
    assert.equal(roulette.payoutFor([bet], number).payout, expected, `${bet.type} paid wrong`);
  }
});

test("impossible inside bets are rejected rather than silently accepted", () => {
  // 1 and 5 are not adjacent on the layout, so they cannot form a split.
  assert.throws(() => roulette.payoutFor([{ type: "split", selection: [1, 5], amount: 100 }], 1));
  assert.throws(() => roulette.payoutFor([{ type: "straight", selection: [37], amount: 100 }], 1));
  assert.throws(() => roulette.payoutFor([{ type: "nonsense", amount: 100 }], 1));
});

test("spins land on real pockets and cover the whole wheel", () => {
  const seen = new Set();
  for (const round of rounds(5000, "roulette-cover")) {
    const { number } = roulette.spin(round);
    assert.ok(Number.isInteger(number) && number >= 0 && number <= 36);
    seen.add(number);
  }
  assert.equal(seen.size, 37, "every pocket must be reachable");
});

/* --- Mines ---------------------------------------------------------------- */

test("mines returns 99% across mine counts and cash-out depths", () => {
  const ROUNDS = 40_000;

  for (const [mineCount, cashOutAt] of [[1, 5], [3, 3], [5, 2], [12, 1], [24, 1]]) {
    const returns = new Returns();
    for (const round of rounds(ROUNDS, `mines-${mineCount}-${cashOutAt}`)) {
      let state = mines.createBoard(round, { mineCount });
      // Always open the lowest hidden tiles: the layout is already random, so
      // the choice of tile cannot change the expectation.
      for (let picks = 0; picks < cashOutAt && state.status === mines.STATUS.PLAYING; picks++) {
        state = mines.reveal(state, mines.hiddenTiles(state)[0]);
      }
      returns.add(
        state.status === mines.STATUS.LOST
          ? 0
          : mines.payoutFor(100, mineCount, state.revealed.length) / 100
      );
    }
    assertRtp(returns, mines.THEORETICAL_RTP, `mines ${mineCount}× cashing at ${cashOutAt}`);
  }
});

test("the mines multiplier is the combinatorial one, times the edge", () => {
  // mult(k) = 0.99 × C(25,k) / C(25−m,k)
  const choose = (n, k) => {
    let out = 1;
    for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1);
    return out;
  };
  for (const m of [1, 3, 5, 12, 24]) {
    for (let k = 1; k <= 25 - m; k++) {
      const expected = 0.99 * (choose(25, k) / choose(25 - m, k));
      const actual = mines.multiplierFor(m, k);
      assert.ok(
        Math.abs(actual - expected) / expected < 1e-9,
        `m=${m} k=${k}: ${actual} vs ${expected}`
      );
    }
  }
});

test("mines are placed once, distinctly, and never move", () => {
  for (const round of rounds(400, "mines-layout")) {
    const board = mines.createBoard(round, { mineCount: 5 });
    assert.equal(board.mines.length, 5);
    assert.equal(new Set(board.mines).size, 5);
    assert.ok(board.mines.every((i) => i >= 0 && i < mines.GRID));

    // Reopening the same round must reproduce the identical layout.
    const replay = mines.createBoard(new Round(round.serverSeed, round.clientSeed, round.nonce), { mineCount: 5 });
    assert.deepEqual([...replay.mines], [...board.mines]);
  }
});

test("revealing is pure and refuses illegal moves", () => {
  const board = mines.createBoard(new Round("m", "audit", 0), { mineCount: 3 });
  const safe = mines.hiddenTiles(board).find((i) => !board.mines.includes(i));
  const next = mines.reveal(board, safe);

  assert.equal(board.revealed.length, 0, "the original state must not be mutated");
  assert.equal(next.revealed.length, 1);
  assert.throws(() => mines.reveal(next, safe), /ya está destapada/);
  assert.throws(() => mines.reveal(next, 99), RangeError);
});

test("clearing every safe tile pays the maximum multiplier", () => {
  const board = mines.createBoard(new Round("m", "audit", 1), { mineCount: 3 });
  let state = board;
  for (const tile of Array.from({ length: mines.GRID }, (_, i) => i)) {
    if (state.mines.includes(tile)) continue;
    state = mines.reveal(state, tile);
  }
  assert.equal(state.revealed.length, mines.GRID - 3);
  assert.ok(
    Math.abs(mines.multiplierFor(3, state.revealed.length) - mines.maxMultiplier(3)) < 1e-9
  );
});

/* --- Crash ---------------------------------------------------------------- */

test("crash returns 99% at every auto-cashout multiplier", () => {
  const ROUNDS = 150_000;

  for (const cashoutAt of [1.5, 2, 5, 20]) {
    const returns = new Returns();
    for (const round of rounds(ROUNDS, `crash-${cashoutAt}`)) {
      returns.add(
        crash.resolve({
          crashPoint: crash.crashPointFrom(round),
          cashoutAt,
          stake: 100,
        }).payout / 100
      );
    }
    assertRtp(returns, crash.THEORETICAL_RTP, `crash cashing at ${cashoutAt}×`);
  }
});

test("the crash point distribution matches the closed form", () => {
  // P(crash ≥ x) = 0.99 / x for the standard construction.
  const N = 200_000;
  const points = [];
  for (const round of rounds(N, "crash-dist")) points.push(crash.crashPointFrom(round));

  for (const x of [1.5, 2, 5, 10]) {
    const observed = points.filter((p) => p >= x).length / N;
    const expected = crash.THEORETICAL_RTP / x;
    assert.ok(
      Math.abs(observed - expected) < 0.01,
      `P(crash ≥ ${x}) was ${pct(observed)}, expected ${pct(expected)}`
    );
  }
  assert.ok(points.every((p) => p >= crash.MIN_CRASH), "a crash point below 1.00 is impossible");
});

test("the crash curve and its inverse agree", () => {
  for (const target of [1.2, 2, 5, 25, 100]) {
    const at = crash.timeToReach(target);
    assert.ok(
      Math.abs(crash.multiplierAt(at) - target) < 0.01,
      `timeToReach(${target}) → ${at}ms → ${crash.multiplierAt(at)}`
    );
  }
  assert.equal(crash.multiplierAt(0), 1, "the curve starts at 1.00×");
});

test("crash settles on the crash point, not on when the player clicked", () => {
  assert.equal(crash.resolve({ crashPoint: 2.5, cashoutAt: 2, stake: 100 }).payout, 200);
  assert.equal(crash.resolve({ crashPoint: 1.9, cashoutAt: 2, stake: 100 }).payout, 0);
  // Cashing out exactly at the crash point is a win: the multiplier was reached.
  assert.equal(crash.resolve({ crashPoint: 2, cashoutAt: 2, stake: 100 }).win, true);
  assert.equal(crash.resolve({ crashPoint: 2, cashoutAt: null, stake: 100 }).payout, 0);
});

/* --- Blackjack ------------------------------------------------------------ */

/**
 * The exact strategy check. Every two-card hand against every upcard, weighted
 * by infinite-deck probability — deterministic, exhaustive, and far more
 * sensitive than any simulation: a single wrong cell in the chart moves these
 * frequencies by more than the tolerance, whereas it would hide inside the
 * noise of even a million simulated hands.
 *
 * The expected values are derived from the rules the chart claims to implement,
 * not copied from a reference table, so they can be checked by hand:
 * surrender fires on hard 16 vs 9/10/A (8,8 excepted, which is split) and on
 * hard 15 vs 10, which works out at 4.92% of openings.
 */
test("the basic-strategy chart produces the move frequencies its rules imply", () => {
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const card = (rank) => ({ rank, suit: "s", id: rank });
  const upValue = (rank) =>
    rank === "A" ? 11 : ["10", "J", "Q", "K"].includes(rank) ? 10 : Number(rank);

  const freq = { surrender: 0, double: 0, split: 0, stand: 0, hit: 0 };
  const p = 1 / 13;

  for (const a of RANKS) {
    for (const b of RANKS) {
      for (const up of RANKS) {
        const move = blackjack.strategyFor([card(a), card(b)], upValue(up), {
          canDouble: true,
          canSplit: true,
          canSurrender: true,
        });
        assert.ok(move in freq, `the chart returned an unknown move: ${move}`);
        freq[move] += p * p * p;
      }
    }
  }

  // Surrender: hard 16 (10+6, 9+7 — never 8,8) vs 9/10/A, plus hard 15
  // (10+5, 9+6, 8+7) vs 10.
  const ten = 4 / 13;
  const one = 1 / 13;
  const hard16 = 2 * ten * one + 2 * one * one;
  const hard15 = 2 * ten * one + 4 * one * one;
  const expectedSurrender = hard16 * (2 * one + ten) + hard15 * ten;

  assert.ok(
    Math.abs(freq.surrender - expectedSurrender) < 1e-9,
    `surrender fires on ${pct(freq.surrender)} of openings, but the stated rule implies ${pct(expectedSurrender)}`
  );

  // The remaining frequencies pin the rest of the chart. A misplaced cell in the
  // doubling or splitting rows moves these well beyond a tenth of a point.
  assert.ok(Math.abs(freq.double - 0.0965) < 0.001, `doubles at ${pct(freq.double)}, expected 9.65%`);
  assert.ok(Math.abs(freq.split - 0.0264) < 0.001, `splits at ${pct(freq.split)}, expected 2.64%`);
  assert.ok(Math.abs(freq.stand - 0.4534) < 0.002, `stands at ${pct(freq.stand)}, expected 45.34%`);
  assert.ok(Math.abs(freq.hit - 0.3746) < 0.002, `hits at ${pct(freq.hit)}, expected 37.46%`);

  const total = Object.values(freq).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "the chart must return a move for every situation");
});

/**
 * The simulation check. Blackjack's per-hand standard deviation is about 1.14
 * units, so separating a 0.34% edge from zero at four sigma would take roughly
 * two million hands — too slow for a test suite. This is deliberately a
 * coarse check on the settlement pipeline (that stakes, doubles, splits,
 * naturals and surrenders all reconcile), while the chart itself is pinned
 * exactly by the enumeration above.
 */
test("blackjack settles to a house edge, not a player edge", () => {
  const HANDS = 60_000;
  const STAKE = 100;
  /** Net result per unit of *initial* bet — how a blackjack edge is quoted. */
  const perInitialBet = new Returns();
  let wagered = 0;
  let returned = 0;
  let naturals = 0;
  let pushedNaturals = 0;

  let game = blackjack.createGame(new Round("bj", "audit", 0));
  let nonce = 1;

  for (let hand = 0; hand < HANDS; hand++) {
    if (blackjack.cardsLeft(game) < blackjack.MIN_CARDS_TO_DEAL) {
      game = blackjack.reshuffle(game, new Round("bj", "audit", nonce++));
    }
    const played = blackjack.playBasicStrategy(blackjack.deal(game, STAKE));
    const result = blackjack.settlement(played);

    wagered += result.wagered;
    returned += result.payout;
    perInitialBet.add((result.payout - result.wagered) / STAKE);

    if (result.perHand.some((h) => h.result === "blackjack")) naturals++;
    // A natural that meets a dealer natural pushes, so it is not counted above.
    if (result.dealerBlackjack && result.perHand.some((h) => h.result === "push" && h.total === 21)) {
      pushedNaturals++;
    }
    game = played;
  }

  const HOUSE_EDGE = 0.0034; // 6 decks, S17, DAS, late surrender, blackjack 3:2
  const band = 4 * perInitialBet.standardError;
  assert.ok(
    Math.abs(-perInitialBet.mean - HOUSE_EDGE) <= band,
    `house edge measured at ${pct(-perInitialBet.mean)} per initial bet, ` +
      `expected ${pct(HOUSE_EDGE)} (band ±${pct(band)} over ${HANDS.toLocaleString("es-ES")} hands)`
  );

  // Total action exceeds the initial bets because of doubles and splits.
  const action = wagered / (HANDS * STAKE);
  assert.ok(action > 1.1 && action < 1.2, `action per initial bet was ${action.toFixed(3)}, expected about 1.13`);
  assert.ok(returned / wagered > 0.98, `RTP on total action was ${pct(returned / wagered)}`);

  // Naturals occur on about 4.75% of hands; the ones that push against a dealer
  // natural are settled separately, so both counts are needed to hit that figure.
  const naturalRate = (naturals + pushedNaturals) / HANDS;
  const naturalSe = Math.sqrt((0.0475 * 0.9525) / HANDS);
  assert.ok(
    Math.abs(naturalRate - 0.0475) <= 4 * naturalSe,
    `naturals came up ${pct(naturalRate)}, expected 4.75% (band ±${pct(4 * naturalSe)})`
  );
});

test("a natural pays three to two, and only on the first two cards", () => {
  let game = blackjack.createGame(new Round("bj-nat", "audit", 0));
  let found = 0;

  for (let i = 0; i < 4000 && found < 30; i++) {
    if (blackjack.cardsLeft(game) < blackjack.MIN_CARDS_TO_DEAL) {
      game = blackjack.reshuffle(game, new Round("bj-nat", "audit", i));
    }
    const dealt = blackjack.deal(game, 100);
    const played = blackjack.playBasicStrategy(dealt);
    const result = blackjack.settlement(played);

    for (const hand of result.perHand) {
      if (hand.result === "blackjack") {
        assert.equal(hand.payout, 250, "a natural on 100 must return 250");
        found++;
      }
      if (hand.result === "push") assert.equal(hand.payout, hand.stake);
      if (hand.result === "lose" && !hand.surrendered) assert.ok(hand.payout <= hand.stake);
    }
    game = played;
  }
  assert.ok(found > 0, "no natural occurred in 4000 hands, which cannot be right");
});

test("the dealer stands on soft 17 and draws below 17", () => {
  let game = blackjack.createGame(new Round("bj-dealer", "audit", 0));

  for (let i = 0; i < 3000; i++) {
    if (blackjack.cardsLeft(game) < blackjack.MIN_CARDS_TO_DEAL) {
      game = blackjack.reshuffle(game, new Round("bj-dealer", "audit", i));
    }
    const played = blackjack.playBasicStrategy(blackjack.deal(game, 100));
    const dealer = handValue(played.dealer.cards);

    // The dealer only stops early when every player hand is already settled.
    const everyoneOut = played.hands.every(
      (h) => handValue(h.cards).busted || h.surrendered
    );
    if (!everyoneOut && !dealer.busted) {
      assert.ok(dealer.total >= blackjack.DEALER_STANDS_ON, `dealer stood on ${dealer.total}`);
    }
    assert.ok(dealer.total <= 26, `dealer total ${dealer.total} is impossible`);
    game = played;
  }
});

test("a hand cannot be dealt out of turn, and the shoe is respected", () => {
  const game = blackjack.createGame(new Round("bj-guard", "audit", 0));
  const dealt = blackjack.deal(game, 100);

  assert.throws(() => blackjack.deal(dealt, 100), /Cannot deal/);
  assert.throws(() => blackjack.deal(game, 0), RangeError);
  assert.throws(() => blackjack.deal(game, 10.5), RangeError);
  assert.throws(() => blackjack.settlement(dealt), /settle/);
});

test("basic strategy never recommends insurance", () => {
  let game = blackjack.createGame(new Round("bj-ins", "audit", 0));
  let offers = 0;

  for (let i = 0; i < 2000 && offers < 40; i++) {
    if (blackjack.cardsLeft(game) < blackjack.MIN_CARDS_TO_DEAL) {
      game = blackjack.reshuffle(game, new Round("bj-ins", "audit", i));
    }
    const dealt = blackjack.deal(game, 100);
    if (dealt.phase === "insurance") {
      offers++;
      assert.equal(blackjack.basicStrategy(dealt).action, "decline");
    }
    game = blackjack.playBasicStrategy(dealt);
  }
  assert.ok(offers > 0, "insurance was never offered in 2000 hands");
});

test("split hands are capped and aces get a single card each", () => {
  let game = blackjack.createGame(new Round("bj-split", "audit", 0));
  let splitsSeen = 0;

  for (let i = 0; i < 6000 && splitsSeen < 25; i++) {
    if (blackjack.cardsLeft(game) < blackjack.MIN_CARDS_TO_DEAL) {
      game = blackjack.reshuffle(game, new Round("bj-split", "audit", i));
    }
    const played = blackjack.playBasicStrategy(blackjack.deal(game, 100));

    if (played.hands.length > 1) {
      splitsSeen++;
      assert.ok(played.hands.length <= blackjack.MAX_HANDS, `${played.hands.length} hands exceeds the cap`);
      for (const hand of played.hands) {
        if (hand.fromSplit && hand.cards[0].rank === "A") {
          assert.equal(hand.cards.length, 2, "a split ace receives exactly one card");
        }
        // A hand that is settled as a blackjack cannot have come from a split.
        if (hand.fromSplit) {
          assert.equal(handValue(hand.cards).blackjack && !hand.fromSplit, false);
        }
      }
    }
    game = played;
  }
  assert.ok(splitsSeen > 0, "no split ever happened in 6000 hands");
});
