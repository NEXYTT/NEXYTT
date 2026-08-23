/**
 * Playing-card engine: deck construction, provably-fair shuffling, and hand
 * evaluation for Blackjack and 5-card poker.
 *
 * A card is a plain object `{ rank, suit, id }`. Ranks are the strings
 * "A","2".."10","J","Q","K"; suits are "s","h","d","c". `id` is unique within
 * a shoe so the UI can key DOM nodes even with duplicate ranks across decks.
 */

export const SUITS = /** @type {const} */ (["s", "h", "d", "c"]);
export const RANKS = /** @type {const} */ ([
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
]);

export const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const SUIT_NAME = { s: "picas", h: "corazones", d: "diamantes", c: "tréboles" };
/** Hearts and diamonds render red; spades and clubs render dark. */
export const isRedSuit = (suit) => suit === "h" || suit === "d";

/**
 * Build a shoe of `deckCount` standard 52-card decks, in canonical order.
 * @param {number} deckCount
 * @returns {{rank:string, suit:string, id:string}[]}
 */
export function buildShoe(deckCount = 1) {
  const shoe = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit, id: `${rank}${suit}-${d}` });
      }
    }
  }
  return shoe;
}

/**
 * Shuffle a shoe using a provably-fair round's stream.
 * @param {ReturnType<typeof buildShoe>} shoe
 * @param {import('./rng.js').Round} round
 * @param {number} streamOffset
 */
export function shuffleShoe(shoe, round, streamOffset = 0) {
  return round.shuffle(shoe, streamOffset);
}

/* --- Blackjack ----------------------------------------------------------- */

/** Blackjack pip value; aces are counted as 1 here and promoted in `handValue`. */
export function cardValue(card) {
  if (card.rank === "A") return 1;
  if (card.rank === "K" || card.rank === "Q" || card.rank === "J") return 10;
  return Number(card.rank);
}

/**
 * Evaluate a Blackjack hand.
 *
 * Soft-hand rule: at most one ace can count as 11 without busting, so we sum
 * aces as 1 and promote a single ace by +10 when it fits. This is exactly the
 * casino rule and avoids the classic "two aces = 22" bug.
 *
 * @param {{rank:string,suit:string}[]} cards
 * @returns {{total:number, soft:boolean, busted:boolean, blackjack:boolean, pairRank:string|null}}
 */
export function handValue(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === "A") aces += 1;
  }

  // Promote one ace from 1 to 11 if it does not bust the hand.
  const soft = aces > 0 && total + 10 <= 21;
  if (soft) total += 10;

  return {
    total,
    soft,
    busted: total > 21,
    // A natural is exactly two cards totalling 21 — a 21 built from three cards
    // is not a blackjack and does not earn the 3:2 premium.
    blackjack: cards.length === 2 && total === 21,
    pairRank: isSplittable(cards) ? cards[0].rank : null,
  };
}

/**
 * Split eligibility. Casinos vary; this table uses the common rule that any two
 * ten-valued cards may be split (K+Q counts as a pair of tens).
 */
export function isSplittable(cards) {
  if (cards.length !== 2) return false;
  return cardValue10(cards[0]) === cardValue10(cards[1]);
}
const cardValue10 = (card) => (["10", "J", "Q", "K"].includes(card.rank) ? 10 : card.rank);

/* --- Poker (5-card evaluation, used by Video Poker) ---------------------- */

export const POKER_HANDS = /** @type {const} */ ([
  "high_card",
  "pair",
  "two_pair",
  "three_of_a_kind",
  "straight",
  "flush",
  "full_house",
  "four_of_a_kind",
  "straight_flush",
  "royal_flush",
]);

const RANK_ORDER = { A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };

/**
 * Classify a 5-card poker hand.
 * @param {{rank:string,suit:string}[]} cards exactly 5
 * @returns {{category: typeof POKER_HANDS[number], rank: number, label: string, kickers: number[], straightHigh: number|null, strength: number}}
 */
export function evaluatePoker(cards) {
  if (cards.length !== 5) throw new RangeError(`evaluatePoker needs exactly 5 cards, got ${cards.length}`);

  const values = cards.map((c) => RANK_ORDER[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);

  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Sort by multiplicity first, then by rank: gives kickers in comparison order.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(([, n]) => n).join("");

  const distinct = [...new Set(values)];
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0];
    // The wheel: A-5-4-3-2, where the ace plays low and the hand is a 5-high straight.
    else if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) straightHigh = 5;
  }

  // Kickers in comparison order. For the wheel the ace plays LOW, so the
  // straight is 5-high and the ace must not sit at the front of the kickers —
  // otherwise A-2-3-4-5 would compare as stronger than 6-5-4-3-2.
  const kickers = straightHigh === 5 ? [5, 4, 3, 2, 1] : groups.map(([v]) => v);

  const make = (category, label) => {
    const rank = POKER_HANDS.indexOf(category);
    return {
      category,
      rank,
      label,
      kickers,
      straightHigh: straightHigh || null,
      // Total ordering across every hand: the category, then the kickers, packed
      // as base-15 digits. The kicker list is padded to a fixed width first —
      // categories yield different numbers of groups (quads give 2, high card
      // gives 5), and without padding the category would carry a different
      // weight per category and a pair could score below a high card.
      strength: [...kickers, 0, 0, 0, 0, 0]
        .slice(0, 5)
        .reduce((acc, k) => acc * 15 + k, rank),
    };
  };

  if (flush && straightHigh === 14) return make("royal_flush", "Escalera real");
  if (flush && straightHigh) return make("straight_flush", "Escalera de color");
  if (shape === "41") return make("four_of_a_kind", "Póker");
  if (shape === "32") return make("full_house", "Full");
  if (flush) return make("flush", "Color");
  if (straightHigh) return make("straight", "Escalera");
  if (shape === "311") return make("three_of_a_kind", "Trío");
  if (shape === "221") return make("two_pair", "Doble pareja");
  if (shape === "2111") return make("pair", "Pareja");
  return make("high_card", "Carta alta");
}
