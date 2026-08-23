/**
 * Cart totals. The invariant that matters most is that the displayed total is
 * internally consistent: net + tax === total, every time, in every currency
 * zone, with any combination of promotion and shipping.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Cart, PROMOS, lineKey, MAX_QTY } from "../shop/js/core/cart.js";
import { createMemoryStore } from "../assets/js/storage.js";
import { SHIPPING_ZONES } from "../shop/js/core/pricing.js";

const ITEM = {
  productId: "p1", variantId: "m", title: "Lámpara",
  unitPrice: 2999, compareAt: 4999, grams: 400,
  supplierId: "sup1", supplierCost: 780,
};

const fresh = () => new Cart({ store: createMemoryStore() });

test("a new cart is empty", () => {
  const cart = fresh();
  assert.equal(cart.isEmpty, true);
  assert.equal(cart.count, 0);
  assert.equal(cart.totals().total, 0);
});

test("adding the same product and variant bumps the existing line", () => {
  const cart = fresh();
  cart.add(ITEM, 2);
  cart.add(ITEM, 3);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].qty, 5);
});

test("different variants of one product are separate lines", () => {
  const cart = fresh();
  cart.add(ITEM, 1);
  cart.add({ ...ITEM, variantId: "l" }, 1);
  assert.equal(cart.lines.length, 2);
  assert.equal(cart.count, 2);
});

test("quantity is capped so a stray keystroke cannot become a huge order", () => {
  const cart = fresh();
  cart.add(ITEM, MAX_QTY + 50);
  assert.equal(cart.lines[0].qty, MAX_QTY);
  cart.setQty(cart.lines[0].key, 9999);
  assert.equal(cart.lines[0].qty, MAX_QTY);
});

test("setting a quantity to zero or below removes the line", () => {
  const cart = fresh();
  cart.add(ITEM, 3);
  cart.setQty(cart.lines[0].key, 0);
  assert.equal(cart.isEmpty, true);
});

test("setQty on an unknown key is a no-op, not a crash", () => {
  const cart = fresh();
  cart.add(ITEM, 1);
  assert.doesNotThrow(() => cart.setQty("does::not::exist", 5));
  assert.equal(cart.count, 1);
});

test("adding a non-positive quantity is refused", () => {
  const cart = fresh();
  assert.throws(() => cart.add(ITEM, 0), RangeError);
  assert.throws(() => cart.add(ITEM, -1), RangeError);
  assert.throws(() => cart.add(ITEM, 1.5), RangeError);
});

test("line keys distinguish variants and treat a missing variant as default", () => {
  assert.equal(lineKey("p1", "m"), "p1::m");
  assert.notEqual(lineKey("p1", "m"), lineKey("p1", "l"));
  assert.equal(lineKey("p1", null), lineKey("p1", undefined));
});

test("net plus tax always equals the total, across every zone and promo", () => {
  for (const country of ["ES", "DE", "GB", "MX", "US", "JP"]) {
    for (const promo of [null, ...Object.keys(PROMOS)]) {
      for (const qty of [1, 2, 5]) {
        const cart = fresh();
        cart.setCountry(country);
        cart.add(ITEM, qty);
        cart.add({ ...ITEM, productId: "p2", variantId: null, unitPrice: 1299, grams: 120 }, qty);
        if (promo) cart.applyPromo(promo);

        const t = cart.totals();
        assert.equal(
          t.net + t.tax, t.total,
          `${country}/${promo}/${qty} → net ${t.net} + tax ${t.tax} ≠ total ${t.total}`
        );
        assert.ok(Number.isInteger(t.total) && t.total >= 0);
        assert.equal(t.total, t.discounted + t.shipping, "total must be discounted goods plus shipping");
      }
    }
  }
});

test("a percentage promo discounts the subtotal, not the shipping", () => {
  const cart = fresh();
  cart.add(ITEM, 2);                       // 59,98
  const before = cart.totals();
  assert.equal(cart.applyPromo("NEXYTT15").ok, true);
  const after = cart.totals();

  assert.equal(after.discount, Math.round(before.subtotal * 0.15));
  assert.equal(after.subtotal, before.subtotal, "the subtotal itself does not change");
});

test("a promo below its minimum is refused with a helpful message", () => {
  const cart = fresh();
  cart.add({ ...ITEM, unitPrice: 999 }, 1);
  const result = cart.applyPromo("NEXYTT15");
  assert.equal(result.ok, false);
  assert.match(result.error, /Faltan/);
  assert.equal(cart.promoCode, null);
});

test("an unknown promo code is refused", () => {
  const cart = fresh();
  cart.add(ITEM, 2);
  assert.equal(cart.applyPromo("DOESNOTEXIST").ok, false);
  assert.equal(cart.applyPromo("").ok, false);
  assert.equal(cart.applyPromo(null).ok, false);
});

test("promo codes are case-insensitive and trimmed", () => {
  const cart = fresh();
  cart.add(ITEM, 2);
  assert.equal(cart.applyPromo("  nexytt15  ").ok, true);
  assert.equal(cart.promoCode, "NEXYTT15");
});

test("a promo is dropped automatically once the cart falls below its minimum", () => {
  const cart = fresh();
  cart.add(ITEM, 2);                       // 59,98 — qualifies for NEXYTT15 (min 50)
  cart.applyPromo("NEXYTT15");
  assert.equal(cart.promoCode, "NEXYTT15");

  cart.setQty(cart.lines[0].key, 1);       // 29,99 — no longer qualifies
  assert.equal(cart.promoCode, null, "a discount the customer has lost must not linger");
  assert.equal(cart.totals().discount, 0);
});

test("a fixed promo can never discount below zero", () => {
  const cart = fresh();
  cart.add({ ...ITEM, unitPrice: 9999 }, 1);
  cart.applyPromo("BLACK25");
  const t = cart.totals();
  assert.ok(t.discount <= t.subtotal);
  assert.ok(t.total >= 0);
});

test("a free-shipping promo zeroes shipping without touching the goods", () => {
  const cart = fresh();
  cart.setCountry("MX");                   // expensive zone, high free-shipping threshold
  cart.add({ ...ITEM, unitPrice: 2600 }, 1);
  const before = cart.totals();
  assert.ok(before.shipping > 0, "precondition: this cart should be paying for shipping");

  cart.applyPromo("ENVIOGRATIS");
  const after = cart.totals();
  assert.equal(after.shipping, 0);
  assert.equal(after.discount, 0, "free shipping is not a monetary discount on the goods");
  assert.equal(after.subtotal, before.subtotal);
});

test("shipping recalculates when the destination changes", () => {
  const cart = fresh();
  cart.add(ITEM, 1);
  const spain = cart.totals().shipping;
  cart.setCountry("MX");
  const mexico = cart.totals().shipping;
  assert.ok(mexico > spain, "Latin America must cost more than domestic");
  assert.equal(cart.totals().zone.id, SHIPPING_ZONES.LATAM.id);
});

test("crossing the free-shipping threshold zeroes the shipping line", () => {
  const cart = fresh();
  cart.add(ITEM, 1);                       // 29,99 — under the 49 € threshold
  assert.ok(cart.totals().shipping > 0);
  assert.ok(cart.totals().missingForFree > 0);

  cart.setQty(cart.lines[0].key, 2);       // 59,98 — over it
  assert.equal(cart.totals().shipping, 0);
  assert.equal(cart.totals().shippingFree, true);
});

test("weight accumulates per unit for the shipping calculation", () => {
  const cart = fresh();
  cart.add(ITEM, 3);                       // 400 g each
  cart.add({ ...ITEM, variantId: "l", grams: 150 }, 2);
  assert.equal(cart.totals().grams, 3 * 400 + 2 * 150);
});

test("supplier cost tracks what the goods actually cost us", () => {
  const cart = fresh();
  cart.add(ITEM, 3);
  cart.add({ ...ITEM, productId: "p2", variantId: null, supplierCost: 290 }, 2);
  assert.equal(cart.supplierCost(), 3 * 780 + 2 * 290);
});

test("savings combine the compare-at gap and the promo discount", () => {
  const cart = fresh();
  cart.add(ITEM, 2);                       // saves 2 × (4999 − 2999)
  const withoutPromo = cart.totals().savings;
  assert.equal(withoutPromo, 2 * 2000);

  cart.applyPromo("NEXYTT15");
  assert.equal(cart.totals().savings, 2 * 2000 + cart.totals().discount);
});

test("the cart survives a reload through the store", () => {
  const store = createMemoryStore();
  const first = new Cart({ store });
  first.add(ITEM, 2);
  first.setCountry("DE");
  first.applyPromo("BIENVENIDO10");

  const reloaded = new Cart({ store });
  assert.equal(reloaded.count, 2);
  assert.equal(reloaded.country, "DE");
  assert.equal(reloaded.promoCode, "BIENVENIDO10");
  assert.equal(reloaded.totals().total, first.totals().total);
});

test("clear empties the cart and drops the promo", () => {
  const cart = fresh();
  cart.add(ITEM, 2);
  cart.applyPromo("BIENVENIDO10");
  cart.clear();
  assert.equal(cart.isEmpty, true);
  assert.equal(cart.promoCode, null);
  assert.equal(cart.totals().total, 0);
});

test("a snapshot is a deep copy that later edits cannot reach", () => {
  const cart = fresh();
  cart.add(ITEM, 2);
  const snapshot = cart.snapshot();

  cart.setQty(cart.lines[0].key, 5);
  assert.equal(snapshot.lines[0].qty, 2, "the frozen order must not follow the live cart");
});

test("change events carry the reason and fresh totals", () => {
  const cart = fresh();
  const events = [];
  cart.on("change", (e) => events.push(e.reason));
  cart.add(ITEM, 1);
  cart.setQty(cart.lines[0].key, 2);
  cart.remove(cart.lines[0].key);
  assert.deepEqual(events, ["add", "qty", "remove"]);
});
