/**
 * Blackjack — pure rules engine. No DOM, no wallet, no randomness of its own:
 * every card comes from a provably-fair `Round`, so a hand can be replayed from
 * its seed triple. Runs unchanged under `node`.
 *
 * House rules implemented (they are the ones printed on the table):
 *   · 6 decks, dealt from a single shoe.
 *   · Dealer stands on soft 17 (S17).
 *   · A natural blackjack pays 3:2; a push returns the stake.
 *   · Double on any two cards, double after split allowed.
 *   · Split up to 3 times (4 hands). Split aces get ONE card each and a
 *     resulting 21 is not a blackjack.
 *   · Insurance offered on a dealer ace: costs half the stake, pays 2:1.
 *   · Late surrender: half the stake back.
 *
 * ── Hole card and dealer blackjack ────────────────────────────────────────
 * The dealer never looks at the hole card while the player is acting — it is
 * turned over only in `dealerPlay`. To keep that honest *and* keep the odds
 * identical to the American peek game (which is what basic strategy is
 * computed against), a dealer natural resolves as "original bets only": the
 * player loses just the opening stake, and every extra stake placed during the
 * hand (double, split, and the surrender rebate) is returned untouched.
 * That is EV-identical to peeking, because under a peek those extra bets would
 * never have been made in the first place.
 *
 * ── Order in which cards leave the shoe ───────────────────────────────────
 * The shoe is dealt strictly front to back from `state.cursor`; nothing is ever
 * drawn out of order, so the whole hand is a function of the shuffled shoe.
 *
 *   index 0 → player card 1
 *   index 1 → dealer upcard
 *   index 2 → player card 2
 *   index 3 → dealer hole card
 *   then, in chronological order: every hit, the single card of a double,
 *   the replacement card of the hand being split, the second card of a hand
 *   created by a split (dealt when that hand becomes the active one, exactly
 *   as a croupier does it), and finally the dealer's draws.
 *
 * Every exported action returns a NEW state; the input is never mutated.
 */

import { buildShoe, handValue, isSplittable } from "../core/cards.js";

/** Dealer draws below this total and stands on it — including a soft 17. */
export const DEALER_STANDS_ON = 17;
/** Original hand plus three splits. */
export const MAX_HANDS = 4;
/** Cards that must remain in the shoe before a new hand may be dealt. */
export const MIN_CARDS_TO_DEAL = 20;

/** Actions the player can take, and their Spanish labels for the UI. */
export const ACTION_LABEL = {
  hit: "Pedir carta",
  stand: "Plantarse",
  double: "Doblar",
  split: "Dividir",
  surrender: "Rendirse",
  decline: "Rechazar el seguro",
};

/* --- Money ---------------------------------------------------------------- */
// Everything is integer minor units. The only division is by two, and the two
// halves are rounded to the nearest unit so no fraction of a credit is lost.

/** Total returned by a natural: the stake plus 3:2 on top. */
const naturalReturn = (stake) => stake + Math.round((stake * 3) / 2);
/** Half a stake — used by insurance (its cost) and surrender (its rebate). */
const half = (stake) => Math.round(stake / 2);

/* --- State ---------------------------------------------------------------- */

/**
 * @typedef {object} Hand
 * @property {{rank:string,suit:string,id:string}[]} cards
 * @property {number} stake      minor units committed to this hand (doubled = 2×)
 * @property {boolean} done      no further action possible
 * @property {boolean} doubled
 * @property {boolean} surrendered
 * @property {boolean} fromSplit a 21 here is never a natural
 * @property {boolean} splitAce  split ace: exactly one extra card, then stand
 */

const makeHand = (stake) => ({
  cards: [],
  stake,
  done: false,
  doubled: false,
  surrendered: false,
  fromSplit: false,
  splitAce: false,
});

/** Structural copy. The shoe itself is shared: it is never written to. */
function clone(state) {
  return {
    ...state,
    hands: state.hands.map((h) => ({ ...h, cards: h.cards.slice() })),
    dealer: { cards: state.dealer.cards.slice() },
    insurance: { ...state.insurance },
  };
}

function drawCard(draft) {
  if (draft.cursor >= draft.shoe.length) throw new RangeError("Shoe exhausted");
  return draft.shoe[draft.cursor++];
}

/**
 * Open a table: a freshly shuffled shoe and no hand in play.
 * @param {import('../core/rng.js').Round} round provably-fair stream
 * @param {{decks?: number}} [opts]
 */
export function createGame(round, { decks = 6 } = {}) {
  return {
    decks,
    // Consumes decks×52−1 floats of the round; the rest of the stream is unused,
    // which is what makes the whole hand verifiable from the shuffle alone.
    shoe: round.shuffle(buildShoe(decks)),
    cursor: 0,
    stake: 0,
    phase: /** @type {'idle'|'insurance'|'player'|'dealer'|'done'} */ ("idle"),
    /** @type {Hand[]} */
    hands: [],
    /** Index of the hand awaiting a decision; === hands.length when none is. */
    active: 0,
    dealer: { cards: /** @type {{rank:string,suit:string,id:string}[]} */ ([]) },
    revealed: false,
    insurance: { offered: false, taken: false, cost: 0 },
    splits: 0,
  };
}

/** Cards still behind the cut. */
export const cardsLeft = (state) => state.shoe.length - state.cursor;

/** Put a brand new shuffled shoe on the table, keeping nothing else. */
export function reshuffle(state, round) {
  const s = clone(state);
  s.shoe = round.shuffle(buildShoe(s.decks));
  s.cursor = 0;
  return s;
}

/* --- Turn management ------------------------------------------------------ */

/**
 * Move the turn to the first hand that still needs a decision, dealing the
 * second card to any hand created by a split as it comes into play. Hands that
 * cannot act any more (bust, 21, a split ace that already took its card) are
 * closed here, so the player is never shown a pointless choice.
 */
function advance(draft) {
  while (draft.active < draft.hands.length) {
    const hand = draft.hands[draft.active];

    if (hand.cards.length === 1) {
      hand.cards.push(drawCard(draft));
      // Split aces are dealt exactly one card and then stand, always.
      if (hand.splitAce) hand.done = true;
    }

    if (!hand.done) {
      const value = handValue(hand.cards);
      // 21 (and a bust) leaves nothing to decide, so the hand closes itself.
      if (value.busted || value.total >= 21) hand.done = true;
    }

    if (!hand.done) {
      draft.phase = "player";
      return draft;
    }
    draft.active += 1;
  }

  draft.phase = "dealer";
  return draft;
}

function requirePhase(state, phase, action) {
  if (state.phase !== phase) {
    throw new Error(`Cannot ${action} while the hand is in phase "${state.phase}"`);
  }
}

/* --- Actions -------------------------------------------------------------- */

/**
 * Deal a new hand from wherever the shoe currently is.
 * @param {ReturnType<typeof createGame>} state
 * @param {number} stake minor units
 */
export function deal(state, stake) {
  if (state.phase !== "idle" && state.phase !== "done") {
    throw new Error(`Cannot deal while the hand is in phase "${state.phase}"`);
  }
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new RangeError(`Stake must be a positive integer of minor units, got ${stake}`);
  }
  if (cardsLeft(state) < MIN_CARDS_TO_DEAL) throw new RangeError("Shoe needs reshuffling");

  const s = clone(state);
  s.stake = stake;
  s.hands = [makeHand(stake)];
  s.dealer = { cards: [] };
  s.revealed = false;
  s.active = 0;
  s.splits = 0;
  s.insurance = { offered: false, taken: false, cost: 0 };

  // Player, dealer, player, dealer — the dealer's second card is the hole card.
  s.hands[0].cards.push(drawCard(s));
  s.dealer.cards.push(drawCard(s));
  s.hands[0].cards.push(drawCard(s));
  s.dealer.cards.push(drawCard(s));

  // Insurance is decided before anyone acts, so it interrupts the turn order.
  if (s.dealer.cards[0].rank === "A") {
    s.insurance = { offered: true, taken: false, cost: half(stake) };
    s.phase = "insurance";
    return s;
  }

  s.phase = "player";
  return advance(s);
}

/**
 * Accept or decline insurance. Declining is a real decision, not a no-op: it
 * closes the offer so the prompt cannot come back later in the hand.
 * @param {boolean} take
 */
export function insurance(state, take) {
  requirePhase(state, "insurance", "decide insurance");
  const s = clone(state);
  s.insurance = {
    offered: true,
    taken: Boolean(take),
    cost: take ? half(s.stake) : 0,
  };
  s.phase = "player";
  return advance(s);
}

export function hit(state) {
  requirePhase(state, "player", "hit");
  const s = clone(state);
  const hand = s.hands[s.active];
  hand.cards.push(drawCard(s));
  const value = handValue(hand.cards);
  if (value.busted || value.total >= 21) hand.done = true;
  return advance(s);
}

export function stand(state) {
  requirePhase(state, "player", "stand");
  const s = clone(state);
  s.hands[s.active].done = true;
  return advance(s);
}

/** Double the stake on this hand for exactly one more card. */
export function double(state) {
  requirePhase(state, "player", "double");
  if (!actions(state).canDouble) throw new Error("Doubling is not allowed on this hand");
  const s = clone(state);
  const hand = s.hands[s.active];
  // The extra bet always equals the ORIGINAL stake, never the current one, so a
  // doubled hand risks 2× and no more.
  hand.stake += s.stake;
  hand.doubled = true;
  hand.cards.push(drawCard(s));
  hand.done = true;
  return advance(s);
}

/**
 * Split the active pair into two hands, each carrying the original stake.
 * The hand being split takes its replacement card immediately; the new hand
 * waits for its turn, which is when a croupier would slide a card across.
 */
export function split(state) {
  requirePhase(state, "player", "split");
  if (!actions(state).canSplit) throw new Error("Splitting is not allowed on this hand");

  const s = clone(state);
  const hand = s.hands[s.active];
  const moved = hand.cards.pop();
  const aces = moved.rank === "A";

  const created = makeHand(s.stake);
  created.cards.push(moved);
  created.fromSplit = true;
  created.splitAce = aces;

  hand.fromSplit = true;
  hand.splitAce = aces;
  s.hands.splice(s.active + 1, 0, created);
  s.splits += 1;

  hand.cards.push(drawCard(s));
  if (aces) hand.done = true;

  return advance(s);
}

/** Late surrender: give up the hand and take back half the stake. */
export function surrender(state) {
  requirePhase(state, "player", "surrender");
  if (!actions(state).canSurrender) throw new Error("Surrender is not allowed on this hand");
  const s = clone(state);
  const hand = s.hands[s.active];
  hand.surrendered = true;
  hand.done = true;
  return advance(s);
}

/**
 * Turn the hole card over and play the dealer's hand out.
 *
 * The dealer draws only when something is still at stake: if every player hand
 * busted or surrendered, or the dealer already shows a natural, the hand is
 * over and no more cards leave the shoe — same as at a real table.
 */
export function dealerPlay(state) {
  requirePhase(state, "dealer", "play the dealer's hand");
  const s = clone(state);
  s.revealed = true;

  const live = s.hands.some((h) => !h.surrendered && !handValue(h.cards).busted);
  if (live && !handValue(s.dealer.cards).blackjack) {
    // S17: stand on 17 whether it is hard or soft.
    while (handValue(s.dealer.cards).total < DEALER_STANDS_ON) {
      s.dealer.cards.push(drawCard(s));
    }
  }

  s.phase = "done";
  return s;
}

/* --- What the player may do right now ------------------------------------- */

/**
 * The single source of truth for enabling buttons. The UI must not decide any
 * of this itself, which is how "double with three cards" bugs happen.
 */
export function actions(state) {
  const hand = state.hands[state.active];
  const acting = state.phase === "player" && Boolean(hand) && !hand.done;
  const opening = acting && hand.cards.length === 2;

  return {
    canHit: acting,
    canStand: acting,
    // Any two cards, including after a split — but never a split ace.
    canDouble: opening && !hand.splitAce,
    canSplit: opening && !hand.splitAce && isSplittable(hand.cards) && state.hands.length < MAX_HANDS,
    // Late surrender is the first decision of the round or nothing.
    canSurrender: opening && state.hands.length === 1 && !hand.fromSplit,
    canInsure: state.phase === "insurance",
  };
}

/** Extra money an action commits, so the UI can check the balance first. */
export function actionCost(state, action) {
  if (action === "double" || action === "split") return state.stake;
  if (action === "insurance") return half(state.stake);
  return 0;
}

/* --- Settlement ----------------------------------------------------------- */

/**
 * Resolve the finished hand.
 *
 * @returns {{payout:number, wagered:number, net:number,
 *            perHand:{result:'win'|'lose'|'push'|'blackjack', stake:number, payout:number,
 *                     surrendered:boolean, total:number, busted:boolean}[],
 *            insurance:{taken:boolean, cost:number, payout:number},
 *            dealerTotal:number, dealerBlackjack:boolean, dealerBusted:boolean}}
 */
export function settlement(state) {
  requirePhase(state, "done", "settle");

  const base = state.stake;
  const dealer = handValue(state.dealer.cards);
  const dealerNatural = dealer.blackjack;

  const perHand = state.hands.map((hand, index) => {
    const value = handValue(hand.cards);
    const natural = value.blackjack && !hand.fromSplit;
    const row = {
      stake: hand.stake,
      total: value.total,
      busted: value.busted,
      surrendered: hand.surrendered,
      result: /** @type {'win'|'lose'|'push'|'blackjack'} */ ("lose"),
      payout: 0,
    };

    // Dealer natural: the hand never really started. Only the opening stake is
    // lost — extra stakes, and even a surrender, are unwound (see file header).
    if (dealerNatural) {
      if (natural) {
        row.result = "push";
        row.payout = hand.stake;
      } else if (index === 0) {
        row.result = "lose";
        row.payout = hand.stake - base; // the doubled half comes back
      } else {
        row.result = "push";
        row.payout = hand.stake; // this hand would never have been split off
      }
      return row;
    }

    if (hand.surrendered) {
      row.result = "lose";
      row.payout = half(hand.stake);
    } else if (value.busted) {
      // A bust loses immediately, whatever the dealer goes on to do.
      row.result = "lose";
      row.payout = 0;
    } else if (natural) {
      row.result = "blackjack";
      row.payout = naturalReturn(hand.stake);
    } else if (dealer.busted || value.total > dealer.total) {
      row.result = "win";
      row.payout = hand.stake * 2;
    } else if (value.total < dealer.total) {
      row.result = "lose";
      row.payout = 0;
    } else {
      row.result = "push";
      row.payout = hand.stake;
    }
    return row;
  });

  // Insurance is a side bet: 2:1 means the cost back plus twice the cost.
  const insurancePayout = state.insurance.taken && dealerNatural ? state.insurance.cost * 3 : 0;

  const wagered = perHand.reduce((sum, h) => sum + h.stake, 0) + state.insurance.cost;
  const payout = perHand.reduce((sum, h) => sum + h.payout, 0) + insurancePayout;

  return {
    payout,
    wagered,
    net: payout - wagered,
    perHand,
    insurance: { taken: state.insurance.taken, cost: state.insurance.cost, payout: insurancePayout },
    dealerTotal: dealer.total,
    dealerBlackjack: dealerNatural,
    dealerBusted: dealer.busted,
  };
}

/* --- Basic strategy -------------------------------------------------------- */
// The real S17 table for 4–8 decks with double-after-split and late surrender.
// It drives both the hint button and the RTP simulation, so a mistake here
// would show up immediately as a house edge outside the expected band.

/** Dealer upcard as a number, with the ace as 11. */
function upcardValue(card) {
  if (card.rank === "A") return 11;
  return ["10", "J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank);
}

/** Rank of a pair as a number, ace = 11, all ten-valued cards = 10. */
const pairValue = (rank) =>
  rank === "A" ? 11 : ["10", "J", "Q", "K"].includes(rank) ? 10 : Number(rank);

/**
 * @param {{rank:string,suit:string}[]} cards
 * @param {number} up dealer upcard value (2–11)
 * @param {{canDouble:boolean, canSplit:boolean, canSurrender:boolean}} allowed
 * @returns {'hit'|'stand'|'double'|'split'|'surrender'}
 */
export function strategyFor(cards, up, allowed) {
  const value = handValue(cards);
  const pair = isSplittable(cards);
  const pairOf = pair ? pairValue(cards[0].rank) : 0;

  // 1. Surrender is decided first — once you hit or split it is off the table.
  //    S17 surrenders are only hard 16 vs 9/10/A and hard 15 vs 10, and 8,8 is
  //    always split instead of surrendered.
  if (allowed.canSurrender && !value.soft) {
    if (value.total === 16 && pairOf !== 8 && up >= 9) return "surrender";
    if (value.total === 15 && up === 10) return "surrender";
  }

  // 2. Pairs. Falls through to the hard/soft charts when the split limit is hit
  //    (four hands already in play), which is exactly what the table dictates.
  if (pair && allowed.canSplit) {
    switch (pairOf) {
      case 11: return "split";                                   // aces, always
      case 10: break;                                            // never break 20
      case 9: return up === 7 || up >= 10 ? "stand" : "split";
      case 8: return "split";
      case 7: return up <= 7 ? "split" : "hit";
      case 6: return up <= 6 ? "split" : "hit";                  // DAS
      case 5: break;                                             // play it as a hard 10
      case 4: return up === 5 || up === 6 ? "split" : "hit";     // DAS
      case 3:
      case 2: return up <= 7 ? "split" : "hit";                  // DAS
      default: break;
    }
  }

  // 3. Soft hands — an ace still worth 11, so a single card cannot bust them.
  if (value.soft) {
    if (value.total >= 19) return "stand";                       // S17 never doubles A,8
    if (value.total === 18) {
      if (up >= 3 && up <= 6) return allowed.canDouble ? "double" : "stand";
      return up <= 8 ? "stand" : "hit";                          // stand vs 2/7/8
    }
    if (value.total === 17) return allowed.canDouble && up >= 3 && up <= 6 ? "double" : "hit";
    if (value.total >= 15) return allowed.canDouble && up >= 4 && up <= 6 ? "double" : "hit";
    if (value.total >= 13) return allowed.canDouble && up >= 5 && up <= 6 ? "double" : "hit";
    return "hit";
  }

  // 4. Hard hands.
  if (value.total >= 17) return "stand";
  if (value.total >= 13) return up <= 6 ? "stand" : "hit";
  if (value.total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
  if (value.total === 11) return allowed.canDouble && up <= 10 ? "double" : "hit";
  if (value.total === 10) return allowed.canDouble && up <= 9 ? "double" : "hit";
  if (value.total === 9) return allowed.canDouble && up >= 3 && up <= 6 ? "double" : "hit";
  return "hit";
}

/**
 * Basic-strategy advice for the state as it stands.
 * Insurance is always declined: at six decks it returns about 93 % of what it
 * costs, so no correct strategy ever takes it.
 * @returns {{action:string, label:string}|null} null when it is not the player's turn
 */
export function basicStrategy(state) {
  if (state.phase === "insurance") return { action: "decline", label: ACTION_LABEL.decline };
  if (state.phase !== "player") return null;

  const hand = state.hands[state.active];
  if (!hand) return null;
  const allowed = actions(state);
  const action = strategyFor(hand.cards, upcardValue(state.dealer.cards[0]), allowed);
  return { action, label: ACTION_LABEL[action] };
}

/**
 * Play one already-dealt hand to the end with basic strategy. Extracted so the
 * simulation and the "auto" hint share exactly the same decision path.
 * @param {ReturnType<typeof deal>} dealt
 * @param {{canAfford?: (extra:number)=>boolean}} [opts]
 */
export function playBasicStrategy(dealt, { canAfford = () => true } = {}) {
  let state = dealt;
  if (state.phase === "insurance") state = insurance(state, false);

  let guard = 0;
  while (state.phase === "player") {
    // A hand cannot exceed 21 cards and four hands is the cap, so this bound is
    // only reachable through a bug — it stops a loop from hanging the browser.
    if (++guard > 128) throw new Error("Basic strategy failed to finish the hand");

    const hand = state.hands[state.active];
    const allowed = actions(state);
    // A move the player cannot pay for is not merely skipped: the chart is
    // re-read with that option removed, which yields the correct fallback
    // ("double else hit", but "double else stand" on soft 18).
    if (allowed.canDouble && !canAfford(actionCost(state, "double"))) allowed.canDouble = false;
    if (allowed.canSplit && !canAfford(actionCost(state, "split"))) allowed.canSplit = false;

    const move = strategyFor(hand.cards, upcardValue(state.dealer.cards[0]), allowed);
    if (move === "split") state = split(state);
    else if (move === "double") state = double(state);
    else if (move === "surrender") state = surrender(state);
    else if (move === "stand") state = stand(state);
    else state = hit(state);
  }

  return dealerPlay(state);
}
