/**
 * Casino runtime context.
 *
 * A single wired-up object every game imports, so no page constructs its own
 * wallet or fairness engine (which would desynchronise the balance across
 * tabs and lose the nonce). Import it, read `wallet` / `fairness`, and use
 * `playRound()` to run a bet through every guard in the right order.
 */

import { createStore } from "../../../assets/js/storage.js";
import { Wallet, UNIT } from "./wallet.js";
import { FairnessEngine } from "./rng.js";
import { ResponsiblePlay } from "./responsible.js";

const store = createStore("nexytt.casino");

export const wallet = new Wallet({ store, startingBalance: 500_000 });
export const responsible = new ResponsiblePlay({ store });

const savedFairness = store.get("fairness");
export const fairness = savedFairness
  ? FairnessEngine.fromJSON(savedFairness)
  : new FairnessEngine();

/** Fairness state is persisted after every round so the nonce survives a reload. */
export function persistFairness() {
  store.set("fairness", fairness.toJSON());
}
persistFairness();

export { store, UNIT };

/** Raised when a responsible-play limit blocks a bet. */
export class LimitReached extends Error {
  constructor(reason, code) {
    super(reason);
    this.name = "LimitReached";
    this.code = code;
  }
}

/**
 * Run one betting round end to end.
 *
 * The order of operations is the whole point of this function:
 *   1. responsible-play check (before any money moves)
 *   2. debit the stake
 *   3. mint a provably-fair round and resolve the game
 *   4. credit the payout
 *
 * `resolve` is a **pure function** `(round) => { payout, ...detail }` where
 * `payout` is the total returned to the player (0 on a loss, stake×2 on an
 * even-money win). Keeping it pure is what makes every game replayable from
 * its seed triple.
 *
 * @template T
 * @param {{stake:number, game:string, resolve:(round: import('./rng.js').Round) => T & {payout:number}}} input
 * @returns {T & {payout:number, stake:number, net:number, nonce:number, balance:number, betId:string}}
 */
export function playRound({ stake, game, resolve }) {
  const stats = wallet.stats();
  const verdict = responsible.check({ stake, netResult: stats.net });
  if (!verdict.allowed) throw new LimitReached(verdict.reason, verdict.code);

  const bet = wallet.placeBet(stake, game);

  // The nonce of the round we are about to mint — captured for the receipt.
  const nonce = fairness.nonce;
  const round = fairness.nextRound();

  let outcome;
  try {
    outcome = resolve(round);
  } catch (err) {
    // A game that throws mid-resolution must not eat the player's stake.
    wallet.refund(bet.id, "error");
    persistFairness();
    throw err;
  }

  const payout = Math.max(0, Math.round(outcome.payout ?? 0));
  wallet.settle(bet.id, payout, {
    nonce,
    clientSeed: fairness.clientSeed,
    commitment: fairness.commitment,
    ...outcome,
  });
  persistFairness();
  responsible.tick();

  return {
    ...outcome,
    payout,
    stake,
    net: payout - stake,
    nonce,
    balance: wallet.balance,
    betId: bet.id,
  };
}

/**
 * Multi-stage games (Blackjack, Crash, Mines) cannot resolve in one call: the
 * player acts between the deal and the settlement. These open a round, hand
 * back the stream, and settle later.
 *
 * @param {{stake:number, game:string}} input
 * @returns {{betId:string, nonce:number, round: import('./rng.js').Round, settle:(payout:number, detail?:object)=>void, addStake:(extra:number)=>string}}
 */
export function openRound({ stake, game }) {
  const stats = wallet.stats();
  const verdict = responsible.check({ stake, netResult: stats.net });
  if (!verdict.allowed) throw new LimitReached(verdict.reason, verdict.code);

  const bet = wallet.placeBet(stake, game);
  const nonce = fairness.nonce;
  const round = fairness.nextRound();
  persistFairness();

  /** Extra stakes placed mid-hand (double down, split, insurance). */
  const extraBets = [];

  return {
    betId: bet.id,
    nonce,
    round,
    /** @returns {string} id of the additional bet */
    addStake(extra) {
      const additional = wallet.placeBet(extra, game);
      extraBets.push(additional.id);
      return additional.id;
    },
    /**
     * Settle the round. `payout` is the total return across the original stake
     * and every extra stake placed during the hand.
     */
    settle(payout, detail = {}) {
      // Extra stakes are folded into the primary settlement so the ledger shows
      // one payout per hand, with the full stake recorded in the detail.
      for (const id of extraBets) wallet.settle(id, 0, { foldedInto: bet.id });
      wallet.settle(bet.id, Math.max(0, Math.round(payout)), {
        nonce,
        clientSeed: fairness.clientSeed,
        commitment: fairness.commitment,
        extraStakes: extraBets.length,
        ...detail,
      });
      persistFairness();
      responsible.tick();
    },
    cancel(reason = "cancelled") {
      for (const id of extraBets) wallet.refund(id, reason);
      wallet.refund(bet.id, reason);
      persistFairness();
    },
  };
}

/** Chip denominations offered in the bet controls, in minor units. */
export const CHIPS = [100, 500, 1000, 2500, 10_000, 50_000];

/** Catalogue of games, used to build the lobby and cross-links. */
export const GAMES = [
  { id: "slots", title: "Neon Reels", href: "slots.html", tagline: "Tragaperras 5×3 · 20 líneas", rtp: 0.96, volatility: "Media", glyph: "slots" },
  { id: "blackjack", title: "Blackjack 21", href: "blackjack.html", tagline: "6 barajas · Dealer planta en 17", rtp: 0.995, volatility: "Baja", glyph: "cards" },
  { id: "roulette", title: "Ruleta Europea", href: "roulette.html", tagline: "Un solo cero · 37 casillas", rtp: 0.973, volatility: "Variable", glyph: "roulette" },
  { id: "dice", title: "Dados", href: "dice.html", tagline: "Elige tu probabilidad exacta", rtp: 0.99, volatility: "Ajustable", glyph: "dice" },
  { id: "crash", title: "Crash", href: "crash.html", tagline: "Retira antes de que explote", rtp: 0.99, volatility: "Alta", glyph: "rocket" },
  { id: "mines", title: "Minas", href: "mines.html", tagline: "5×5 · Tú eliges cuántas minas", rtp: 0.99, volatility: "Alta", glyph: "mine" },
];
