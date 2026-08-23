/**
 * Cart state and totals.
 *
 * Pure logic — no DOM, no storage — with persistence injected, so the same
 * module powers the browser cart and the test suite. Totals are recomputed from
 * lines on every read rather than incrementally maintained: incremental totals
 * drift the moment one code path forgets to update them.
 */

import { Emitter } from "../../../assets/js/emitter.js";
import {
  extractTax,
  shippingCost,
  vatRateFor,
  zoneForCountry,
  roundMinor,
  applyRate,
} from "./pricing.js";

/** A cart line is keyed by product + variant, so two sizes of one shirt are separate lines. */
export const lineKey = (productId, variantId) => `${productId}::${variantId ?? "default"}`;

/** Hard cap per line — prevents a stray keystroke turning into a 9999-unit order. */
export const MAX_QTY = 20;

/**
 * @typedef {object} CartLine
 * @property {string} key
 * @property {string} productId
 * @property {string|null} variantId
 * @property {string} title
 * @property {string} [variantLabel]
 * @property {number} unitPrice   minor units, tax inclusive
 * @property {number} [compareAt]
 * @property {number} qty
 * @property {number} grams       per unit
 * @property {string} supplierId
 * @property {number} supplierCost per unit
 */

/**
 * Promotion codes. `type` is one of:
 *  - `percent`  — off the line subtotal
 *  - `fixed`    — flat amount off, never below zero
 *  - `shipping` — free shipping
 */
export const PROMOS = {
  BIENVENIDO10: { code: "BIENVENIDO10", type: "percent", value: 0.1, minSubtotal: 0, label: "10% de descuento" },
  ENVIOGRATIS: { code: "ENVIOGRATIS", type: "shipping", value: 0, minSubtotal: 2500, label: "Envío gratis" },
  NEXYTT15: { code: "NEXYTT15", type: "percent", value: 0.15, minSubtotal: 5000, label: "15% en pedidos +50 €" },
  BLACK25: { code: "BLACK25", type: "fixed", value: 2500, minSubtotal: 9900, label: "25 € de descuento" },
};

export class Cart extends Emitter {
  /**
   * @param {{store: import('../../../assets/js/storage.js').Store, key?: string}} opts
   */
  constructor({ store, key = "cart" }) {
    super();
    this._store = store;
    this._key = key;

    const saved = store.get(key) ?? {};
    /** @type {CartLine[]} */
    this.lines = Array.isArray(saved.lines) ? saved.lines : [];
    /** @type {string|null} */
    this.promoCode = saved.promoCode ?? null;
    /** @type {string} */
    this.country = saved.country ?? "ES";
  }

  get isEmpty() {
    return this.lines.length === 0;
  }

  /** Total number of units, for the header badge. */
  get count() {
    return this.lines.reduce((sum, l) => sum + l.qty, 0);
  }

  /**
   * Add a product (or bump an existing line).
   * @param {Omit<CartLine,'key'|'qty'>} item
   * @param {number} qty
   */
  add(item, qty = 1) {
    if (!Number.isInteger(qty) || qty < 1) throw new RangeError("qty must be a positive integer");
    const key = lineKey(item.productId, item.variantId);
    const existing = this.lines.find((l) => l.key === key);

    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    } else {
      this.lines.push({ ...item, key, qty: Math.min(MAX_QTY, qty) });
    }

    this._commit("add", key);
    return this.totals();
  }

  /** Set an absolute quantity; 0 removes the line. */
  setQty(key, qty) {
    const line = this.lines.find((l) => l.key === key);
    if (!line) return this.totals();

    if (qty <= 0) return this.remove(key);
    line.qty = Math.min(MAX_QTY, Math.floor(qty));
    this._commit("qty", key);
    return this.totals();
  }

  remove(key) {
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.key !== key);
    if (this.lines.length !== before) this._commit("remove", key);
    return this.totals();
  }

  clear() {
    this.lines = [];
    this.promoCode = null;
    this._commit("clear");
  }

  setCountry(countryCode) {
    this.country = countryCode;
    this._commit("country");
    return this.totals();
  }

  /**
   * Apply a promo code.
   * @returns {{ok:true, promo:object}|{ok:false, error:string}}
   */
  applyPromo(rawCode) {
    const code = String(rawCode ?? "").trim().toUpperCase();
    const promo = PROMOS[code];
    if (!promo) return { ok: false, error: "Código no válido." };

    const subtotal = this.subtotal();
    if (subtotal < promo.minSubtotal) {
      const missing = ((promo.minSubtotal - subtotal) / 100).toFixed(2);
      return { ok: false, error: `Faltan ${missing} € para poder usar este código.` };
    }

    this.promoCode = code;
    this._commit("promo");
    return { ok: true, promo };
  }

  clearPromo() {
    this.promoCode = null;
    this._commit("promo");
  }

  /** Sum of line totals before discounts and shipping. */
  subtotal() {
    return this.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  }

  /** Total shipping weight in grams. */
  grams() {
    return this.lines.reduce((sum, l) => sum + l.grams * l.qty, 0);
  }

  /** What the goods cost us — drives the margin shown in the back office. */
  supplierCost() {
    return this.lines.reduce((sum, l) => sum + l.supplierCost * l.qty, 0);
  }

  /**
   * Full money breakdown for the current cart.
   *
   * Order of operations, which is also the order a tax authority expects:
   *   subtotal → discount → shipping → tax extracted from the taxable gross.
   *
   * @returns {{subtotal:number, discount:number, discounted:number, shipping:number, shippingFree:boolean, missingForFree:number, tax:number, net:number, total:number, savings:number, zone:object, promo:object|null, count:number, grams:number}}
   */
  totals() {
    const subtotal = this.subtotal();
    const grams = this.grams();
    const zone = zoneForCountry(this.country);
    const promo = this.promoCode ? PROMOS[this.promoCode] : null;

    // An empty cart ships nothing, so it costs nothing. Without this guard the
    // shipping table would quote the base rate against a zero subtotal and the
    // empty-cart page would display a total of 3,99 €.
    if (this.lines.length === 0) {
      return {
        subtotal: 0, discount: 0, discounted: 0,
        shipping: 0, shippingFree: true, missingForFree: zone.freeOver,
        tax: 0, net: 0, total: 0, savings: 0,
        zone, promo: null, count: 0, grams: 0,
      };
    }

    let discount = 0;
    let freeShipping = false;

    if (promo && subtotal >= promo.minSubtotal) {
      if (promo.type === "percent") discount = applyRate(subtotal, promo.value);
      else if (promo.type === "fixed") discount = Math.min(promo.value, subtotal);
      else if (promo.type === "shipping") freeShipping = true;
    }

    const discounted = subtotal - discount;
    const ship = shippingCost({ zone, grams, subtotal: discounted });
    const shipping = freeShipping ? 0 : ship.cost;

    const total = discounted + shipping;
    const rate = vatRateFor(this.country);
    const { net, tax } = extractTax(total, rate);

    // "You saved X" — compare-at savings plus any promo discount.
    const compareSavings = this.lines.reduce(
      (sum, l) => sum + (l.compareAt && l.compareAt > l.unitPrice ? (l.compareAt - l.unitPrice) * l.qty : 0),
      0
    );

    return {
      subtotal,
      discount,
      discounted,
      shipping,
      shippingFree: shipping === 0,
      missingForFree: freeShipping ? 0 : ship.missingForFree,
      tax,
      net,
      total,
      savings: compareSavings + discount,
      zone,
      promo: promo && (discount > 0 || freeShipping) ? promo : null,
      count: this.count,
      grams,
    };
  }

  /** Snapshot suitable for freezing into an order. */
  snapshot() {
    return {
      lines: structuredClone(this.lines),
      totals: this.totals(),
      country: this.country,
      promoCode: this.promoCode,
    };
  }

  _commit(reason, key) {
    // Drop a promo that the cart no longer qualifies for, so the total never
    // silently keeps a discount the customer has lost.
    if (this.promoCode) {
      const promo = PROMOS[this.promoCode];
      if (promo && this.subtotal() < promo.minSubtotal) this.promoCode = null;
    }
    this._store.set(this._key, {
      lines: this.lines,
      promoCode: this.promoCode,
      country: this.country,
    });
    this.emit("change", { reason, key, totals: this.totals() });
  }
}
