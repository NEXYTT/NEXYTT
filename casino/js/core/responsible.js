/**
 * Responsible-play guardrails.
 *
 * Even with virtual credits this is the right default posture, and it is the
 * part of a real operator's stack that regulators actually audit. Three
 * mechanisms, all enforced before a bet is accepted:
 *
 *   - **Loss limit** — a ceiling on net loss per session.
 *   - **Session clock** — a reminder, then a hard stop after N minutes.
 *   - **Self-exclusion** — a cooling-off period the player cannot cancel early.
 *
 * `check()` is a pure decision function so the limits can be unit-tested
 * without a clock or a DOM.
 */

import { Emitter } from "../../../assets/js/emitter.js";

export const DEFAULT_LIMITS = {
  /** Net loss ceiling in minor units. null = off. */
  lossLimit: null,
  /** Session length in minutes before play is blocked. null = off. */
  sessionMinutes: null,
  /** Minutes before a "you have been playing for a while" reminder. */
  reminderMinutes: 30,
  /** Max single stake, minor units. null = off. */
  stakeLimit: null,
};

export class ResponsiblePlay extends Emitter {
  /**
   * @param {{store: import('../../../assets/js/storage.js').Store, key?: string, now?: () => number}} opts
   */
  constructor({ store, key = "responsible", now = Date.now }) {
    super();
    this._store = store;
    this._key = key;
    this._now = now;

    const saved = store.get(key) ?? {};
    this.limits = { ...DEFAULT_LIMITS, ...(saved.limits ?? {}) };
    this.sessionStart = saved.sessionStart ?? now();
    this.excludedUntil = saved.excludedUntil ?? null;
    this._reminded = false;
  }

  /** Minutes elapsed in the current session. */
  get elapsedMinutes() {
    return (this._now() - this.sessionStart) / 60000;
  }

  get isExcluded() {
    return this.excludedUntil != null && this._now() < this.excludedUntil;
  }

  /**
   * Decide whether a stake may be placed.
   *
   * @param {{stake:number, netResult:number}} ctx  netResult is
   *   returned-minus-wagered so far (negative when losing).
   * @returns {{allowed:boolean, reason?:string, code?:string}}
   */
  check({ stake, netResult }) {
    if (this.isExcluded) {
      const minutes = Math.ceil((this.excludedUntil - this._now()) / 60000);
      return {
        allowed: false,
        code: "self_excluded",
        reason: `Autoexclusión activa. Quedan ${minutes} min.`,
      };
    }

    const { stakeLimit, lossLimit, sessionMinutes } = this.limits;

    if (stakeLimit != null && stake > stakeLimit) {
      return {
        allowed: false,
        code: "stake_limit",
        reason: `La apuesta supera tu límite por jugada.`,
      };
    }

    // netResult is negative when losing, so a 200-credit loss is netResult = -200.
    if (lossLimit != null && -netResult >= lossLimit) {
      return {
        allowed: false,
        code: "loss_limit",
        reason: `Has alcanzado tu límite de pérdidas de la sesión.`,
      };
    }

    if (sessionMinutes != null && this.elapsedMinutes >= sessionMinutes) {
      return {
        allowed: false,
        code: "session_limit",
        reason: `Has alcanzado tu límite de tiempo de sesión.`,
      };
    }

    return { allowed: true };
  }

  /** Emits `reminder` once per session when the reminder threshold is crossed. */
  tick() {
    const { reminderMinutes } = this.limits;
    if (!this._reminded && reminderMinutes != null && this.elapsedMinutes >= reminderMinutes) {
      this._reminded = true;
      this.emit("reminder", Math.floor(this.elapsedMinutes));
    }
  }

  setLimits(patch) {
    this.limits = { ...this.limits, ...patch };
    this._persist();
    this.emit("limits", this.limits);
    return this.limits;
  }

  /** Start a cooling-off period. Cannot be shortened once set. */
  selfExclude(minutes) {
    const until = this._now() + minutes * 60000;
    this.excludedUntil = Math.max(this.excludedUntil ?? 0, until);
    this._persist();
    this.emit("excluded", this.excludedUntil);
    return this.excludedUntil;
  }

  resetSession() {
    this.sessionStart = this._now();
    this._reminded = false;
    this._persist();
    this.emit("session", this.sessionStart);
  }

  _persist() {
    this._store.set(this._key, {
      limits: this.limits,
      sessionStart: this.sessionStart,
      excludedUntil: this.excludedUntil,
    });
  }
}
