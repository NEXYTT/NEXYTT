/**
 * Card rules. Blackjack hand valuation is where naive implementations break
 * (multiple aces, three-card 21, ten-value pairs), so those are pinned first.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShoe, handValue, isSplittable, evaluatePoker, cardValue,
  SUITS, RANKS, isRedSuit, SUIT_SYMBOL,
} from "../casino/js/core/cards.js";
import { Round } from "../casino/js/core/rng.js";

const C = (rank, suit = "s") => ({ rank, suit, id: `${rank}${suit}` });

test("a shoe holds 52 cards per deck, all distinct", () => {
  assert.equal(buildShoe(1).length, 52);
  assert.equal(buildShoe(6).length, 312);
  assert.equal(new Set(buildShoe(6).map((c) => c.id)).size, 312, "ids must be unique across decks");

  const single = buildShoe(1);
  assert.equal(new Set(single.map((c) => c.rank + c.suit)).size, 52);
});

test("a shoe contains four of each rank per deck", () => {
  const counts = new Map();
  for (const card of buildShoe(2)) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  for (const rank of RANKS) assert.equal(counts.get(rank), 8, `wrong count for ${rank}`);
});

test("pip values: face cards are ten, an ace is one before promotion", () => {
  assert.equal(cardValue(C("K")), 10);
  assert.equal(cardValue(C("Q")), 10);
  assert.equal(cardValue(C("J")), 10);
  assert.equal(cardValue(C("10")), 10);
  assert.equal(cardValue(C("A")), 1);
  assert.equal(cardValue(C("7")), 7);
});

test("a natural is exactly two cards totalling 21", () => {
  const natural = handValue([C("A"), C("K")]);
  assert.equal(natural.total, 21);
  assert.equal(natural.blackjack, true);
  assert.equal(natural.soft, true);
});

test("21 built from three cards is not a blackjack", () => {
  const three = handValue([C("7"), C("7", "h"), C("7", "d")]);
  assert.equal(three.total, 21);
  assert.equal(three.blackjack, false, "a three-card 21 must not earn the 3:2 premium");
});

test("two aces total twelve, not twenty-two", () => {
  const pair = handValue([C("A"), C("A", "h")]);
  assert.equal(pair.total, 12);
  assert.equal(pair.soft, true);
  assert.equal(pair.busted, false);
});

test("four aces total fourteen", () => {
  // Only one ace may ever count as eleven.
  assert.equal(handValue([C("A"), C("A", "h"), C("A", "d"), C("A", "c")]).total, 14);
});

test("an ace demotes itself rather than busting the hand", () => {
  const soft = handValue([C("A"), C("6")]);
  assert.equal(soft.total, 17);
  assert.equal(soft.soft, true);

  const hard = handValue([C("A"), C("6"), C("9")]);
  assert.equal(hard.total, 16, "the ace drops back to one");
  assert.equal(hard.soft, false);
  assert.equal(hard.busted, false);
});

test("a hand over 21 is busted", () => {
  const busted = handValue([C("K"), C("Q"), C("5")]);
  assert.equal(busted.total, 25);
  assert.equal(busted.busted, true);
});

test("an empty hand is zero", () => {
  assert.equal(handValue([]).total, 0);
});

test("any two ten-valued cards may be split", () => {
  assert.equal(isSplittable([C("K"), C("Q", "h")]), true);
  assert.equal(isSplittable([C("10"), C("J", "h")]), true);
  assert.equal(isSplittable([C("8"), C("8", "h")]), true);
  assert.equal(isSplittable([C("8"), C("9", "h")]), false);
  assert.equal(isSplittable([C("8"), C("8", "h"), C("2")]), false, "only a two-card hand can split");
});

test("suit helpers agree with the rendering rules", () => {
  assert.deepEqual([...SUITS], ["s", "h", "d", "c"]);
  assert.equal(isRedSuit("h"), true);
  assert.equal(isRedSuit("d"), true);
  assert.equal(isRedSuit("s"), false);
  assert.equal(isRedSuit("c"), false);
  assert.equal(SUIT_SYMBOL.s, "♠");
});

test("poker hands are classified correctly", () => {
  const cases = [
    [[C("A"), C("K"), C("Q"), C("J"), C("10")], "royal_flush"],
    [[C("9"), C("8"), C("7"), C("6"), C("5")], "straight_flush"],
    [[C("A", "h"), C("2", "h"), C("3", "h"), C("4", "h"), C("5", "h")], "straight_flush"],
    [[C("9"), C("9", "h"), C("9", "d"), C("9", "c"), C("2")], "four_of_a_kind"],
    [[C("9"), C("9", "h"), C("9", "d"), C("2", "c"), C("2")], "full_house"],
    [[C("9"), C("4"), C("J"), C("2"), C("7")], "flush"],
    [[C("9"), C("8", "h"), C("7"), C("6"), C("5")], "straight"],
    [[C("A"), C("2", "h"), C("3"), C("4"), C("5")], "straight"],
    [[C("9"), C("9", "h"), C("9", "d"), C("4"), C("2")], "three_of_a_kind"],
    [[C("9"), C("9", "h"), C("J"), C("J", "c"), C("2")], "two_pair"],
    [[C("9"), C("9", "h"), C("J"), C("4"), C("2")], "pair"],
    [[C("9"), C("7", "h"), C("J"), C("4"), C("2")], "high_card"],
  ];
  for (const [hand, expected] of cases) {
    assert.equal(evaluatePoker(hand).category, expected, `misread ${hand.map((c) => c.rank + c.suit).join(" ")}`);
  }
});

test("the wheel is a five-high straight and ranks below every other straight", () => {
  const wheel = evaluatePoker([C("A"), C("2", "h"), C("3"), C("4"), C("5")]);
  const sixHigh = evaluatePoker([C("6"), C("2", "h"), C("3"), C("4"), C("5")]);
  const broadway = evaluatePoker([C("A"), C("K", "h"), C("Q"), C("J"), C("10")]);

  assert.equal(wheel.category, "straight");
  assert.equal(wheel.straightHigh, 5, "the ace plays low");
  assert.ok(sixHigh.strength > wheel.strength, "a 6-high straight must beat the wheel");
  assert.ok(broadway.strength > sixHigh.strength, "broadway must beat a 6-high straight");
});

test("strength gives a total ordering across categories and kickers", () => {
  const ordered = [
    [C("9"), C("7", "h"), C("J"), C("4"), C("2")],            // high card
    [C("9"), C("9", "h"), C("J"), C("4"), C("2")],            // pair of nines
    [C("K"), C("K", "h"), C("J"), C("4"), C("2")],            // pair of kings
    [C("9"), C("9", "h"), C("J"), C("J", "c"), C("2")],       // two pair
    [C("9"), C("9", "h"), C("9", "d"), C("4"), C("2")],       // trips
    [C("9"), C("8", "h"), C("7"), C("6"), C("5")],            // straight
    [C("9"), C("4"), C("J"), C("2"), C("7")],                 // flush
    [C("9"), C("9", "h"), C("9", "d"), C("2", "c"), C("2")],  // full house
    [C("9"), C("9", "h"), C("9", "d"), C("9", "c"), C("2")],  // quads
    [C("9"), C("8"), C("7"), C("6"), C("5")],                 // straight flush
    [C("A"), C("K"), C("Q"), C("J"), C("10")],                // royal
  ].map(evaluatePoker);

  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      ordered[i].strength > ordered[i - 1].strength,
      `${ordered[i].category} must outrank ${ordered[i - 1].category}`
    );
  }
});

test("K-Q-J-10-9 with mixed suits is a straight, not a flush", () => {
  assert.equal(evaluatePoker([C("K"), C("Q", "h"), C("J"), C("10"), C("9")]).category, "straight");
});

test("evaluatePoker demands exactly five cards", () => {
  assert.throws(() => evaluatePoker([C("A"), C("K")]), RangeError);
  assert.throws(() => evaluatePoker(buildShoe(1).slice(0, 6)), RangeError);
});

test("a shuffled shoe keeps every card exactly once", () => {
  const shoe = buildShoe(6);
  const shuffled = new Round("s", "c", 0).shuffle(shoe);
  assert.equal(shuffled.length, shoe.length);
  assert.equal(new Set(shuffled.map((c) => c.id)).size, shoe.length);
});
