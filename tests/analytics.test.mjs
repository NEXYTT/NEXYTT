/**
 * Back-office analytics. These numbers decide whether a product gets scaled or
 * dropped, so the tests target the identities that make a P&L trustworthy:
 * the lines must sum to the profit, and no input may produce NaN or Infinity.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  verdictFor, productScorecard, supplierScorecard, catalogSummary,
  simulateMonth, revenueByCategory, toCsv, parseCsv,
  DEFAULT_CAC, DEFAULT_TARGET_MARGIN, VERDICT_LABEL, MIX_PRESETS, CATALOG_COLUMNS,
} from "../shop/js/core/analytics.js";
import { PRODUCTS, CATEGORIES } from "../shop/data/products.js";
import { SUPPLIERS } from "../shop/data/suppliers.js";
import { unitEconomics } from "../shop/js/core/pricing.js";

/* --- Verdicts -------------------------------------------------------------- */

test("a verdict is returned for every product in the catalogue", () => {
  for (const product of PRODUCTS) {
    const card = productScorecard(product, { adCostPerOrder: DEFAULT_CAC });
    assert.ok(card.verdict in VERDICT_LABEL, `${product.id} got an unknown verdict "${card.verdict}"`);
    assert.ok(Number.isFinite(card.margin), `${product.id} produced a non-finite margin`);
    assert.ok(Number.isFinite(card.marginRate));
  }
});

test("a loss-making product is never told to scale, and the reason is explained", () => {
  const losing = unitEconomics({ price: 500, supplierCost: 900, supplierShipping: 300, adCostPerOrder: 600 });
  const bad = verdictFor(losing, DEFAULT_TARGET_MARGIN);
  assert.notEqual(bad.verdict, "escalar");

  const healthy = unitEconomics({ price: 4999, supplierCost: 800, supplierShipping: 100, adCostPerOrder: 300 });
  assert.equal(verdictFor(healthy, DEFAULT_TARGET_MARGIN).verdict, "escalar");

  // A verdict with no stated reason is an opinion, not an analysis.
  for (const result of [bad, verdictFor(healthy, DEFAULT_TARGET_MARGIN)]) {
    assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, "a verdict must carry its reasons");
    for (const reason of result.reasons) {
      assert.ok(reason.code, "each reason needs a code");
      assert.ok(reason.text && reason.text.length > 10, "each reason needs readable text");
    }
  }
});

test("raising the acquisition cost can only worsen a verdict, never improve it", () => {
  const rank = { escalar: 2, vigilar: 1, retirar: 0 };
  for (const product of PRODUCTS) {
    let previous = Infinity;
    for (const cac of [0, 300, 600, 1200, 2400]) {
      const current = rank[productScorecard(product, { adCostPerOrder: cac }).verdict];
      assert.ok(current <= previous, `${product.id} improved when the CAC rose to ${cac}`);
      previous = current;
    }
  }
});

test("the scorecard agrees with the pricing engine it is built on", () => {
  for (const product of PRODUCTS.slice(0, 6)) {
    const card = productScorecard(product, { adCostPerOrder: 500 });
    const econ = unitEconomics({
      price: product.price,
      supplierCost: product.supplierCost,
      supplierShipping: product.supplierShipping,
      adCostPerOrder: 500,
    });
    assert.equal(card.margin, econ.margin, `${product.id} margin disagrees`);
  }
});

/* --- Suppliers ------------------------------------------------------------- */

test("supplier scorecards cover the whole catalogue exactly once", () => {
  const cards = SUPPLIERS.map((s) => supplierScorecard(s, PRODUCTS));
  const counted = cards.reduce((sum, c) => sum + c.products.length, 0);
  assert.equal(counted, PRODUCTS.length, "every product must belong to exactly one supplier");

  for (const card of cards) {
    assert.ok(card.products.length > 0, `${card.supplier?.id ?? "?"} has no products`);
    assert.ok(Number.isFinite(card.risk), "risk must be a number");
    assert.ok(card.risk >= 0, "risk cannot be negative");
    assert.ok(card.band, "every supplier needs a risk band");
  }
});

test("a slower, more defective supplier scores as riskier", () => {
  const safe = { id: "s-safe", name: "Rápido", leadTimeDays: [1, 3], defectRate: 0.005, disputeRate: 0.002, rating: 4.9 };
  const risky = { id: "s-risk", name: "Lento", leadTimeDays: [20, 40], defectRate: 0.09, disputeRate: 0.07, rating: 3.5 };
  const products = PRODUCTS.slice(0, 3);

  const safeCard = supplierScorecard(safe, products.map((p) => ({ ...p, supplierId: "s-safe" })));
  const riskyCard = supplierScorecard(risky, products.map((p) => ({ ...p, supplierId: "s-risk" })));

  assert.ok(riskyCard.risk > safeCard.risk, "the slow, defective supplier must score riskier");
});

/* --- Catalogue summary ----------------------------------------------------- */

test("the catalogue summary reconciles with the products it summarises", () => {
  const summary = catalogSummary(PRODUCTS, { adCostPerOrder: DEFAULT_CAC });

  assert.equal(summary.count, PRODUCTS.length);
  assert.equal(summary.supplierCount, new Set(PRODUCTS.map((p) => p.supplierId)).size);
  assert.equal(summary.categoryCount, new Set(PRODUCTS.map((p) => p.category)).size);
  assert.equal(summary.retailValue, PRODUCTS.reduce((s, p) => s + p.price, 0));
  assert.equal(summary.stockUnits, PRODUCTS.reduce((s, p) => s + p.stock, 0));

  assert.ok(summary.avgMarginRate > 0 && summary.avgMarginRate < 1);
  assert.ok(Number.isFinite(summary.medianMarginRate));

  // Every product must be counted under exactly one verdict.
  const verdictTotal = Object.values(summary.verdicts).reduce((a, b) => a + b, 0);
  assert.equal(verdictTotal, PRODUCTS.length, "the verdict tally must cover the whole catalogue");

  // The by-category breakdown must also account for everything.
  assert.equal(
    summary.byCategory.reduce((sum, c) => sum + c.count, 0),
    PRODUCTS.length,
    "the category breakdown loses products"
  );
});

test("an empty catalogue summarises to zeroes, not NaN", () => {
  const summary = catalogSummary([], {});
  assert.equal(summary.count, 0);
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), `${key} was ${value}`);
    }
  }
});

/* --- Monthly simulation ---------------------------------------------------- */

test("the simulated P&L balances: its lines sum to its profit", () => {
  for (const orders of [1, 50, 500, 5000]) {
    for (const adSpend of [0, 50_000, 500_000]) {
      const month = simulateMonth(PRODUCTS, { orders, adSpend });
      assert.equal(
        month.check.balanced, true,
        `${orders} orders at ${adSpend}: the lines are off by ${month.check.delta}`
      );
    }
  }
});

test("the simulation allocates exactly the orders it was given", () => {
  for (const orders of [0, 1, 7, 250, 3001]) {
    const month = simulateMonth(PRODUCTS, { orders, adSpend: 100_000 });
    const allocated = month.byProduct.reduce((sum, line) => sum + line.orders, 0);
    assert.equal(allocated, orders, `asked for ${orders}, allocated ${allocated}`);
  }
});

test("zero orders produce a zeroed month rather than a divide by zero", () => {
  const month = simulateMonth(PRODUCTS, { orders: 0, adSpend: 0 });
  assert.equal(month.orders, 0);
  assert.equal(month.revenueGross, 0);
  for (const [key, value] of Object.entries(month)) {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), `${key} was ${value}`);
    }
  }
  assert.equal(month.roas, null, "ROAS is undefined without ad spend, and says so");
});

test("advertising spend reduces profit one euro for one euro", () => {
  const without = simulateMonth(PRODUCTS, { orders: 500, adSpend: 0 });
  const with100 = simulateMonth(PRODUCTS, { orders: 500, adSpend: 100_000 });
  assert.equal(with100.profit, without.profit - 100_000);
  assert.equal(with100.revenueGross, without.revenueGross, "ad spend does not change revenue on its own");
});

test("net revenue plus tax equals gross revenue in the simulation", () => {
  const month = simulateMonth(PRODUCTS, { orders: 900, adSpend: 250_000 });
  assert.equal(month.revenueNet + month.tax, month.revenueGross);
});

test("the break-even order count really does break even", () => {
  const month = simulateMonth(PRODUCTS, { orders: 1000, adSpend: 300_000 });
  if (month.breakEvenOrders && Number.isFinite(month.breakEvenOrders)) {
    const atBreakEven = simulateMonth(PRODUCTS, {
      orders: month.breakEvenOrders,
      adSpend: 300_000,
    });
    // Integer order counts mean it lands near zero, not exactly on it.
    assert.ok(
      Math.abs(atBreakEven.profit) < month.revenueGross * 0.02,
      `at ${month.breakEvenOrders} orders the profit was ${atBreakEven.profit}`
    );
  }
});

test("every mix preset allocates orders and balances", () => {
  for (const mix of Object.keys(MIX_PRESETS)) {
    const month = simulateMonth(PRODUCTS, { orders: 400, adSpend: 120_000, mix });
    assert.equal(month.check.balanced, true, `mix "${mix}" does not balance`);
    assert.equal(
      month.byProduct.reduce((sum, l) => sum + l.orders, 0), 400,
      `mix "${mix}" lost orders`
    );
  }
});

test("an explicit mix is honoured", () => {
  const only = PRODUCTS[0];
  const month = simulateMonth(PRODUCTS, {
    orders: 100,
    adSpend: 0,
    mix: [{ productId: only.id, weight: 1 }],
  });
  assert.equal(month.byProduct.length, 1);
  assert.equal(month.byProduct[0].orders, 100);
});

/* --- Revenue attribution --------------------------------------------------- */

test("revenue by category is empty without orders and never negative", () => {
  assert.deepEqual(revenueByCategory([], PRODUCTS), []);

  const fakeOrder = {
    status: "paid",
    lines: [{ productId: PRODUCTS[0].id, qty: 2, unitPrice: PRODUCTS[0].price }],
    economics: { revenueGross: PRODUCTS[0].price * 2, revenueNet: 1000, grossProfit: 400 },
  };
  const rows = revenueByCategory([fakeOrder], PRODUCTS);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.revenue >= 0));
  assert.ok(rows.every((r) => CATEGORIES.some((c) => c.id === r.id)), "each row must name a real category");
  assert.ok(rows.every((r) => r.label), "each row needs a display label");

  // Revenue comes from the order lines, so it reflects what was actually sold.
  assert.equal(rows[0].units, 2);
  assert.equal(rows[0].revenue, PRODUCTS[0].price * 2);
  assert.ok(Math.abs(rows.reduce((sum, r) => sum + r.share, 0) - 1) < 1e-9, "shares must sum to one");

  // A cancelled order must not appear at all.
  assert.deepEqual(revenueByCategory([{ ...fakeOrder, status: "cancelled" }], PRODUCTS), []);
});

/* --- CSV ------------------------------------------------------------------- */

test("toCsv and parseCsv are inverses over the catalogue columns", () => {
  const rows = PRODUCTS.map((p) => ({
    id: p.id, slug: p.slug, title: p.title, price: p.price,
    supplierCost: p.supplierCost, stock: p.stock, bestseller: p.bestseller,
  }));
  const parsed = parseCsv(toCsv(rows));

  assert.equal(parsed.length, rows.length);
  for (let i = 0; i < rows.length; i++) {
    assert.deepEqual(parsed[i], rows[i], `row ${i} did not survive the round trip`);
  }
});

test("CSV quoting survives commas, quotes and newlines in the data", () => {
  const rows = [
    { title: 'Lámpara "Aurora", RGB', note: "línea uno\nlínea dos", price: 2999 },
    { title: "Sin nada raro", note: "", price: 100 },
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("CSV parsing accepts CRLF as well as LF", () => {
  const lf = "a,b\n1,2\n3,4";
  const crlf = "a,b\r\n1,2\r\n3,4";
  assert.deepEqual(parseCsv(crlf), parseCsv(lf));
  assert.deepEqual(parseCsv(lf), [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
});

test("CSV coercion does not mangle values that only look numeric", () => {
  // A leading zero is significant in a postal code; it must survive as text.
  const parsed = parseCsv("code,qty\n08001,3");
  assert.equal(parsed[0].code, "08001", "a leading zero must not be parsed away");
  assert.equal(parsed[0].qty, 3);
});

test("empty and malformed CSV input degrade rather than throw", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv(null), []);
  assert.equal(toCsv([]), "");
  assert.equal(toCsv(null), "");
  // Fewer cells than the header: the missing columns come back empty.
  assert.deepEqual(parseCsv("a,b,c\n1,2"), [{ a: 1, b: 2, c: "" }]);
});

test("the exported catalogue columns all exist on a product row", () => {
  const csv = toCsv(PRODUCTS, { columns: CATALOG_COLUMNS.map((c) => c.key ?? c) });
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, PRODUCTS.length);
  assert.ok(csv.split("\n")[0].length > 0, "the export needs a header row");
});
