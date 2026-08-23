/**
 * Play-money wallet and audit ledger.
 *
 * Balances are **integer credits in minor units** (1 credit = 100 units).
 * Money is never held in a float: `0.1 + 0.2 !== 0.3` is a real class of bug in
 * betting software, so every arithmetic path here is integer-only and every
 * amount that crosses the boundary is validated.
 *
 * The ledger is append-only and double-entry in spirit: a round produces a
 * `bet` entry (debit) and, once resolved, a `payout` entry (credit). Wagered
 * and returned totals are derived from the ledger, so the reported RTP is a
 * measurement rather than a claim.
 */

import { Emitter } from "../../../assets/js/emitter.js";

/** 1 credit = 100 minor units. */
export const UNIT = 100;

/** Ledger is capped so a long session cannot grow storage without bound. */
const MAX_LEDGER_ENTRIES = 400;

let sequence = 0;
const nextId = () => `tx_${Date.now().toString(36)}_${(sequence++).toString(36)}`;

/**
 * @typedef {object} LedgerEntry
 * @property {string} id
 * @property {'bet'|'payout'|'grant'|'adjust'} kind
 * @property {string} game
 * @property {number} amount        signed minor units (negative = debit)
 * @property {number} balanceAfter
 * @property {number} at            epoch ms
 * @property {string} [ref]         links a payout to its bet
 * @property {object} [detail]      game-specific context (hand, roll, multiplier…)
 */

export class InsufficientFunds extends Error {
  constructor(required, available) {
    super(`Insufficient balance: need ${required}, have ${available}`);
    this.name = "InsufficientFunds";
    this.required = required;
    this.available = available;
  }
}

export class Wallet extends Emitter {
  /**
   * @param {{store: import('../../../assets/js/storage.js').Store, key?: string, startingBalance?: number}} opts
   */
  constructor({ store, key = "wallet", startingBalance = 500_000 }) {
    super();
    this._store = store;
    this._key = key;
    this._startingBalance = startingBalance;

    const saved = store.get(key);
    /** @type {number} */
    this._balance = Number.isInteger(saved?.balance) ? saved.balance : startingBalance;
    /** @type {LedgerEntry[]} */
    this._ledger = Array.isArray(saved?.ledger) ? saved.ledger : [];
    /** @type {Map<string, {amount:number, game:string}>} */
    this._open = new Map();
  }

  get balance() {
    return this._balance;
  }

  get ledger() {
    return this._ledger.slice();
  }

  /** @param {number} amount minor units */
  canAfford(amount) {
    return Number.isInteger(amount) && amount >= 0 && amount <= this._balance;
  }

  /**
   * Debit a stake and open a round.
   * @param {number} amount minor units
   * @param {string} game
   * @param {object} [detail]
   * @returns {LedgerEntry} the bet entry; its `id` is the settlement reference
   */
  placeBet(amount, game, detail) {
    assertAmount(amount, "bet");
    if (amount <= 0) throw new RangeError("A bet must be greater than zero");
    if (amount > this._balance) throw new InsufficientFunds(amount, this._balance);

    this._balance -= amount;
    const entry = this._record({ kind: "bet", game, amount: -amount, detail });
    this._open.set(entry.id, { amount, game });
    this.emit("bet", entry);
    return entry;
  }

  /**
   * Credit a round's return and close it.
   *
   * `payout` is the **total returned to the player**, not the profit: a losing
   * round settles at 0, an even-money win on a 100 stake settles at 200. This
   * matches how RTP is defined and keeps the ledger self-consistent.
   *
   * @param {string} betId  id returned by `placeBet`
   * @param {number} payout minor units, >= 0
   * @param {object} [detail]
   * @returns {LedgerEntry|null} the payout entry, or null when payout is 0
   */
  settle(betId, payout, detail) {
    const open = this._open.get(betId);
    if (!open) throw new Error(`Unknown or already-settled bet: ${betId}`);
    assertAmount(payout, "payout");

    this._open.delete(betId);
    const net = payout - open.amount;

    if (payout > 0) {
      this._balance += payout;
      const entry = this._record({
        kind: "payout",
        game: open.game,
        amount: payout,
        ref: betId,
        detail: { ...detail, stake: open.amount, net },
      });
      this.emit("settle", { entry, net, payout, stake: open.amount });
      return entry;
    }

    this.emit("settle", { entry: null, net, payout: 0, stake: open.amount });
    this._persist();
    return null;
  }

  /**
   * Return a stake without counting the round as played — used when a game is
   * cancelled mid-round (e.g. a Blackjack surrender refund or a voided spin).
   */
  refund(betId, reason = "cancelled") {
    const open = this._open.get(betId);
    if (!open) throw new Error(`Unknown or already-settled bet: ${betId}`);
    this._open.delete(betId);
    this._balance += open.amount;
    const entry = this._record({
      kind: "adjust",
      game: open.game,
      amount: open.amount,
      ref: betId,
      detail: { reason },
    });
    this.emit("refund", entry);
    return entry;
  }

  /** Top up the play balance (the "free credits" button). */
  grant(amount, reason = "bonus") {
    assertAmount(amount, "grant");
    this._balance += amount;
    const entry = this._record({ kind: "grant", game: "cashier", amount, detail: { reason } });
    this.emit("grant", entry);
    return entry;
  }

  /**
   * Session statistics derived from the ledger.
   * @returns {{wagered:number, returned:number, net:number, rounds:number, wins:number, biggestWin:number, rtp:number|null}}
   */
  stats() {
    let wagered = 0;
    let returned = 0;
    let rounds = 0;
    let wins = 0;
    let biggestWin = 0;

    for (const e of this._ledger) {
      if (e.kind === "bet") {
        wagered += -e.amount;
        rounds += 1;
      } else if (e.kind === "payout") {
        returned += e.amount;
        const net = e.detail?.net ?? 0;
        if (net > 0) {
          wins += 1;
          if (net > biggestWin) biggestWin = net;
        }
      }
    }

    return {
      wagered,
      returned,
      net: returned - wagered,
      rounds,
      wins,
      biggestWin,
      // Undefined rather than 0 before any wager, so the UI can show "—".
      rtp: wagered > 0 ? returned / wagered : null,
    };
  }

  /** Most recent entries first. */
  history(limit = 25) {
    return this._ledger.slice(-limit).reverse();
  }

  /** Wipe balance and ledger back to a fresh session. */
  reset() {
    this._balance = this._startingBalance;
    this._ledger = [];
    this._open.clear();
    this._persist();
    this.emit("reset", this._balance);
    this.emit("change", this._balance);
  }

  _record({ kind, game, amount, ref, detail }) {
    /** @type {LedgerEntry} */
    const entry = {
      id: nextId(),
      kind,
      game,
      amount,
      balanceAfter: this._balance,
      at: Date.now(),
      ...(ref ? { ref } : {}),
      ...(detail ? { detail } : {}),
    };
    this._ledger.push(entry);
    if (this._ledger.length > MAX_LEDGER_ENTRIES) {
      this._ledger.splice(0, this._ledger.length - MAX_LEDGER_ENTRIES);
    }
    this._persist();
    this.emit("change", this._balance, entry);
    return entry;
  }

  _persist() {
    this._store.set(this._key, { balance: this._balance, ledger: this._ledger });
  }
}

function assertAmount(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer in minor units, got ${value}`);
  }
  if (value < 0) throw new RangeError(`${label} cannot be negative`);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds safe integer range`);
}
