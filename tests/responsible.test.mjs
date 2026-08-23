/**
 * Responsible-play limits. These are checked *before* a stake is accepted, so
 * the decision function must be exact at the boundary — "reached the limit"
 * has to block, not merely warn.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ResponsiblePlay, DEFAULT_LIMITS } from "../casino/js/core/responsible.js";
import { createMemoryStore } from "../assets/js/storage.js";

/** A controllable clock, so session tests do not depend on wall time. */
function clock(start = 0) {
  let now = start;
  return { now: () => now, advanceMinutes: (m) => (now += m * 60_000) };
}

const build = (limits = {}, time = clock()) => {
  const rp = new ResponsiblePlay({ store: createMemoryStore(), now: time.now });
  rp.setLimits(limits);
  return rp;
};

test("with no limits set, everything is allowed", () => {
  const rp = new ResponsiblePlay({ store: createMemoryStore() });
  assert.deepEqual(rp.limits, DEFAULT_LIMITS);
  assert.equal(rp.check({ stake: 1_000_000, netResult: -9_999_999 }).allowed, true);
});

test("the stake limit blocks at the boundary, not one unit past it", () => {
  const rp = build({ stakeLimit: 1000 });
  assert.equal(rp.check({ stake: 1000, netResult: 0 }).allowed, true, "exactly the limit is allowed");
  assert.equal(rp.check({ stake: 1001, netResult: 0 }).code, "stake_limit");
});

test("the loss limit blocks once the loss has been reached", () => {
  const rp = build({ lossLimit: 5000 });
  assert.equal(rp.check({ stake: 100, netResult: -4999 }).allowed, true);
  assert.equal(rp.check({ stake: 100, netResult: -5000 }).code, "loss_limit", "reaching the limit must block");
  assert.equal(rp.check({ stake: 100, netResult: -9000 }).code, "loss_limit");
});

test("a player in profit is never blocked by the loss limit", () => {
  const rp = build({ lossLimit: 5000 });
  assert.equal(rp.check({ stake: 100, netResult: 12_000 }).allowed, true);
  assert.equal(rp.check({ stake: 100, netResult: 0 }).allowed, true);
});

test("the session clock blocks once the limit is reached", () => {
  const time = clock();
  const rp = build({ sessionMinutes: 60 }, time);

  time.advanceMinutes(59);
  assert.equal(rp.check({ stake: 100, netResult: 0 }).allowed, true);

  time.advanceMinutes(1);
  assert.equal(rp.check({ stake: 100, netResult: 0 }).code, "session_limit");
});

test("resetting the session restarts the clock", () => {
  const time = clock();
  const rp = build({ sessionMinutes: 30 }, time);
  time.advanceMinutes(31);
  assert.equal(rp.check({ stake: 100, netResult: 0 }).allowed, false);

  rp.resetSession();
  assert.equal(rp.check({ stake: 100, netResult: 0 }).allowed, true);
});

test("self-exclusion blocks play and reports the remaining time", () => {
  const time = clock();
  const rp = build({}, time);
  rp.selfExclude(60);

  const verdict = rp.check({ stake: 100, netResult: 0 });
  assert.equal(verdict.code, "self_excluded");
  assert.match(verdict.reason, /60 min/);

  time.advanceMinutes(61);
  assert.equal(rp.check({ stake: 100, netResult: 0 }).allowed, true, "the period expires on its own");
});

test("self-exclusion cannot be shortened, only extended", () => {
  const time = clock();
  const rp = build({}, time);
  rp.selfExclude(1440);
  const long = rp.excludedUntil;

  rp.selfExclude(5);
  assert.equal(rp.excludedUntil, long, "a shorter period must not override a longer one");

  rp.selfExclude(10_080);
  assert.ok(rp.excludedUntil > long, "a longer period does extend it");
});

test("self-exclusion overrides every other limit", () => {
  const rp = build({ stakeLimit: 100_000, lossLimit: null });
  rp.selfExclude(30);
  assert.equal(rp.check({ stake: 1, netResult: 100_000 }).code, "self_excluded");
});

test("the reminder fires once per session, not on every tick", () => {
  const time = clock();
  const rp = build({ reminderMinutes: 30 }, time);
  let fired = 0;
  rp.on("reminder", () => fired++);

  time.advanceMinutes(29);
  rp.tick();
  assert.equal(fired, 0);

  time.advanceMinutes(1);
  rp.tick();
  rp.tick();
  rp.tick();
  assert.equal(fired, 1, "the reminder must not repeat on every tick");
});

test("limits and exclusion survive a reload", () => {
  const store = createMemoryStore();
  const first = new ResponsiblePlay({ store });
  first.setLimits({ lossLimit: 2500, stakeLimit: 500 });
  first.selfExclude(120);

  const reloaded = new ResponsiblePlay({ store });
  assert.equal(reloaded.limits.lossLimit, 2500);
  assert.equal(reloaded.limits.stakeLimit, 500);
  assert.equal(reloaded.isExcluded, true, "a cooling-off period must survive a page reload");
});

test("all limit reasons are written in Spanish for the player", () => {
  const time = clock();
  const rp = build({ stakeLimit: 100, lossLimit: 100, sessionMinutes: 1 }, time);
  assert.match(rp.check({ stake: 200, netResult: 0 }).reason, /límite/i);
  assert.match(rp.check({ stake: 50, netResult: -200 }).reason, /pérdidas/i);
  time.advanceMinutes(2);
  assert.match(rp.check({ stake: 50, netResult: 0 }).reason, /tiempo/i);
});
