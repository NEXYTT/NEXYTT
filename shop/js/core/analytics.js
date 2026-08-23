/**
 * Back-office analytics: the numbers that decide whether the shop is a
 * business or a hobby.
 *
 * Everything here is pure — no DOM, no storage, no clock — so the same code
 * runs under `node --test` and inside the admin panel. Money stays in integer
 * minor units end to end; rates stay as plain 0–1 fractions and are only
 * turned into "%" at the display boundary.
 *
 * The three ideas this module is built around:
 *
 *   1. **Margin before acquisition cost is a lie.** Every figure charges the
 *      allocated ad cost per order, because a catalogue that looks 60%
 *      profitable at 0 € CAC is what a dead dropshipping store looks like
 *      the day before it dies.
 *   2. **The supplier is the product.** Lead time and defect rate move the
 *      P&L more than the listing price does, so supplier risk is scored
 *      explicitly instead of living in someone's head.
 *   3. **Every line of the simulated P&L must add up.** `simulateMonth`
 *      returns the arithmetic identity it satisfies, and it is asserted.
 */

import { money } from "../../../assets/js/format.js";
import { unitEconomics, suggestPrice, paymentFee, extractTax, roundMinor } from "./pricing.js";
import { categoryLabel } from "../../data/products.js";

/* --- Defaults --------------------------------------------------------------
 *
 * Named, not magic. Anything that could be argued about is a constant with a
 * reason attached.
 */

/**
 * Blended cost to acquire one order. 6 € is what a mixed Meta + organic funnel
 * costs for a sub-50 € impulse product in Spain — roughly 17% of this
 * catalogue's average order value. Pure cold paid traffic runs 8–12 €, which is
 * exactly why the panel lets you drag this number and watch the catalogue turn red.
 */
export const DEFAULT_CAC = 600;

/**
 * Contribution margin we underwrite the catalogue at, measured on net revenue
 * and **after** acquisition cost. 30% is the level at which the shop survives a
 * supplier price rise or a bad quarter; the 45–60% figures quoted in
 * dropshipping courses are gross margins with the ad spend left out.
 */
export const DEFAULT_TARGET_MARGIN = 0.3;

/** Share of orders that end in a refund. 2% is the floor for a China-shipped catalogue; 5%+ means a supplier problem. */
export const DEFAULT_REFUND_RATE = 0.02;

/** Spanish VAT. Retail prices in this store are gross, so tax is extracted, never added. */
export const DEFAULT_TAX_RATE = 0.21;

/* --- Product verdict -------------------------------------------------------
 *
 * The verdict is a policy, and a policy has to be written down or it becomes
 * whoever-shouts-loudest. These are the thresholds; every one is used exactly
 * once, in `verdictFor`, and every one is explained in the UI.
 */
export const VERDICT_CRITERIA = {
  /**
   * Absolute contribution floor, in cents. Under 3 € per order a single
   * customer-service email or a partial refund wipes out the order, and the
   * percentage margin stops meaning anything.
   */
  minAbsoluteMargin: 300,

  /**
   * Fraction of the target margin under which a product is not worth keeping.
   * At less than 45% of target, closing the gap would need a price rise big
   * enough to kill the conversion rate that justified the listing.
   */
  retireFraction: 0.45,

  /**
   * Break-even ROAS above which paid acquisition stops being realistic.
   * Cold-traffic ROAS on Meta for this basket size lands between 1.8 and 3.0;
   * a product that needs more than 3.0 can only survive on organic traffic.
   */
  scaleRoasCeiling: 3.0,

  /** Above this break-even ROAS no channel can feed the product at all. */
  retireRoasCeiling: 5.0,
};

export const VERDICT_LABEL = {
  escalar: "Escalar",
  vigilar: "Vigilar",
  retirar: "Retirar",
};

/** Badge tone per verdict, so every surface colours them the same way. */
export const VERDICT_TONE = {
  escalar: "badge--win",
  vigilar: "badge--warn",
  retirar: "badge--loss",
};

export const VERDICT_RULE_TEXT = {
  escalar:
    `Cumple el margen objetivo, deja al menos ${money(VERDICT_CRITERIA.minAbsoluteMargin)} por pedido ` +
    `y su ROAS de equilibrio no pasa de ${VERDICT_CRITERIA.scaleRoasCeiling.toFixed(1)}×.`,
  vigilar:
    "Gana dinero, pero se queda por debajo del objetivo o necesita un ROAS incómodo. Sube precio, negocia coste o quítalo de la campaña.",
  retirar:
    `Pierde dinero por pedido, se queda por debajo del ${Math.round(VERDICT_CRITERIA.retireFraction * 100)}% ` +
    `del margen objetivo, o exige un ROAS mayor de ${VERDICT_CRITERIA.retireRoasCeiling.toFixed(1)}×, que ningún canal da.`,
};

/**
 * Apply the verdict policy to one set of unit economics.
 *
 * Evaluated worst-case first: a single disqualifying condition is enough to
 * retire a product, no matter how good the rest of its numbers look.
 *
 * @param {{margin:number, marginRate:number, breakEvenRoas:number|null}} econ
 * @param {number} targetMargin target contribution margin as a rate (0.45 = 45%)
 * @returns {{verdict:'escalar'|'vigilar'|'retirar', reasons:{code:string, text:string, tone:'win'|'warn'|'loss'}[]}}
 */
export function verdictFor(econ, targetMargin = DEFAULT_TARGET_MARGIN) {
  const { margin, marginRate, breakEvenRoas } = econ;
  const reasons = [];
  const C = VERDICT_CRITERIA;

  // `breakEvenRoas` is null when the order cannot cover its own ad spend at
  // any volume — pricing.js returns null rather than dividing by zero.
  const roasUnreachable = breakEvenRoas === null || breakEvenRoas > C.retireRoasCeiling;

  if (margin <= 0) {
    reasons.push({ code: "negativo", text: "Margen negativo: cada pedido cuesta dinero.", tone: "loss" });
  }
  if (marginRate < targetMargin * C.retireFraction) {
    reasons.push({
      code: "muy-lejos",
      text: `Margen por debajo del ${Math.round(C.retireFraction * 100)}% del objetivo.`,
      tone: "loss",
    });
  }
  if (roasUnreachable) {
    reasons.push({
      code: "roas-imposible",
      text: `Necesita un ROAS mayor de ${C.retireRoasCeiling.toFixed(1)}×.`,
      tone: "loss",
    });
  }

  if (reasons.length) return { verdict: "retirar", reasons };

  const meetsTarget = marginRate >= targetMargin;
  const meetsFloor = margin >= C.minAbsoluteMargin;
  const roasComfortable = breakEvenRoas <= C.scaleRoasCeiling;

  if (meetsTarget && meetsFloor && roasComfortable) {
    return {
      verdict: "escalar",
      reasons: [
        { code: "objetivo", text: "Cumple el margen objetivo con el CAC actual.", tone: "win" },
        { code: "roas", text: `ROAS de equilibrio ${breakEvenRoas.toFixed(2)}×, alcanzable en frío.`, tone: "win" },
      ],
    };
  }

  if (!meetsTarget) {
    reasons.push({ code: "bajo-objetivo", text: "Por debajo del margen objetivo.", tone: "warn" });
  }
  if (!meetsFloor) {
    reasons.push({
      code: "suelo",
      text: `Menos de ${money(C.minAbsoluteMargin)} de contribución por pedido.`,
      tone: "warn",
    });
  }
  if (!roasComfortable) {
    reasons.push({
      code: "roas-alto",
      text: `ROAS de equilibrio ${breakEvenRoas.toFixed(2)}×, por encima de ${C.scaleRoasCeiling.toFixed(1)}×.`,
      tone: "warn",
    });
  }

  return { verdict: "vigilar", reasons };
}

/**
 * Full economic picture of one catalogue product, plus the verdict.
 *
 * Shipping revenue is deliberately zero: the store comps shipping above the
 * free-shipping threshold and most orders clear it, so counting shipping as
 * income would flatter the margin. Supplier shipping is still charged as cost.
 *
 * @param {object} product a catalogue entry
 * @param {{adCostPerOrder?:number, targetMargin?:number, taxRate?:number, refundRate?:number}} [opts]
 */
export function productScorecard(product, opts = {}) {
  const {
    adCostPerOrder = DEFAULT_CAC,
    targetMargin = DEFAULT_TARGET_MARGIN,
    taxRate = DEFAULT_TAX_RATE,
    refundRate = DEFAULT_REFUND_RATE,
  } = opts;

  const econ = unitEconomics({
    price: product.price,
    supplierCost: product.supplierCost,
    supplierShipping: product.supplierShipping ?? 0,
    shippingCharged: 0,
    adCostPerOrder,
    refundRate,
    taxRate,
  });

  const { verdict, reasons } = verdictFor(econ, targetMargin);

  // The price that would hit the target at this CAC. `charm: true` rounds up to
  // the next .99, so the suggestion never lands under the target.
  const suggested = suggestPrice({
    supplierCost: product.supplierCost,
    supplierShipping: product.supplierShipping ?? 0,
    targetMarginRate: targetMargin,
    taxRate,
    adCostPerOrder,
  });

  return {
    productId: product.id,
    title: product.title,
    brand: product.brand,
    slug: product.slug,
    category: product.category,
    categoryLabel: categoryLabel(product.category),
    supplierId: product.supplierId,
    price: product.price,
    supplierCost: product.supplierCost,
    supplierShipping: product.supplierShipping ?? 0,
    stock: product.stock,
    landedCost: product.supplierCost + (product.supplierShipping ?? 0),
    ...econ,
    targetMargin,
    adCostPerOrder,
    suggestedPrice: suggested,
    // Positive gap = we are charging more than the target needs (headroom).
    priceGap: product.price - suggested,
    priceGapRate: suggested > 0 ? (product.price - suggested) / suggested : 0,
    verdict,
    reasons,
  };
}

/* --- Supplier risk ---------------------------------------------------------
 *
 * Composite risk on 0–1, from the three things that actually generate refunds
 * and chargebacks. Each raw rate is normalised against a *ceiling* — the value
 * at which that dimension alone makes the supplier unusable — then weighted.
 * Normalised values are clamped, so one catastrophic dimension saturates but
 * cannot push the total above 1.
 */
export const RISK_MODEL = {
  ceilings: {
    /** 5% defective units: at that level the refund budget eats the whole margin. */
    defectRate: 0.05,
    /** 3% opened disputes: the level at which a payment processor starts asking questions. */
    disputeRate: 0.03,
    /** 25 days to deliver: past this the customer has forgotten they ordered and disputes on sight. */
    leadTimeDays: 25,
  },
  /** Lead time under this many days carries no risk at all — that is a local warehouse. */
  leadTimeFloor: 3,
  /**
   * Weights sum to 1. Defects lead because a broken unit costs the goods *and*
   * the refund *and* the review; a slow parcel usually only costs patience.
   */
  weights: { defectRate: 0.4, disputeRate: 0.35, leadTime: 0.25 },
  /** Band cuts on the 0–1 composite. */
  bands: [
    { max: 0.25, id: "bajo", label: "Riesgo bajo", tone: "badge--win" },
    { max: 0.5, id: "medio", label: "Riesgo medio", tone: "badge--warn" },
    { max: Infinity, id: "alto", label: "Riesgo alto", tone: "badge--loss" },
  ],
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));

export const riskBand = (risk) => RISK_MODEL.bands.find((b) => risk < b.max) ?? RISK_MODEL.bands.at(-1);

/**
 * Products bought from a supplier, what they cost us, how long they take and
 * how likely they are to go wrong.
 *
 * @param {object} supplier entry from `data/suppliers.js`
 * @param {object[]} products the whole catalogue; filtered here
 * @param {{adCostPerOrder?:number, targetMargin?:number}} [opts]
 */
export function supplierScorecard(supplier, products, opts = {}) {
  const mine = products.filter((p) => p.supplierId === supplier.id);
  const cards = mine.map((p) => productScorecard(p, opts));

  const sum = (fn) => cards.reduce((acc, c) => acc + fn(c), 0);
  const totalCost = sum((c) => c.landedCost);
  const totalRetail = sum((c) => c.price);
  const totalMargin = sum((c) => c.margin);
  const revenueNet = sum((c) => c.revenueNet);

  const [minLead, maxLead] = supplier.leadTimeDays;
  const avgLead = (minLead + maxLead) / 2;

  const { ceilings, weights, leadTimeFloor } = RISK_MODEL;
  const factors = {
    defectRate: clamp01(supplier.defectRate / ceilings.defectRate),
    disputeRate: clamp01(supplier.disputeRate / ceilings.disputeRate),
    // Judged on the *worst* case, not the average: the customer who waits the
    // longest is the one who opens the dispute.
    leadTime: clamp01((maxLead - leadTimeFloor) / (ceilings.leadTimeDays - leadTimeFloor)),
  };

  const risk =
    factors.defectRate * weights.defectRate +
    factors.disputeRate * weights.disputeRate +
    factors.leadTime * weights.leadTime;

  const band = riskBand(risk);

  // Stock we hold from this supplier, valued at what we pay for it: the money
  // actually exposed if they go dark.
  const stockUnits = mine.reduce((n, p) => n + p.stock, 0);
  const stockAtCost = mine.reduce((n, p) => n + p.stock * (p.supplierCost + (p.supplierShipping ?? 0)), 0);

  return {
    supplier,
    supplierId: supplier.id,
    name: supplier.name,
    products: cards,
    productCount: cards.length,
    totalCost,
    totalRetail,
    totalMargin,
    avgUnitCost: cards.length ? Math.round(totalCost / cards.length) : 0,
    avgPrice: cards.length ? Math.round(totalRetail / cards.length) : 0,
    avgMarginRate: revenueNet > 0 ? totalMargin / revenueNet : 0,
    stockUnits,
    stockAtCost,
    leadTimeDays: supplier.leadTimeDays,
    avgLeadDays: avgLead,
    maxLeadDays: maxLead,
    defectRate: supplier.defectRate,
    disputeRate: supplier.disputeRate,
    risk,
    riskScore: Math.round(risk * 100),
    riskFactors: factors,
    band,
    verdicts: countVerdicts(cards),
  };
}

const countVerdicts = (cards) =>
  cards.reduce(
    (acc, c) => ({ ...acc, [c.verdict]: acc[c.verdict] + 1 }),
    { escalar: 0, vigilar: 0, retirar: 0 }
  );

/* --- Catalogue summary ---------------------------------------------------- */

/** Median of a numeric array; average of the two middle values on even length. */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Totals and averages across the whole catalogue, plus the category and
 * supplier breakdowns the summary tab charts.
 *
 * `avgMarginRate` is the *weighted* rate (total margin ÷ total net revenue),
 * not the mean of the per-product rates: a mean would let a 3 € keyring with a
 * 70% margin outvote a 60 € pair of headphones. The unweighted mean is exposed
 * separately as `meanMarginRate` for when that is what you actually want.
 *
 * @param {object[]} products
 * @param {{adCostPerOrder?:number, targetMargin?:number, topCount?:number}} [opts]
 */
export function catalogSummary(products, opts = {}) {
  const { topCount = 5 } = opts;
  const cards = products.map((p) => productScorecard(p, opts));

  const sum = (fn) => cards.reduce((acc, c) => acc + fn(c), 0);
  const retailValue = sum((c) => c.price);
  const catalogCost = sum((c) => c.landedCost);
  const totalMargin = sum((c) => c.margin);
  const revenueNet = sum((c) => c.revenueNet);

  const byMargin = [...cards].sort((a, b) => b.marginRate - a.marginRate);

  // Category rollup. `retail` is the sum of list prices, i.e. the revenue one
  // unit of every product in the category would bring in — a shape indicator,
  // not a forecast. The simulator is where forecasts live.
  const categories = new Map();
  for (const card of cards) {
    const bucket = categories.get(card.category) ?? {
      id: card.category,
      label: card.categoryLabel,
      count: 0,
      retail: 0,
      cost: 0,
      margin: 0,
      revenueNet: 0,
    };
    bucket.count++;
    bucket.retail += card.price;
    bucket.cost += card.landedCost;
    bucket.margin += card.margin;
    bucket.revenueNet += card.revenueNet;
    categories.set(card.category, bucket);
  }

  const byCategory = [...categories.values()]
    .map((c) => ({
      ...c,
      marginRate: c.revenueNet > 0 ? c.margin / c.revenueNet : 0,
      share: retailValue > 0 ? c.retail / retailValue : 0,
    }))
    .sort((a, b) => b.retail - a.retail);

  return {
    count: cards.length,
    supplierCount: new Set(cards.map((c) => c.supplierId)).size,
    categoryCount: byCategory.length,
    retailValue,
    catalogCost,
    totalMargin,
    revenueNet,
    avgPrice: cards.length ? Math.round(retailValue / cards.length) : 0,
    avgCost: cards.length ? Math.round(catalogCost / cards.length) : 0,
    avgMargin: cards.length ? Math.round(totalMargin / cards.length) : 0,
    avgMarginRate: revenueNet > 0 ? totalMargin / revenueNet : 0,
    meanMarginRate: cards.length ? cards.reduce((a, c) => a + c.marginRate, 0) / cards.length : 0,
    medianMarginRate: median(cards.map((c) => c.marginRate)),
    avgMarkup: cards.length ? cards.reduce((a, c) => a + c.markup, 0) / cards.length : 0,
    stockUnits: products.reduce((n, p) => n + p.stock, 0),
    stockAtCost: cards.reduce((n, c) => n + c.stock * c.landedCost, 0),
    stockAtRetail: cards.reduce((n, c) => n + c.stock * c.price, 0),
    verdicts: countVerdicts(cards),
    best: byMargin.slice(0, topCount),
    worst: byMargin.slice(-topCount).reverse(),
    byCategory,
    cards,
  };
}

/* --- Monthly simulation ---------------------------------------------------- */

/**
 * Demand mixes. A simulation is only as good as its assumption about *which*
 * products sell, so the assumption is a first-class, switchable input instead
 * of a hidden average.
 *
 * `weight` returns a relative share; the allocator normalises it.
 */
export const MIX_PRESETS = {
  ventas: {
    id: "ventas",
    label: "Como se vende hoy",
    hint: "Reparte por número de reseñas, con doble peso a los top ventas. Es el proxy de demanda real más honesto que tenemos.",
    weight: (p) => p.reviewCount * (p.bestseller ? 2 : 1),
  },
  uniforme: {
    id: "uniforme",
    label: "Uniforme",
    hint: "El mismo número de pedidos para cada referencia. Sirve para ver el margen medio del catálogo sin que lo dominen tres productos.",
    weight: () => 1,
  },
  margen: {
    id: "margen",
    label: "Sesgado a margen",
    hint: "Solo se promocionan los productos con contribución positiva, en proporción a ella. Es el escenario 'si la campaña estuviera bien montada'.",
    weight: (p, econ) => Math.max(0, econ.margin),
  },
  stock: {
    id: "stock",
    label: "Según stock",
    hint: "Reparte por unidades disponibles: lo que podríamos servir hoy sin romper stock.",
    weight: (p) => p.stock,
  },
};

/**
 * Split `total` whole units across `weights` by the largest-remainder method,
 * so the parts sum to exactly `total`. Rounding each share independently would
 * lose or invent orders, and the P&L identity would stop holding.
 */
function allocate(total, weights) {
  const zeros = weights.map(() => 0);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || weightSum <= 0) return zeros;

  const exact = weights.map((w) => (w / weightSum) * total);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);

  const byRemainder = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < byRemainder.length; k++, left--) counts[byRemainder[k].i]++;
  return counts;
}

/**
 * A month of trading, line by line.
 *
 * Assumptions, all deliberate and all visible in the UI:
 *  - **One unit per order.** Basket size above 1 would need a co-purchase
 *    model; inventing one would make the output look precise and be fiction.
 *  - **Shipping is comped.** Gross revenue is the list price. Supplier
 *    shipping is charged as cost, so the simulation is on the pessimistic side.
 *  - **Refunds cancel the net revenue only.** The goods and the payment fee of
 *    a refunded order are *not* recovered — the parcel is in China and Stripe
 *    keeps its fee — so they stay in their own lines above. Charging them again
 *    in the refund line would double-count them.
 *
 * The identity that must hold, and that `check` verifies:
 *
 *   revenueGross − tax = revenueNet
 *   revenueNet − cogs − fees − adSpend − refundLoss = profit
 *
 * @param {object[]} products
 * @param {{orders?:number, adSpend?:number, refundRate?:number, mix?:string|Function|Array, taxRate?:number, targetMargin?:number}} [opts]
 */
export function simulateMonth(products, opts = {}) {
  const {
    orders = 0,
    adSpend = 0,
    refundRate = DEFAULT_REFUND_RATE,
    mix = "ventas",
    taxRate = DEFAULT_TAX_RATE,
    targetMargin = DEFAULT_TARGET_MARGIN,
  } = opts;

  const orderCount = Math.max(0, Math.round(orders));
  const spend = Math.max(0, Math.round(adSpend));

  // Ad cost per order feeds the per-product economics, so `byProduct` verdicts
  // reflect the campaign being simulated, not a stale global setting.
  const adCostPerOrder = orderCount > 0 ? Math.round(spend / orderCount) : 0;

  const weightOf = resolveMix(mix, { adCostPerOrder, targetMargin, taxRate, refundRate });
  let weights = products.map((p) => Math.max(0, weightOf(p)));

  // A mix can legitimately weight everything at zero — "sesgado a margen" does
  // exactly that once the CAC exceeds every product's contribution. Allocating
  // nothing would then report N orders and zero revenue, which is not a
  // pessimistic forecast but a wrong one. Fall back to uniform and say so.
  const mixCollapsed = orderCount > 0 && weights.every((w) => w === 0);
  if (mixCollapsed) weights = products.map(() => 1);

  const counts = allocate(orderCount, weights);

  let revenueGross = 0;
  let tax = 0;
  let cogs = 0;
  let fees = 0;

  const byProduct = products.map((product, i) => {
    const n = counts[i];
    // Tax and fee are computed per unit and multiplied, never on the total:
    // `netUnit + taxUnit === price` exactly, so `revenueNet + tax` can never
    // drift a cent away from `revenueGross` however many units there are.
    const { net: netUnit, tax: taxUnit } = extractTax(product.price, taxRate);
    const costUnit = product.supplierCost + (product.supplierShipping ?? 0);
    const feeUnit = paymentFee(product.price);

    const line = {
      product,
      orders: n,
      revenueGross: product.price * n,
      revenueNet: netUnit * n,
      tax: taxUnit * n,
      cogs: costUnit * n,
      fees: feeUnit * n,
    };
    // Contribution before advertising: what the order leaves on the table to
    // pay for the traffic that produced it.
    line.contribution = line.revenueNet - line.cogs - line.fees;

    revenueGross += line.revenueGross;
    tax += line.tax;
    cogs += line.cogs;
    fees += line.fees;
    return line;
  });

  const revenueNet = revenueGross - tax;
  const refundLoss = roundMinor(revenueNet * refundRate);
  const refundedOrders = Math.round(orderCount * refundRate);

  const profit = revenueNet - cogs - fees - spend - refundLoss;

  const averageOrderValue = orderCount ? Math.round(revenueGross / orderCount) : 0;
  // Contribution per order *after* refunds but *before* advertising: the euros
  // each order can spend on acquisition. This is the break-even denominator.
  const contributionPerOrder = orderCount
    ? (revenueNet - cogs - fees - refundLoss) / orderCount
    : 0;

  const breakEvenOrders = contributionPerOrder > 0 ? Math.ceil(spend / contributionPerOrder) : null;
  // profit = n·c − A = 0 ⇒ n = A/c ⇒ revenue = A·aov/c ⇒ ROAS = aov/c.
  const breakEvenRoas = contributionPerOrder > 0 ? averageOrderValue / contributionPerOrder : null;

  const lines = [
    {
      id: "revenueGross",
      label: "Ingresos brutos",
      amount: revenueGross,
      kind: "income",
      formula: "Σ precio de venta × pedidos",
      note: "Precio de tarifa, IVA incluido. El envío va comprado por nosotros, no facturado al cliente.",
    },
    {
      id: "tax",
      label: "IVA repercutido",
      amount: -tax,
      kind: "cost",
      formula: `bruto − bruto ÷ ${(1 + taxRate).toFixed(2)}`,
      note: "Se recauda para Hacienda. Nunca ha sido nuestro, así que sale antes de cualquier otra línea.",
    },
    {
      id: "revenueNet",
      label: "Ingresos netos",
      amount: revenueNet,
      kind: "subtotal",
      formula: "brutos − IVA",
      note: "La única cifra de ingresos sobre la que se puede calcular un margen.",
    },
    {
      id: "cogs",
      label: "Coste de mercancía",
      amount: -cogs,
      kind: "cost",
      formula: "Σ (coste proveedor + envío proveedor) × pedidos",
      note: "Lo que pagamos al proveedor, puerta a puerta. Incluye los pedidos que acabarán reembolsados: esa mercancía no vuelve.",
    },
    {
      id: "fees",
      label: "Comisiones de pago",
      amount: -fees,
      kind: "cost",
      formula: "Σ (1,4% del bruto + 0,25 €) × pedidos",
      note: "Tarifa de tarjeta europea. La parte fija pesa mucho en el ticket bajo.",
    },
    {
      id: "adSpend",
      label: "Publicidad",
      amount: -spend,
      kind: "cost",
      formula: "gasto mensual introducido",
      note: `Equivale a ${money(adCostPerOrder)} de CAC por pedido.`,
    },
    {
      id: "refundLoss",
      label: "Reembolsos",
      amount: -refundLoss,
      kind: "cost",
      formula: `ingresos netos × ${(refundRate * 100).toFixed(1)}%`,
      note: "Solo anula el ingreso. La mercancía y la comisión de esos pedidos siguen contadas arriba porque no se recuperan.",
    },
    {
      id: "profit",
      label: "Beneficio del mes",
      amount: profit,
      kind: "total",
      formula: "netos − mercancía − comisiones − publicidad − reembolsos",
      note: "Antes de estructura fija (herramientas, dominio, tu tiempo).",
    },
  ];

  // Self-check, asserted by the test suite: the cost lines plus the income
  // lines have to land exactly on the profit line, with no rounding slack.
  const summed = lines
    .filter((l) => l.kind === "income" || l.kind === "cost")
    .reduce((acc, l) => acc + l.amount, 0);

  return {
    orders: orderCount,
    units: orderCount, // one unit per order, by assumption
    adSpend: spend,
    adCostPerOrder,
    refundRate,
    refundedOrders,
    mix: typeof mix === "string" ? mix : "personalizado",
    mixCollapsed,
    revenueGross,
    tax,
    revenueNet,
    cogs,
    fees,
    refundLoss,
    profit,
    marginRate: revenueNet > 0 ? profit / revenueNet : 0,
    grossMarginRate: revenueNet > 0 ? (revenueNet - cogs) / revenueNet : 0,
    averageOrderValue,
    contributionPerOrder,
    profitPerOrder: orderCount ? profit / orderCount : 0,
    /** The most we could pay for an order before it stops making money. */
    maxCacPerOrder: Math.floor(Math.max(0, contributionPerOrder)),
    breakEvenOrders,
    breakEvenRoas,
    roas: spend > 0 ? revenueGross / spend : null,
    lines,
    byProduct: byProduct.filter((l) => l.orders > 0).sort((a, b) => b.revenueGross - a.revenueGross),
    check: { balanced: summed === profit, delta: summed - profit },
  };
}

/** Turn a mix id, a weight function or an explicit `[{productId, weight}]` list into `(product) => number`. */
function resolveMix(mix, econOpts) {
  if (typeof mix === "function") return (p) => mix(p, unitEconomicsFor(p, econOpts));

  if (Array.isArray(mix)) {
    const table = new Map(mix.map((entry) => [entry.productId, entry.weight]));
    return (p) => table.get(p.id) ?? 0;
  }

  const preset = MIX_PRESETS[mix] ?? MIX_PRESETS.ventas;
  return (p) => preset.weight(p, unitEconomicsFor(p, econOpts));
}

const unitEconomicsFor = (product, { adCostPerOrder, taxRate, refundRate }) =>
  unitEconomics({
    price: product.price,
    supplierCost: product.supplierCost,
    supplierShipping: product.supplierShipping ?? 0,
    adCostPerOrder,
    taxRate,
    refundRate,
  });

/* --- Revenue attribution from real orders --------------------------------- */

/**
 * Revenue per category from the real order book, for the summary chart.
 * Cancelled and refunded orders are excluded, matching `aggregateEconomics`,
 * so the chart and the KPI row can never tell different stories.
 */
export function revenueByCategory(orders, products) {
  const catalogue = new Map(products.map((p) => [p.id, p]));
  const buckets = new Map();

  for (const order of orders) {
    if (order.status === "cancelled" || order.status === "refunded") continue;
    for (const line of order.lines) {
      const product = catalogue.get(line.productId);
      const id = product?.category ?? "otros";
      const bucket = buckets.get(id) ?? { id, label: categoryLabel(id), revenue: 0, units: 0 };
      bucket.revenue += line.unitPrice * line.qty;
      bucket.units += line.qty;
      buckets.set(id, bucket);
    }
  }

  const total = [...buckets.values()].reduce((a, b) => a + b.revenue, 0);
  return [...buckets.values()]
    .map((b) => ({ ...b, share: total > 0 ? b.revenue / total : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* --- CSV -------------------------------------------------------------------
 *
 * RFC 4180 with one deliberate liberty: numbers and booleans round-trip as
 * numbers and booleans instead of strings, so `parseCsv(toCsv(rows))` deep-
 * equals `rows`. A value is only coerced when its own text is the canonical
 * form of the coerced value (`String(Number(v)) === v`), which keeps "0034",
 * "1e3" and "+7" as the strings they were written as.
 */

const NEEDS_QUOTE = /[",\r\n]|^\s|\s$/;

const escapeField = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return NEEDS_QUOTE.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Serialise an array of flat objects to CSV with a header row.
 * Columns are the union of every row's keys, in first-seen order, so a row
 * missing a field yields an empty cell rather than shifting the table.
 *
 * @param {Record<string, unknown>[]} rows
 * @param {{columns?: string[], eol?: string}} [opts]
 */
export function toCsv(rows, { columns, eol = "\n" } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const header = columns ?? [...new Set(list.flatMap((row) => Object.keys(row ?? {})))];
  if (!header.length) return "";

  const body = list.map((row) => header.map((key) => escapeField(row?.[key])).join(","));
  return [header.map(escapeField).join(","), ...body].join(eol);
}

/** `true` when the text is exactly how JS would print the number it parses to. */
const isCanonicalNumber = (text) => text !== "" && String(Number(text)) === text;

function coerce(text) {
  if (text === "true") return true;
  if (text === "false") return false;
  return isCanonicalNumber(text) ? Number(text) : text;
}

/**
 * Parse CSV into an array of objects keyed by the header row.
 * Handles quoted fields containing commas, quotes and newlines, and accepts
 * CRLF, LF or CR line endings.
 *
 * @param {string} text
 * @returns {Record<string, string|number|boolean>[]}
 */
export function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((key, i) => [key, coerce(cells[i] ?? "")]))
  );
}

/** The state machine. Split out because quoting is the only genuinely fiddly part. */
function parseCsvRows(text) {
  const source = String(text ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let started = false; // distinguishes a trailing newline from a trailing empty row

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      endField();
      started = true;
    } else if (ch === "\r") {
      if (source[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
      started = true;
    }
  }

  if (started || field !== "" || row.length) endRow();
  return rows;
}

/* --- Catalogue import / export -------------------------------------------- */

/** Columns of the catalogue export. Money stays in cents: the file is a working document, not a report. */
export const CATALOG_COLUMNS = [
  "id",
  "slug",
  "title",
  "brand",
  "category",
  "supplierId",
  "price",
  "compareAt",
  "supplierCost",
  "supplierShipping",
  "grams",
  "stock",
];

/** Fields the importer is allowed to change. Everything else in the file is read-only context. */
export const EDITABLE_COLUMNS = ["price", "compareAt", "supplierCost", "supplierShipping"];

/** @param {object[]} products @returns {Record<string, unknown>[]} one flat row per product */
export const catalogRows = (products) =>
  products.map((p) =>
    Object.fromEntries(CATALOG_COLUMNS.map((key) => [key, p[key] ?? (key === "compareAt" ? 0 : "")]))
  );

/**
 * Apply an imported CSV back onto the catalogue.
 *
 * Matches on `id` only — titles and slugs are editable text and make terrible
 * keys. Returns a *new* product array; nothing is mutated, so a rejected import
 * leaves the caller's catalogue exactly as it was.
 *
 * @param {object[]} products
 * @param {Record<string, unknown>[]} rows output of `parseCsv`
 * @returns {{products:object[], changes:{id:string,title:string,field:string,from:number,to:number}[], unknown:string[], invalid:{id:string,field:string,value:unknown}[]}}
 */
export function applyCatalogRows(products, rows) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const patches = new Map();
  const changes = [];
  const unknown = [];
  const invalid = [];

  for (const row of rows ?? []) {
    const id = String(row?.id ?? "");
    const product = byId.get(id);
    if (!product) {
      if (id) unknown.push(id);
      continue;
    }

    for (const field of EDITABLE_COLUMNS) {
      if (!(field in row)) continue;
      const value = row[field];
      // Cents are integers. A decimal here means someone typed euros into a
      // cents column, and silently rounding it would move a real price.
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        invalid.push({ id, field, value });
        continue;
      }
      if (field === "price" && value === 0) {
        invalid.push({ id, field, value });
        continue;
      }
      const from = product[field] ?? 0;
      if (from === value) continue;

      const patch = patches.get(id) ?? {};
      patch[field] = value;
      patches.set(id, patch);
      changes.push({ id, title: product.title, field, from, to: value });
    }
  }

  return {
    products: products.map((p) => (patches.has(p.id) ? { ...p, ...patches.get(p.id) } : p)),
    changes,
    unknown,
    invalid,
  };
}
