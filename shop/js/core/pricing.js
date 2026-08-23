/**
 * Pricing and unit economics for a dropshipping operation.
 *
 * Everything is in **integer minor units** (cents). The rounding rule matters:
 * money is rounded exactly once, at the point a figure becomes a line on an
 * invoice. Percentages are applied to integers and rounded half-up, never
 * accumulated as floats — otherwise a 3-item cart can end up a cent off the
 * sum of its lines, which is the kind of bug that shows up in a chargeback.
 */

/** Round half-up to the nearest minor unit. `Math.round` rounds -0.5 to -0, so sign is handled. */
export const roundMinor = (value) =>
  value < 0 ? -Math.round(-value) : Math.round(value);

/** Apply a basis-point rate (10000 bp = 100%) to an integer amount. */
export const applyRate = (amount, rate) => roundMinor(amount * rate);

/* --- Tax ------------------------------------------------------------------ */

/**
 * VAT rates by destination. Retail prices in this store are **gross**
 * (tax-inclusive), which is the legal requirement for B2C in the EU, so tax is
 * extracted from the price rather than added on top.
 */
export const VAT_RATES = {
  ES: 0.21,
  PT: 0.23,
  FR: 0.2,
  DE: 0.19,
  IT: 0.22,
  NL: 0.21,
  BE: 0.21,
  MX: 0.16,
  AR: 0.21,
  CL: 0.19,
  CO: 0.19,
  US: 0, // sales tax is state-level and out of scope for this demo
  GB: 0.2,
};

export const vatRateFor = (countryCode) => VAT_RATES[countryCode] ?? 0.21;

/**
 * Split a tax-inclusive amount into net + tax.
 * @param {number} gross minor units
 * @param {number} rate e.g. 0.21
 */
export function extractTax(gross, rate) {
  const net = roundMinor(gross / (1 + rate));
  return { net, tax: gross - net, gross };
}

/* --- Shipping ------------------------------------------------------------- */

/**
 * Shipping zones. `base` covers the first `baseGrams`; `perKg` is charged on
 * the excess. `freeOver` is the cart subtotal above which shipping is comped —
 * the single most effective average-order-value lever in dropshipping, so it
 * is a first-class field rather than a promo hack.
 */
export const SHIPPING_ZONES = {
  ES_PENINSULA: {
    id: "ES_PENINSULA",
    label: "España peninsular",
    countries: ["ES"],
    base: 399,
    baseGrams: 500,
    perKg: 149,
    freeOver: 4900,
    etaDays: [3, 6],
  },
  EU_WEST: {
    id: "EU_WEST",
    label: "Europa occidental",
    countries: ["PT", "FR", "DE", "IT", "NL", "BE"],
    base: 699,
    baseGrams: 500,
    perKg: 249,
    freeOver: 7900,
    etaDays: [5, 10],
  },
  UK: {
    id: "UK",
    label: "Reino Unido",
    countries: ["GB"],
    base: 899,
    baseGrams: 500,
    perKg: 299,
    freeOver: 9900,
    etaDays: [6, 12],
  },
  LATAM: {
    id: "LATAM",
    label: "Latinoamérica",
    countries: ["MX", "AR", "CL", "CO"],
    base: 1299,
    baseGrams: 500,
    perKg: 449,
    freeOver: 12900,
    etaDays: [10, 21],
  },
  INTL: {
    id: "INTL",
    label: "Resto del mundo",
    countries: [],
    base: 1699,
    baseGrams: 500,
    perKg: 599,
    freeOver: 15900,
    etaDays: [12, 25],
  },
};

/** @param {string} countryCode @returns {typeof SHIPPING_ZONES[keyof typeof SHIPPING_ZONES]} */
export function zoneForCountry(countryCode) {
  for (const zone of Object.values(SHIPPING_ZONES)) {
    if (zone.countries.includes(countryCode)) return zone;
  }
  return SHIPPING_ZONES.INTL;
}

/**
 * Shipping cost for a parcel.
 * @param {{zone: object, grams: number, subtotal: number}} input
 * @returns {{cost:number, free:boolean, missingForFree:number}}
 */
export function shippingCost({ zone, grams, subtotal }) {
  if (subtotal >= zone.freeOver) {
    return { cost: 0, free: true, missingForFree: 0 };
  }
  const excessGrams = Math.max(0, grams - zone.baseGrams);
  // Excess is billed per started kilo — carriers round up, so we do too.
  const extraKilos = Math.ceil(excessGrams / 1000);
  return {
    cost: zone.base + extraKilos * zone.perKg,
    free: false,
    missingForFree: zone.freeOver - subtotal,
  };
}

/* --- Payment processing --------------------------------------------------- */

/** Stripe's standard European card pricing, the reference for margin maths. */
export const PAYMENT_FEE = { rate: 0.014, fixed: 25 };

export const paymentFee = (total, fee = PAYMENT_FEE) =>
  applyRate(total, fee.rate) + fee.fixed;

/* --- Unit economics ------------------------------------------------------- */

/**
 * Per-unit contribution margin — the number that decides whether a product is
 * worth listing. Deliberately pessimistic: it charges the full payment fee and
 * an allocated ad cost to every unit, because a margin computed before
 * acquisition cost is how dropshipping stores go broke while looking profitable.
 *
 * @param {{price:number, supplierCost:number, supplierShipping?:number, shippingCharged?:number, adCostPerOrder?:number, refundRate?:number, taxRate?:number}} input
 * @returns {{revenueNet:number, cogs:number, fees:number, adCost:number, refundReserve:number, margin:number, marginRate:number, markup:number, breakEvenRoas:number|null}}
 */
export function unitEconomics({
  price,
  supplierCost,
  supplierShipping = 0,
  shippingCharged = 0,
  adCostPerOrder = 0,
  refundRate = 0.02,
  taxRate = 0.21,
}) {
  const grossRevenue = price + shippingCharged;
  // VAT is collected on behalf of the state; it is never margin.
  const { net: revenueNet } = extractTax(grossRevenue, taxRate);

  const cogs = supplierCost + supplierShipping;
  const fees = paymentFee(grossRevenue);
  // Refunds cost the full COGS plus fees, and the goods rarely come back.
  const refundReserve = roundMinor((cogs + fees) * refundRate);

  const margin = revenueNet - cogs - fees - adCostPerOrder - refundReserve;

  return {
    revenueNet,
    cogs,
    fees,
    adCost: adCostPerOrder,
    refundReserve,
    margin,
    marginRate: revenueNet > 0 ? margin / revenueNet : 0,
    markup: cogs > 0 ? price / cogs : 0,
    // How many euros of revenue each euro of ad spend must return to break even.
    breakEvenRoas: margin + adCostPerOrder > 0 ? grossRevenue / (margin + adCostPerOrder) : null,
  };
}

/**
 * Suggested retail price for a target contribution margin, solved for `price`.
 * Iterates because the payment fee and the VAT extraction both depend on price.
 *
 * @param {{supplierCost:number, supplierShipping?:number, targetMarginRate?:number, taxRate?:number, adCostPerOrder?:number}} input
 * @returns {number} price in minor units, rounded to a charm-price ending
 */
export function suggestPrice({
  supplierCost,
  supplierShipping = 0,
  targetMarginRate = 0.45,
  taxRate = 0.21,
  adCostPerOrder = 0,
}) {
  let price = (supplierCost + supplierShipping + adCostPerOrder) * 3;

  // Fixed-point iteration; converges in a handful of passes.
  for (let i = 0; i < 24; i++) {
    const econ = unitEconomics({
      price: Math.round(price),
      supplierCost,
      supplierShipping,
      adCostPerOrder,
      taxRate,
    });
    const gap = targetMarginRate - econ.marginRate;
    if (Math.abs(gap) < 0.0005) break;
    price *= 1 + gap;
  }

  return charmPrice(Math.round(price));
}

/** Round up to the nearest .99 — standard retail psychology. */
export function charmPrice(minorUnits) {
  const euros = Math.ceil(minorUnits / 100);
  return euros * 100 - 1;
}

/** Discount off the compare-at price, as a whole percentage for badges. */
export function discountPercent(price, compareAt) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
