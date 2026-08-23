/**
 * Provably-fair randomness.
 *
 * Commit–reveal scheme, the same construction used by public "provably fair"
 * casinos:
 *
 *   1. Before play, the house generates a random `serverSeed` and publishes only
 *      its commitment `SHA256(serverSeed)`. It cannot change the seed afterwards
 *      without breaking the hash.
 *   2. The player supplies a `clientSeed` they control (and may change at will),
 *      so the house cannot pick a server seed that is favourable against a known
 *      client seed.
 *   3. Each round consumes an incrementing `nonce`. The random stream for a round
 *      is HMAC-SHA256(serverSeed, `clientSeed:nonce:cursor`), read as bytes.
 *   4. When the seed is rotated the old `serverSeed` is revealed, and anyone can
 *      recompute every past round and check it against the commitment.
 *
 * Every game in this project derives its outcome from `Round.floats()` and
 * nothing else — no `Math.random()` anywhere in game logic — so every result is
 * reproducible from (serverSeed, clientSeed, nonce).
 */

import { hmacSha256, sha256, toHex, utf8 } from "./sha256.js";

/** Bytes consumed per generated float. 4 bytes ⇒ ~2^-32 resolution. */
const BYTES_PER_FLOAT = 4;
/** HMAC-SHA256 output size; yields 8 floats per invocation. */
const BYTES_PER_HMAC = 32;
const FLOATS_PER_HMAC = BYTES_PER_HMAC / BYTES_PER_FLOAT;

/**
 * Cryptographically strong random hex string.
 * Uses the platform CSPRNG; available in browsers and Node >= 19 as a global.
 * @param {number} byteLength
 * @returns {string} hex
 */
export function randomSeed(byteLength = 32) {
  const buf = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    throw new Error("No CSPRNG available: crypto.getRandomValues is required");
  }
  return toHex(buf);
}

/** @param {string} serverSeed @returns {string} public commitment */
export function commitmentOf(serverSeed) {
  return toHex(sha256(utf8(serverSeed)));
}

/**
 * A single round's random stream. Deterministic and replayable.
 * Floats are produced lazily and cached, so calling `floats(3)` then `floats(5)`
 * returns a consistent, extending sequence.
 */
export class Round {
  /**
   * @param {string} serverSeed
   * @param {string} clientSeed
   * @param {number} nonce
   */
  constructor(serverSeed, clientSeed, nonce) {
    this.serverSeed = serverSeed;
    this.clientSeed = clientSeed;
    this.nonce = nonce;
    /** @type {number[]} */
    this._cache = [];
    this._cursor = 0;
    this._key = utf8(serverSeed);
  }

  /**
   * The first `count` floats of the stream, each uniform in [0, 1).
   * @param {number} count
   * @returns {number[]}
   */
  floats(count) {
    while (this._cache.length < count) {
      const message = utf8(`${this.clientSeed}:${this.nonce}:${this._cursor}`);
      const bytes = hmacSha256(this._key, message);
      for (let i = 0; i < FLOATS_PER_HMAC; i++) {
        const o = i * BYTES_PER_FLOAT;
        // Big-endian base-256 fraction: b0/256 + b1/256² + b2/256³ + b3/256⁴.
        // Always < 1 and never exactly 1, which keeps `int()` in range.
        this._cache.push(
          bytes[o] / 256 +
            bytes[o + 1] / 256 ** 2 +
            bytes[o + 2] / 256 ** 3 +
            bytes[o + 3] / 256 ** 4
        );
      }
      this._cursor++;
    }
    return this._cache.slice(0, count);
  }

  /** The float at stream position `index` (0-based). */
  at(index) {
    return this.floats(index + 1)[index];
  }

  /**
   * Uniform integer in [0, maxExclusive) from stream position `index`.
   * @param {number} maxExclusive
   * @param {number} index
   */
  int(maxExclusive, index = 0) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(this.at(index) * maxExclusive);
  }

  /**
   * Fisher–Yates shuffle driven by the round stream. Pure: returns a new array.
   * Consumes `items.length - 1` floats starting at `startIndex`.
   * @template T
   * @param {readonly T[]} items
   * @param {number} startIndex
   * @returns {T[]}
   */
  shuffle(items, startIndex = 0) {
    const out = items.slice();
    const needed = Math.max(0, out.length - 1);
    const stream = this.floats(startIndex + needed);
    for (let i = out.length - 1, k = 0; i > 0; i--, k++) {
      const j = Math.floor(stream[startIndex + k] * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Draw `count` distinct integers from [0, poolSize) without replacement.
   * Used by Mines and Keno. Partial Fisher–Yates: O(poolSize) but exact.
   * @param {number} count
   * @param {number} poolSize
   * @returns {number[]} in draw order
   */
  pick(count, poolSize) {
    if (count > poolSize) throw new RangeError("cannot pick more items than the pool holds");
    const pool = Array.from({ length: poolSize }, (_, i) => i);
    const stream = this.floats(count);
    const out = [];
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(stream[i] * (poolSize - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      out.push(pool[i]);
    }
    return out;
  }
}

/**
 * Holds the seed triple for a play session and mints rounds.
 * The server seed lives here only because there is no server — in a real
 * deployment `serverSeed` never leaves the backend until rotation.
 */
export class FairnessEngine {
  /**
   * @param {{serverSeed?: string, clientSeed?: string, nonce?: number}} [init]
   */
  constructor(init = {}) {
    this.serverSeed = init.serverSeed ?? randomSeed();
    this.clientSeed = init.clientSeed ?? randomSeed(8);
    this.nonce = init.nonce ?? 0;
    /** Seed pre-generated for the next rotation, so its commitment can be shown now. */
    this.nextServerSeed = randomSeed();
  }

  /** Public commitment for the seed currently in play. */
  get commitment() {
    return commitmentOf(this.serverSeed);
  }

  /** Commitment for the seed that takes over on the next rotation. */
  get nextCommitment() {
    return commitmentOf(this.nextServerSeed);
  }

  /**
   * Mint the next round and advance the nonce.
   * @returns {Round}
   */
  nextRound() {
    const round = new Round(this.serverSeed, this.clientSeed, this.nonce);
    this.nonce += 1;
    return round;
  }

  /** Replay a historical round without touching the nonce. */
  replay(nonce, { serverSeed = this.serverSeed, clientSeed = this.clientSeed } = {}) {
    return new Round(serverSeed, clientSeed, nonce);
  }

  /** Player-initiated client seed change. Resets the nonce, as is conventional. */
  setClientSeed(seed) {
    const trimmed = String(seed).trim();
    if (!trimmed) throw new Error("client seed cannot be empty");
    if (trimmed.length > 128) throw new Error("client seed too long (max 128 chars)");
    this.clientSeed = trimmed;
    this.nonce = 0;
    return this.clientSeed;
  }

  /**
   * Rotate the server seed, revealing the retired one for verification.
   * @returns {{revealedServerSeed: string, revealedCommitment: string, roundsPlayed: number, newCommitment: string}}
   */
  rotate() {
    const revealedServerSeed = this.serverSeed;
    const revealedCommitment = commitmentOf(revealedServerSeed);
    const roundsPlayed = this.nonce;

    this.serverSeed = this.nextServerSeed;
    this.nextServerSeed = randomSeed();
    this.nonce = 0;

    return {
      revealedServerSeed,
      revealedCommitment,
      roundsPlayed,
      newCommitment: this.commitment,
    };
  }

  toJSON() {
    return {
      serverSeed: this.serverSeed,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      nextServerSeed: this.nextServerSeed,
    };
  }

  static fromJSON(data) {
    const engine = new FairnessEngine(data);
    if (data?.nextServerSeed) engine.nextServerSeed = data.nextServerSeed;
    return engine;
  }
}

/**
 * Independent verification: does `serverSeed` match the published commitment,
 * and what floats did round `nonce` actually produce?
 *
 * @param {{serverSeed: string, clientSeed: string, nonce: number, commitment?: string, floatCount?: number}} input
 * @returns {{commitmentValid: boolean|null, computedCommitment: string, floats: number[]}}
 */
export function verifyRound({ serverSeed, clientSeed, nonce, commitment, floatCount = 8 }) {
  const computedCommitment = commitmentOf(serverSeed);
  const round = new Round(serverSeed, clientSeed, Number(nonce));
  return {
    commitmentValid: commitment ? computedCommitment === commitment.toLowerCase().trim() : null,
    computedCommitment,
    floats: round.floats(floatCount),
  };
}
