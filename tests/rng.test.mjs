/**
 * The fairness layer: determinism (the same triple must always replay the same
 * round), independence between nonces, uniformity, and the commit-reveal
 * property that makes the scheme worth anything.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { Round, FairnessEngine, verifyRound, commitmentOf, randomSeed } from "../casino/js/core/rng.js";

const SERVER = "server-seed-under-test";
const CLIENT = "client-seed";

test("a round is fully determined by (serverSeed, clientSeed, nonce)", () => {
  const a = new Round(SERVER, CLIENT, 7).floats(16);
  const b = new Round(SERVER, CLIENT, 7).floats(16);
  assert.deepEqual(a, b);
});

test("floats extend consistently as more are requested", () => {
  const round = new Round(SERVER, CLIENT, 0);
  const first = round.floats(3);
  const more = round.floats(20);
  assert.deepEqual(more.slice(0, 3), first, "already-issued floats must not change");
  assert.equal(more.length, 20);
});

test("the stream crosses HMAC block boundaries correctly", () => {
  // Each HMAC yields 8 floats; index 8 is the first of the second block.
  const round = new Round(SERVER, CLIENT, 0);
  const floats = round.floats(24);

  const expected = [];
  for (let cursor = 0; cursor < 3; cursor++) {
    const mac = createHmac("sha256", SERVER).update(`${CLIENT}:0:${cursor}`).digest();
    for (let i = 0; i < 8; i++) {
      const o = i * 4;
      expected.push(mac[o] / 256 + mac[o + 1] / 256 ** 2 + mac[o + 2] / 256 ** 3 + mac[o + 3] / 256 ** 4);
    }
  }
  assert.deepEqual(floats, expected);
});

test("different nonces produce independent streams", () => {
  const a = new Round(SERVER, CLIENT, 0).floats(8);
  const b = new Round(SERVER, CLIENT, 1).floats(8);
  assert.notDeepEqual(a, b);
});

test("changing the client seed changes every result", () => {
  const a = new Round(SERVER, "alice", 0).floats(8);
  const b = new Round(SERVER, "bob", 0).floats(8);
  assert.notDeepEqual(a, b);
});

test("floats are strictly inside [0, 1)", () => {
  const floats = new Round(SERVER, CLIENT, 0).floats(50_000);
  assert.ok(floats.every((f) => f >= 0 && f < 1), "every float must be in [0,1)");
});

test("the stream is uniform: mean, variance and bucket distribution", () => {
  const n = 400_000;
  const floats = [];
  for (let nonce = 0; nonce < 400; nonce++) {
    floats.push(...new Round(SERVER, CLIENT, nonce).floats(1000));
  }

  const mean = floats.reduce((a, b) => a + b, 0) / n;
  assert.ok(Math.abs(mean - 0.5) < 0.003, `mean was ${mean}`);

  const variance = floats.reduce((a, f) => a + (f - mean) ** 2, 0) / n;
  // Uniform(0,1) has variance 1/12 ≈ 0.08333.
  assert.ok(Math.abs(variance - 1 / 12) < 0.002, `variance was ${variance}`);

  // Chi-square over 20 buckets. Critical value at 19 df, p=0.001 is 43.82.
  const buckets = new Array(20).fill(0);
  for (const f of floats) buckets[Math.floor(f * 20)]++;
  const expected = n / 20;
  const chi2 = buckets.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 43.82, `chi-square was ${chi2}, distribution is not uniform`);
});

test("int() is uniform and stays in range", () => {
  const counts = new Array(37).fill(0);
  for (let nonce = 0; nonce < 37_000; nonce++) {
    const value = new Round(SERVER, CLIENT, nonce).int(37, 0);
    assert.ok(Number.isInteger(value) && value >= 0 && value < 37);
    counts[value]++;
  }
  const expected = 37_000 / 37;
  const chi2 = counts.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 70, `chi-square over 37 pockets was ${chi2}`);
});

test("int() rejects a non-positive or non-integer bound", () => {
  const round = new Round(SERVER, CLIENT, 0);
  assert.throws(() => round.int(0), RangeError);
  assert.throws(() => round.int(-5), RangeError);
  assert.throws(() => round.int(2.5), RangeError);
});

test("shuffle is a permutation and is deterministic", () => {
  const source = Array.from({ length: 52 }, (_, i) => i);
  const a = new Round(SERVER, CLIENT, 3).shuffle(source);
  const b = new Round(SERVER, CLIENT, 3).shuffle(source);

  assert.deepEqual(a, b, "same round must shuffle identically");
  assert.deepEqual([...a].sort((x, y) => x - y), source, "must be a permutation");
  assert.notDeepEqual(a, source, "must actually reorder");
  assert.deepEqual(source, Array.from({ length: 52 }, (_, i) => i), "must not mutate the input");
});

test("shuffle has no positional bias", () => {
  // Track where element 0 lands across many shuffles of a 5-element array.
  const positions = new Array(5).fill(0);
  for (let nonce = 0; nonce < 20_000; nonce++) {
    positions[new Round(SERVER, CLIENT, nonce).shuffle([0, 1, 2, 3, 4]).indexOf(0)]++;
  }
  const expected = 20_000 / 5;
  const chi2 = positions.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 18.47, `positional chi-square was ${chi2}`);
});

test("pick returns distinct values in range", () => {
  for (let nonce = 0; nonce < 500; nonce++) {
    const picked = new Round(SERVER, CLIENT, nonce).pick(5, 25);
    assert.equal(picked.length, 5);
    assert.equal(new Set(picked).size, 5, "picks must be distinct");
    assert.ok(picked.every((v) => v >= 0 && v < 25));
  }
});

test("pick is uniform over the pool", () => {
  const counts = new Array(25).fill(0);
  for (let nonce = 0; nonce < 20_000; nonce++) {
    for (const v of new Round(SERVER, CLIENT, nonce).pick(5, 25)) counts[v]++;
  }
  const expected = (20_000 * 5) / 25;
  const chi2 = counts.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 52.6, `pick chi-square was ${chi2}`);
});

test("pick refuses to draw more than the pool holds", () => {
  assert.throws(() => new Round(SERVER, CLIENT, 0).pick(26, 25), RangeError);
});

test("the commitment is SHA-256 of the server seed", () => {
  assert.equal(commitmentOf(SERVER), createHash("sha256").update(SERVER).digest("hex"));
});

test("verifyRound confirms a matching commitment and rejects a forged seed", () => {
  const commitment = commitmentOf(SERVER);

  const honest = verifyRound({ serverSeed: SERVER, clientSeed: CLIENT, nonce: 4, commitment });
  assert.equal(honest.commitmentValid, true);
  assert.deepEqual(honest.floats, new Round(SERVER, CLIENT, 4).floats(8));

  // The whole point: a house that swapped the seed after the fact gets caught.
  const forged = verifyRound({ serverSeed: "a-more-favourable-seed", clientSeed: CLIENT, nonce: 4, commitment });
  assert.equal(forged.commitmentValid, false);
});

test("verifyRound reports null validity when no commitment is supplied", () => {
  assert.equal(verifyRound({ serverSeed: SERVER, clientSeed: CLIENT, nonce: 0 }).commitmentValid, null);
});

test("the engine advances the nonce once per round", () => {
  const engine = new FairnessEngine({ serverSeed: SERVER, clientSeed: CLIENT, nonce: 0 });
  assert.equal(engine.nonce, 0);
  engine.nextRound();
  engine.nextRound();
  assert.equal(engine.nonce, 2);
  // Replay must not disturb the live nonce.
  engine.replay(0);
  assert.equal(engine.nonce, 2);
});

test("rotation reveals the retired seed and installs the pre-committed one", () => {
  const engine = new FairnessEngine({ serverSeed: SERVER, clientSeed: CLIENT });
  const promisedNext = engine.nextCommitment;
  engine.nextRound();
  engine.nextRound();

  const { revealedServerSeed, revealedCommitment, roundsPlayed, newCommitment } = engine.rotate();

  assert.equal(revealedServerSeed, SERVER, "the seed actually played must be revealed");
  assert.equal(revealedCommitment, commitmentOf(SERVER));
  assert.equal(roundsPlayed, 2);
  assert.equal(newCommitment, promisedNext, "the new seed must be the one committed to in advance");
  assert.equal(engine.nonce, 0, "rotation resets the nonce");
});

test("changing the client seed resets the nonce and is validated", () => {
  const engine = new FairnessEngine({ serverSeed: SERVER, clientSeed: CLIENT });
  engine.nextRound();
  engine.setClientSeed("  my-own-seed  ");
  assert.equal(engine.clientSeed, "my-own-seed", "the seed is trimmed");
  assert.equal(engine.nonce, 0);
  assert.throws(() => engine.setClientSeed("   "), /cannot be empty/);
  assert.throws(() => engine.setClientSeed("x".repeat(200)), /too long/);
});

test("engine state survives a serialise/restore cycle", () => {
  const engine = new FairnessEngine({ serverSeed: SERVER, clientSeed: CLIENT });
  engine.nextRound();
  const restored = FairnessEngine.fromJSON(JSON.parse(JSON.stringify(engine)));

  assert.equal(restored.serverSeed, engine.serverSeed);
  assert.equal(restored.nonce, engine.nonce);
  assert.equal(restored.nextServerSeed, engine.nextServerSeed, "the pre-commitment must survive");
  assert.deepEqual(restored.nextRound().floats(4), engine.nextRound().floats(4));
});

test("randomSeed produces distinct hex of the requested length", () => {
  const seeds = new Set(Array.from({ length: 200 }, () => randomSeed(32)));
  assert.equal(seeds.size, 200, "seeds must not repeat");
  assert.ok(/^[0-9a-f]{64}$/.test(randomSeed(32)));
  assert.ok(/^[0-9a-f]{16}$/.test(randomSeed(8)));
});
