/**
 * The wallet is the only place a balance changes. These tests pin the
 * invariants that matter: money is integer-only, a bet cannot be settled
 * twice, the ledger reconciles with the balance, and RTP is derived rather
 * than asserted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, InsufficientFunds, UNIT } from "../casino/js/core/wallet.js";
import { createMemoryStore } from "../assets/js/storage.js";

const fresh = (startingBalance = 100_000) =>
  new Wallet({ store: createMemoryStore(), startingBalance });

test("an even-money win returns the stake to its starting balance", () => {
  const wallet = fresh(10_000);
  const bet = wallet.placeBet(1000, "dice");
  assert.equal(wallet.balance, 9000, "the stake is debited immediately");
  wallet.settle(bet.id, 2000);
  assert.equal(wallet.balance, 11_000);
});

test("a loss settles at zero and keeps the stake", () => {
  const wallet = fresh(10_000);
  const bet = wallet.placeBet(1000, "slots");
  wallet.settle(bet.id, 0);
  assert.equal(wallet.balance, 9000);
});

test("a push returns exactly the stake", () => {
  const wallet = fresh(10_000);
  const bet = wallet.placeBet(2500, "blackjack");
  wallet.settle(bet.id, 2500);
  assert.equal(wallet.balance, 10_000);
});

test("betting more than the balance is refused and changes nothing", () => {
  const wallet = fresh(1000);
  assert.throws(() => wallet.placeBet(1001, "dice"), InsufficientFunds);
  assert.equal(wallet.balance, 1000);
  assert.equal(wallet.ledger.length, 0);
});

test("non-integer and negative amounts are refused", () => {
  const wallet = fresh();
  assert.throws(() => wallet.placeBet(10.5, "dice"), TypeError);
  assert.throws(() => wallet.placeBet(-100, "dice"), RangeError);
  assert.throws(() => wallet.placeBet(0, "dice"), RangeError);
  // Still an integer, but beyond the safe range: caught by the range guard, not the type guard.
  assert.throws(() => wallet.placeBet(Number.MAX_SAFE_INTEGER + 10, "dice"), RangeError);
  assert.throws(() => wallet.placeBet(Number.NaN, "dice"), TypeError);
  assert.throws(() => wallet.placeBet("1000", "dice"), TypeError);
  assert.equal(wallet.balance, 100_000);
});

test("a bet cannot be settled twice", () => {
  const wallet = fresh();
  const bet = wallet.placeBet(1000, "dice");
  wallet.settle(bet.id, 1500);
  assert.throws(() => wallet.settle(bet.id, 1500), /already-settled/);
});

test("an unknown bet id cannot be settled", () => {
  const wallet = fresh();
  assert.throws(() => wallet.settle("tx_nope", 100), /Unknown/);
});

test("a refund returns the stake and cannot be double-claimed", () => {
  const wallet = fresh(10_000);
  const bet = wallet.placeBet(3000, "blackjack");
  wallet.refund(bet.id, "surrender");
  assert.equal(wallet.balance, 10_000);
  assert.throws(() => wallet.refund(bet.id), /already-settled/);
});

test("the ledger reconciles with the balance", () => {
  const wallet = fresh(50_000);
  for (let i = 0; i < 40; i++) {
    const bet = wallet.placeBet(500, "dice");
    wallet.settle(bet.id, i % 3 === 0 ? 1500 : 0);
  }
  const fromLedger = wallet.ledger.reduce((sum, e) => sum + e.amount, 50_000);
  assert.equal(fromLedger, wallet.balance);
});

test("balanceAfter on each entry matches the running balance", () => {
  const wallet = fresh(20_000);
  for (let i = 0; i < 10; i++) {
    const bet = wallet.placeBet(1000, "slots");
    wallet.settle(bet.id, i % 2 ? 2400 : 0);
  }
  let running = 20_000;
  for (const entry of wallet.ledger) {
    running += entry.amount;
    assert.equal(entry.balanceAfter, running, `entry ${entry.id} disagrees with the running balance`);
  }
});

test("stats derive RTP from what actually happened", () => {
  const wallet = fresh(100_000);
  // Four rounds of 1000: one pays 2000, one pays 1600, two pay nothing.
  for (const payout of [2000, 1600, 0, 0]) {
    const bet = wallet.placeBet(1000, "slots");
    wallet.settle(bet.id, payout);
  }
  const stats = wallet.stats();
  assert.equal(stats.rounds, 4);
  assert.equal(stats.wagered, 4000);
  assert.equal(stats.returned, 3600);
  assert.equal(stats.net, -400);
  assert.equal(stats.wins, 2);
  assert.equal(stats.biggestWin, 1000, "biggest win is net profit, not gross payout");
  assert.equal(stats.rtp, 0.9);
});

test("RTP is null before any wager, so the UI can show a dash", () => {
  assert.equal(fresh().stats().rtp, null);
});

test("a grant is credited but is not counted as a wager", () => {
  const wallet = fresh(1000);
  wallet.grant(50_000, "bonus");
  assert.equal(wallet.balance, 51_000);
  assert.equal(wallet.stats().wagered, 0);
  assert.equal(wallet.stats().rounds, 0);
});

test("state survives a reload through the store", () => {
  const store = createMemoryStore();
  const first = new Wallet({ store, startingBalance: 10_000 });
  const bet = first.placeBet(2500, "roulette");
  first.settle(bet.id, 5000);

  const reloaded = new Wallet({ store, startingBalance: 10_000 });
  assert.equal(reloaded.balance, 12_500);
  assert.equal(reloaded.stats().rounds, 1);
});

test("the ledger is capped so a long session cannot grow without bound", () => {
  const wallet = fresh(10_000_000);
  for (let i = 0; i < 500; i++) {
    const bet = wallet.placeBet(100, "dice");
    wallet.settle(bet.id, 100);
  }
  assert.ok(wallet.ledger.length <= 400, `ledger grew to ${wallet.ledger.length}`);
  // Trimming history must not corrupt the live balance.
  assert.equal(wallet.balance, 10_000_000);
});

test("events fire for bets, settlements and balance changes", () => {
  const wallet = fresh();
  const seen = [];
  wallet.on("bet", () => seen.push("bet"));
  wallet.on("settle", ({ net }) => seen.push(`settle:${net}`));
  wallet.on("change", () => seen.push("change"));

  const bet = wallet.placeBet(1000, "dice");
  wallet.settle(bet.id, 3000);

  assert.ok(seen.includes("bet"));
  assert.ok(seen.includes("settle:2000"));
  assert.ok(seen.filter((e) => e === "change").length >= 2);
});

test("reset restores the opening balance and clears history", () => {
  const wallet = fresh(10_000);
  const bet = wallet.placeBet(5000, "crash");
  wallet.settle(bet.id, 0);
  wallet.reset();
  assert.equal(wallet.balance, 10_000);
  assert.equal(wallet.ledger.length, 0);
  assert.equal(wallet.stats().rounds, 0);
});

test("one credit is one hundred minor units", () => {
  assert.equal(UNIT, 100);
});
