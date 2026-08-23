/**
 * The shared platform layer: storage adapter, formatters, event emitter.
 * Small modules, but every page depends on them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, createStore } from "../assets/js/storage.js";
import { Emitter } from "../assets/js/emitter.js";
import {
  money, credits, compact, percent, multiplier,
  dateTime, dateOnly, duration, relative, shortHash,
} from "../assets/js/format.js";

test("the memory store round-trips values", () => {
  const store = createMemoryStore();
  assert.equal(store.get("missing"), undefined);
  store.set("a", { n: 1, list: [1, 2] });
  assert.deepEqual(store.get("a"), { n: 1, list: [1, 2] });
  store.remove("a");
  assert.equal(store.get("a"), undefined);
});

test("the store hands out clones, so callers cannot mutate stored state", () => {
  const store = createMemoryStore();
  store.set("a", { n: 1 });
  const taken = store.get("a");
  taken.n = 99;
  assert.equal(store.get("a").n, 1, "mutating a read value must not reach the store");

  const source = { n: 5 };
  store.set("b", source);
  source.n = 42;
  assert.equal(store.get("b").n, 5, "mutating a written value must not reach the store either");
});

test("keys() lists what was stored", () => {
  const store = createMemoryStore({ seeded: true });
  store.set("x", 1);
  assert.deepEqual(store.keys().sort(), ["seeded", "x"]);
});

test("createStore falls back to memory outside a browser", () => {
  const store = createStore("test.namespace");
  store.set("k", "v");
  assert.equal(store.get("k"), "v");
});

test("money formats minor units as currency", () => {
  assert.equal(money(0).replace(/ /g, " "), "0,00 €");
  assert.equal(money(2999).replace(/ /g, " "), "29,99 €");
  assert.equal(money(123456).replace(/ /g, " "), "1234,56 €");
  assert.ok(money(2999, { currency: "USD" }).includes("29,99"));
});

test("money handles negatives, for refunds and losses", () => {
  assert.ok(money(-2999).includes("29,99"));
  assert.ok(money(-2999).startsWith("-"));
});

test("credits drop the currency symbol", () => {
  assert.equal(credits(500_000), "5000,00");
  assert.equal(credits(0), "0,00");
  assert.ok(!credits(500_000).includes("€"));
});

test("percent and multiplier read as they do in the UI", () => {
  assert.equal(percent(0.0725).replace(/ /g, " "), "7,25 %");
  assert.equal(percent(0.96, { decimals: 1 }).replace(/ /g, " "), "96,0 %");
  assert.equal(multiplier(2.5), "2.50×");
  assert.equal(multiplier(1), "1.00×");
  assert.equal(multiplier(12.3456, 3), "12.346×");
});

test("duration switches to hours only when needed", () => {
  assert.equal(duration(0), "00:00");
  assert.equal(duration(65_000), "01:05");
  assert.equal(duration(3_725_000), "1:02:05");
  assert.equal(duration(-500), "00:00", "negative elapsed time clamps to zero");
});

test("compact abbreviates large numbers", () => {
  assert.equal(compact(999), "999", "small numbers are left alone");
  // Spanish spells the thousands unit out ("12,4 mil"), so compact notation only
  // saves characters from millions upward. It is still the readable form.
  assert.match(compact(12_400), /12,4/);
  assert.ok(compact(2_400_000).length < String(2_400_000).length);
  assert.match(compact(2_400_000), /2,4/);
});

test("date formatters produce a Spanish rendering", () => {
  const ts = Date.UTC(2026, 2, 15, 10, 30);
  assert.ok(dateTime(ts).length > 8);
  assert.ok(dateOnly(ts).length > 5);
  assert.ok(!dateOnly(ts).includes("Invalid"));
});

test("relative time reads naturally in both directions", () => {
  const now = 1_750_000_000_000;
  assert.match(relative(now - 5 * 60_000, { now }), /5/);
  assert.match(relative(now + 2 * 86_400_000, { now }), /2|pasado/);
  assert.ok(relative(now, { now }).length > 0);
});

test("shortHash elides the middle and leaves short strings alone", () => {
  const hex = "e16bf22885dc0909755f99ea46eb2b7032c994ad0f8cbf6446b0df0db5f0de32";
  assert.equal(shortHash(hex), "e16bf228…b5f0de32");
  assert.equal(shortHash("abc"), "abc");
  assert.equal(shortHash(""), "");
  assert.equal(shortHash(null), "");
});

test("the emitter delivers, unsubscribes and fires once", () => {
  const emitter = new Emitter();
  const seen = [];

  const off = emitter.on("x", (v) => seen.push(`on:${v}`));
  emitter.once("x", (v) => seen.push(`once:${v}`));

  emitter.emit("x", 1);
  emitter.emit("x", 2);
  off();
  emitter.emit("x", 3);

  assert.deepEqual(seen, ["on:1", "once:1", "on:2"]);
});

test("a throwing handler does not stop the others", () => {
  const emitter = new Emitter();
  const seen = [];
  const originalError = console.error;
  console.error = () => {};                     // the emitter logs the failure

  emitter.on("x", () => { throw new Error("boom"); });
  emitter.on("x", () => seen.push("survived"));
  emitter.emit("x");

  console.error = originalError;
  assert.deepEqual(seen, ["survived"]);
});

test("a handler may unsubscribe itself mid-emit", () => {
  const emitter = new Emitter();
  const seen = [];
  const off = emitter.on("x", () => {
    seen.push("first");
    off();
  });
  emitter.on("x", () => seen.push("second"));

  emitter.emit("x");
  emitter.emit("x");
  assert.deepEqual(seen, ["first", "second", "second"]);
});

test("emitting an event nobody listens to is harmless", () => {
  assert.doesNotThrow(() => new Emitter().emit("nothing", 1, 2, 3));
});
