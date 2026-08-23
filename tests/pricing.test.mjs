/**
 * Money maths for the storefront. The invariants worth pinning are the ones a
 * tax inspector or a chargeback would expose: tax extraction must be exact,
 * shipping must round the way carriers do, and margin must never quietly
 * include VAT the business does not keep.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  roundMinor, applyRate, extractTax, vatRateFor, VAT_RATES,
  zoneForCountry, shippingCost, SHIPPING_ZONES,
  paymentFee, PAYMENT_FEE, unitEconomics, suggestPrice, charmPrice, discountPercent,
} from "../shop/js/core/pricing.js";

test("roundMinor rounds half away from zero, symmetrically", () => {
  assert.equal(roundMinor(10.5), 11);
  assert.equal(roundMinor(10.4), 10);
  assert.equal(roundMinor(-10.5), -11, "negatives must not round toward zero");
  assert.equal(roundMinor(-10.4), -10);
  assert.equal(roundMinor(0), 0);
});

test("applyRate always returns an integer", () => {
  for (const [amount, rate] of [[2999, 0.21], [1, 0.5], [7, 0.014], [123456, 0.0725]]) {
    assert.ok(Number.isInteger(applyRate(amount, rate)), `${amount} × ${rate} was not an integer`);
  }
});

test("net plus tax always reconstructs the gross exactly", () => {
  for (let gross = 1; gross <= 5000; gross += 7) {
    for (const rate of [0, 0.16, 0.19, 0.2, 0.21, 0.23]) {
      const { net, tax } = extractTax(gross, rate);
      assert.equal(net + tax, gross, `${gross} at ${rate} did not reconcile`);
      assert.ok(Number.isInteger(net) && Number.isInteger(tax));
      assert.ok(tax >= 0);
    }
  }
});

test("extracting 21% from 29,99 € gives the legally correct split", () => {
  // 29.99 / 1.21 = 24.785… → 24.79 net, 5.20 tax.
  assert.deepEqual(extractTax(2999, 0.21), { net: 2479, tax: 520, gross: 2999 });
});

test("a zero-rate country keeps the whole gross as net", () => {
  assert.deepEqual(extractTax(2999, 0), { net: 2999, tax: 0, gross: 2999 });
});

test("VAT rates resolve per country and fall back to the home rate", () => {
  assert.equal(vatRateFor("ES"), 0.21);
  assert.equal(vatRateFor("DE"), 0.19);
  assert.equal(vatRateFor("US"), 0);
  assert.equal(vatRateFor("ZZ"), 0.21, "unknown country falls back to the home rate");
});

test("every country listed in a shipping zone has a VAT rate", () => {
  for (const zone of Object.values(SHIPPING_ZONES)) {
    for (const country of zone.countries) {
      assert.ok(country in VAT_RATES, `${country} is in a shipping zone but has no VAT rate`);
    }
  }
});

test("countries map to their zone, and anything unknown lands in INTL", () => {
  assert.equal(zoneForCountry("ES").id, "ES_PENINSULA");
  assert.equal(zoneForCountry("DE").id, "EU_WEST");
  assert.equal(zoneForCountry("GB").id, "UK");
  assert.equal(zoneForCountry("MX").id, "LATAM");
  assert.equal(zoneForCountry("JP").id, "INTL");
});

test("no country appears in two shipping zones", () => {
  const seen = new Set();
  for (const zone of Object.values(SHIPPING_ZONES)) {
    for (const country of zone.countries) {
      assert.ok(!seen.has(country), `${country} is listed in more than one zone`);
      seen.add(country);
    }
  }
});

test("shipping bills the excess per started kilo, as carriers do", () => {
  const zone = SHIPPING_ZONES.ES_PENINSULA;
  // Base covers 500 g.
  assert.equal(shippingCost({ zone, grams: 400, subtotal: 1000 }).cost, zone.base);
  assert.equal(shippingCost({ zone, grams: 500, subtotal: 1000 }).cost, zone.base);
  // 501 g is 1 g over: a whole extra kilo is charged.
  assert.equal(shippingCost({ zone, grams: 501, subtotal: 1000 }).cost, zone.base + zone.perKg);
  assert.equal(shippingCost({ zone, grams: 1500, subtotal: 1000 }).cost, zone.base + zone.perKg);
  assert.equal(shippingCost({ zone, grams: 1501, subtotal: 1000 }).cost, zone.base + 2 * zone.perKg);
});

test("shipping is free at the threshold, not just above it", () => {
  const zone = SHIPPING_ZONES.ES_PENINSULA;
  const below = shippingCost({ zone, grams: 3000, subtotal: zone.freeOver - 1 });
  const at = shippingCost({ zone, grams: 3000, subtotal: zone.freeOver });

  assert.ok(below.cost > 0);
  assert.equal(below.missingForFree, 1);
  assert.equal(at.cost, 0);
  assert.equal(at.free, true);
  assert.equal(at.missingForFree, 0);
});

test("the payment fee is a percentage plus a fixed amount", () => {
  assert.equal(paymentFee(10_000), Math.round(10_000 * PAYMENT_FEE.rate) + PAYMENT_FEE.fixed);
  assert.equal(paymentFee(0), PAYMENT_FEE.fixed, "the fixed part applies even to a zero total");
});

test("margin excludes VAT, which the business never keeps", () => {
  const econ = unitEconomics({ price: 2999, supplierCost: 780, supplierShipping: 210, taxRate: 0.21 });
  assert.equal(econ.revenueNet, 2479, "margin is computed on net revenue");
  assert.ok(econ.margin < 2999 - 990, "the margin must be below the naive price-minus-cost figure");
});

test("the unit economics identity holds", () => {
  const input = {
    price: 4999, supplierCost: 1490, supplierShipping: 560,
    shippingCharged: 399, adCostPerOrder: 700, refundRate: 0.03, taxRate: 0.21,
  };
  const e = unitEconomics(input);
  assert.equal(e.margin, e.revenueNet - e.cogs - e.fees - e.adCost - e.refundReserve);
  assert.equal(e.cogs, input.supplierCost + input.supplierShipping);
  assert.ok(Math.abs(e.marginRate - e.margin / e.revenueNet) < 1e-12);
});

test("a product priced below cost reports a negative margin rather than hiding it", () => {
  const e = unitEconomics({ price: 500, supplierCost: 780, supplierShipping: 210 });
  assert.ok(e.margin < 0);
  assert.ok(e.marginRate < 0);
  assert.ok(e.markup < 1);
});

test("break-even ROAS is null when the unit cannot pay for itself", () => {
  const e = unitEconomics({ price: 500, supplierCost: 900, supplierShipping: 300, adCostPerOrder: 0 });
  assert.equal(e.breakEvenRoas, null);
});

test("zero-cost input does not divide by zero", () => {
  const e = unitEconomics({ price: 1999, supplierCost: 0, supplierShipping: 0 });
  assert.equal(e.markup, 0, "markup is reported as 0 rather than Infinity");
  assert.ok(Number.isFinite(e.margin));
});

test("suggestPrice solves the requested margin exactly when charm rounding is off", () => {
  for (const target of [0.3, 0.45, 0.6]) {
    for (const cost of [300, 780, 2680]) {
      const price = suggestPrice({
        supplierCost: cost, supplierShipping: 200, targetMarginRate: target, charm: false,
      });
      const achieved = unitEconomics({ price, supplierCost: cost, supplierShipping: 200 }).marginRate;
      assert.ok(
        Math.abs(achieved - target) < 0.002,
        `cost ${cost} target ${target}: priced ${price} achieving ${achieved.toFixed(4)}`
      );
    }
  }
});

test("charm rounding only ever overshoots the target margin, never undershoots", () => {
  for (const target of [0.3, 0.45, 0.6]) {
    for (const cost of [300, 780, 2680]) {
      const price = suggestPrice({ supplierCost: cost, supplierShipping: 200, targetMarginRate: target });
      const achieved = unitEconomics({ price, supplierCost: cost, supplierShipping: 200 }).marginRate;

      assert.ok(achieved >= target, `cost ${cost} target ${target}: achieved ${achieved.toFixed(4)} is below target`);

      // The overshoot is bounded by one charm step: a euro cheaper would miss.
      const oneStepCheaper = unitEconomics({
        price: price - 100, supplierCost: cost, supplierShipping: 200,
      }).marginRate;
      assert.ok(
        oneStepCheaper < target + 0.002,
        `cost ${cost} target ${target}: price ${price} is more than one charm step above the solution`
      );
    }
  }
});

test("suggestPrice accounts for advertising when asked to", () => {
  const withoutAds = suggestPrice({ supplierCost: 780, targetMarginRate: 0.45 });
  const withAds = suggestPrice({ supplierCost: 780, targetMarginRate: 0.45, adCostPerOrder: 600 });
  assert.ok(withAds > withoutAds, "acquisition cost must push the price up");
});

test("charm pricing always ends in 99 and never rounds down", () => {
  for (const value of [2340, 2399, 2400, 1, 99, 100, 101]) {
    const charmed = charmPrice(value);
    assert.equal(charmed % 100, 99, `${value} → ${charmed} does not end in 99`);
    assert.ok(charmed >= value - 1, `${value} → ${charmed} rounded too far down`);
  }
});

test("discount percent is honest about non-discounts", () => {
  assert.equal(discountPercent(2999, 4999), 40);
  assert.equal(discountPercent(2999, 2999), 0, "an equal compare-at is not a discount");
  assert.equal(discountPercent(2999, 1999), 0, "a lower compare-at is not a discount");
  assert.equal(discountPercent(2999, null), 0);
  assert.equal(discountPercent(2999, undefined), 0);
});
