/**
 * The hand-written SHA-256 / HMAC-SHA256 is the root of the fairness scheme:
 * if it disagrees with the reference implementation by a single bit, every
 * "provably fair" claim in this project is false. So it is checked against
 * node:crypto over fixed vectors, every length around the block boundary, and
 * randomised input.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { sha256, hmacSha256, toHex, fromHex, utf8, sha256Hex, hmacHex } from "../casino/js/core/sha256.js";

test("SHA-256 matches the published FIPS test vectors", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
});

test("SHA-256 matches node:crypto at every length across the block boundary", () => {
  // 55/56 and 63/64 are where the padding block splits — the classic off-by-one.
  for (let len = 0; len <= 200; len++) {
    const input = randomBytes(len);
    assert.equal(
      toHex(sha256(input)),
      createHash("sha256").update(input).digest("hex"),
      `mismatch at length ${len}`
    );
  }
});

test("SHA-256 matches node:crypto on multi-megabyte input", () => {
  const input = randomBytes(1_000_003);
  assert.equal(toHex(sha256(input)), createHash("sha256").update(input).digest("hex"));
});

test("HMAC-SHA256 matches node:crypto, including keys longer than the block size", () => {
  for (const keyLen of [0, 1, 31, 32, 63, 64, 65, 200]) {
    for (const msgLen of [0, 1, 55, 64, 129]) {
      const key = randomBytes(keyLen);
      const message = randomBytes(msgLen);
      assert.equal(
        toHex(hmacSha256(key, message)),
        createHmac("sha256", key).update(message).digest("hex"),
        `mismatch for key ${keyLen} / message ${msgLen}`
      );
    }
  }
});

test("HMAC-SHA256 matches RFC 4231 test case 1", () => {
  const key = new Uint8Array(20).fill(0x0b);
  assert.equal(
    toHex(hmacSha256(key, utf8("Hi There"))),
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
  );
});

test("hex round-trips and rejects malformed input", () => {
  const bytes = randomBytes(48);
  assert.deepEqual([...fromHex(toHex(bytes))], [...bytes]);
  assert.throws(() => fromHex("abc"), /even length/);
  assert.throws(() => fromHex("zz"), /invalid hex/);
});

test("hmacHex convenience wrapper agrees with node:crypto", () => {
  assert.equal(
    hmacHex("server-seed", "client:0:0"),
    createHmac("sha256", "server-seed").update("client:0:0").digest("hex")
  );
});
