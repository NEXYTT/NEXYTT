/**
 * Order lifecycle and per-supplier routing. An order freezes prices at purchase
 * time and splits into one purchase order per supplier — the two properties a
 * dropshipping back office depends on.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrder, advanceOrder, routeToSuppliers, canTransition,
  aggregateEconomics, orderReference, ORDER_STATUS, STATUS_LABEL,
} from "../shop/js/core/orders.js";
import { Cart } from "../shop/js/core/cart.js";
import { createMemoryStore } from "../assets/js/storage.js";

const CUSTOMER = {
  email: "cliente@ejemplo.es", firstName: "Ana", lastName: "Ruiz",
  phone: "600123456", address: "Calle Mayor 1", city: "Madrid",
  postalCode: "28013", country: "ES",
};
const PAYMENT = { method: "card", last4: "4242", brand: "visa" };

/** Deterministic PRNG so references and tracking numbers are reproducible. */
function seeded(seed = 1) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function buildCart({ multiSupplier = true } = {}) {
  const cart = new Cart({ store: createMemoryStore() });
  cart.add({
    productId: "p1", variantId: "m", title: "Lámpara", unitPrice: 2999,
    grams: 400, supplierId: "sup1", supplierCost: 780,
  }, 2);
  if (multiSupplier) {
    cart.add({
      productId: "p2", variantId: null, title: "Cable", unitPrice: 1299,
      grams: 120, supplierId: "sup2", supplierCost: 290,
    }, 1);
  }
  return cart;
}

const build = (opts) =>
  createOrder({
    snapshot: buildCart(opts).snapshot(),
    customer: CUSTOMER,
    payment: PAYMENT,
    now: 1_750_000_000_000,
    random: seeded(),
  });

test("an order cannot be created from an empty cart", () => {
  const empty = new Cart({ store: createMemoryStore() });
  assert.throws(
    () => createOrder({ snapshot: empty.snapshot(), customer: CUSTOMER, payment: PAYMENT }),
    /empty cart/
  );
});

test("a new order starts awaiting payment with a single timeline entry", () => {
  const order = build();
  assert.equal(order.status, "pending_payment");
  assert.equal(order.timeline.length, 1);
  assert.equal(order.timeline[0].status, "pending_payment");
});

test("the reference is readable and avoids characters that are misheard", () => {
  const order = build();
  assert.match(order.reference, /^NX-[0-9A-Z]+-[A-Z2-9]{4}$/);
  assert.ok(!/[ILO01]/.test(order.reference.split("-")[2]), "the random tail must avoid I, L, O, 0 and 1");
});

test("references vary", () => {
  const random = seeded(99);
  const refs = new Set(Array.from({ length: 200 }, () => orderReference(1_750_000_000_000, random)));
  assert.ok(refs.size > 150, `only ${refs.size} distinct references out of 200`);
});

test("one purchase order is created per supplier", () => {
  const order = build();
  assert.equal(order.purchaseOrders.length, 2);
  assert.deepEqual(order.purchaseOrders.map((po) => po.supplierId).sort(), ["sup1", "sup2"]);

  const single = build({ multiSupplier: false });
  assert.equal(single.purchaseOrders.length, 1);
});

test("purchase order costs sum to the order's goods cost", () => {
  const order = build();
  const summed = order.purchaseOrders.reduce((sum, po) => sum + po.cost, 0);
  assert.equal(summed, order.economics.goodsCost);
  assert.equal(summed, 2 * 780 + 1 * 290);
});

test("every cart line ends up in exactly one purchase order", () => {
  const order = build();
  const routedUnits = order.purchaseOrders.flatMap((po) => po.lines).reduce((n, l) => n + l.qty, 0);
  const cartUnits = order.lines.reduce((n, l) => n + l.qty, 0);
  assert.equal(routedUnits, cartUnits);
});

test("the economics identity holds", () => {
  const order = build();
  const e = order.economics;
  assert.equal(e.grossProfit, e.revenueNet - e.goodsCost - e.processingFee);
  assert.equal(e.revenueNet + e.tax, e.revenueGross, "net plus tax must rebuild the gross");
  assert.ok(Math.abs(e.marginRate - e.grossProfit / e.revenueNet) < 1e-12);
});

test("the card number is never stored, only the last four digits", () => {
  const order = build();
  assert.equal(order.payment.last4, "4242");
  assert.ok(!("number" in order.payment), "a PAN must never reach the order record");
  assert.ok(!("cvc" in order.payment));
  assert.ok(!JSON.stringify(order.payment).includes("424242424242"));
});

test("the order freezes prices against later catalogue changes", () => {
  const cart = buildCart();
  const order = createOrder({ snapshot: cart.snapshot(), customer: CUSTOMER, payment: PAYMENT, random: seeded() });
  const originalTotal = order.totals.total;

  cart.lines[0].unitPrice = 9999;          // the catalogue is repriced afterwards
  assert.equal(order.totals.total, originalTotal, "a placed order must not follow the price list");
});

test("the delivery estimate comes from the shipping zone, not a guess", () => {
  const order = build();
  assert.equal(order.eta.minDays, order.totals.zone.etaDays[0]);
  assert.equal(order.eta.maxDays, order.totals.zone.etaDays[1]);
  assert.ok(order.eta.maxAt > order.eta.minAt);
  assert.ok(order.eta.minAt > order.createdAt);
});

test("the happy path walks the whole lifecycle", () => {
  let order = build();
  for (const next of ["paid", "routing", "fulfilled", "shipped", "delivered"]) {
    order = advanceOrder(order, next);
    assert.equal(order.status, next);
  }
  assert.deepEqual(
    order.timeline.map((t) => t.status),
    ["pending_payment", "paid", "routing", "fulfilled", "shipped", "delivered"]
  );
});

test("invalid transitions are rejected", () => {
  const order = build();
  assert.throws(() => advanceOrder(order, "shipped"), /Invalid transition/);
  assert.throws(() => advanceOrder(order, "delivered"), /Invalid transition/);

  const delivered = ["paid", "routing", "fulfilled", "shipped", "delivered"]
    .reduce((o, s) => advanceOrder(o, s), order);
  assert.throws(() => advanceOrder(delivered, "paid"), /Invalid transition/);
  assert.throws(() => advanceOrder(delivered, "shipped"), /Invalid transition/);
});

test("terminal states accept nothing further", () => {
  for (const terminal of ["cancelled", "refunded"]) {
    for (const target of ORDER_STATUS) {
      assert.equal(canTransition(terminal, target), false, `${terminal} → ${target} must be refused`);
    }
  }
});

test("advanceOrder does not mutate the order it is given", () => {
  const order = build();
  const before = JSON.stringify(order);
  advanceOrder(order, "paid");
  assert.equal(JSON.stringify(order), before);
});

test("routing assigns a carrier and tracking number to every parcel", () => {
  const paid = advanceOrder(build(), "paid");
  const routed = routeToSuppliers(paid, { random: seeded(7) });

  assert.equal(routed.status, "routing");
  for (const po of routed.purchaseOrders) {
    assert.equal(po.status, "accepted");
    assert.ok(po.carrier, "every parcel needs a carrier");
    assert.match(po.trackingNumber, /^[A-Z0-9]+$/);
  }
  const numbers = routed.purchaseOrders.map((po) => po.trackingNumber);
  assert.equal(new Set(numbers).size, numbers.length, "tracking numbers must be distinct");
});

test("every status has a Spanish label", () => {
  for (const status of ORDER_STATUS) {
    assert.ok(STATUS_LABEL[status], `${status} has no label`);
  }
});

test("aggregate economics exclude cancelled and refunded orders", () => {
  const good = advanceOrder(build(), "paid");
  const cancelled = advanceOrder(build(), "cancelled");

  const totals = aggregateEconomics([good, cancelled]);
  assert.equal(totals.orders, 1);
  assert.equal(totals.cancelled, 1);
  assert.equal(totals.revenueGross, good.economics.revenueGross);
  assert.equal(totals.grossProfit, good.economics.grossProfit);
});

test("aggregate economics do not divide by zero on an empty book", () => {
  const totals = aggregateEconomics([]);
  assert.equal(totals.orders, 0);
  assert.equal(totals.averageOrderValue, 0);
  assert.equal(totals.marginRate, 0);
  assert.ok(Number.isFinite(totals.marginRate), "must not be NaN or Infinity");
});

test("aggregate figures sum their parts across many orders", () => {
  const orders = Array.from({ length: 5 }, () => advanceOrder(build(), "paid"));
  const totals = aggregateEconomics(orders);
  assert.equal(totals.revenueGross, orders.reduce((s, o) => s + o.economics.revenueGross, 0));
  assert.equal(totals.units, orders.reduce((s, o) => s + o.lines.reduce((n, l) => n + l.qty, 0), 0));
  assert.equal(totals.averageOrderValue, Math.round(totals.revenueGross / 5));
});
