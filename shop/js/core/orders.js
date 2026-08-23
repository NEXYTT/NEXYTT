/**
 * Orders: creation, lifecycle, and supplier routing.
 *
 * A dropshipping order has two sides that must not be conflated:
 *   - the **customer order** (what was paid, where it ships), and
 *   - one **purchase order per supplier**, since a single cart routinely spans
 *     several suppliers and each ships its own parcel with its own tracking.
 *
 * `createOrder` freezes prices and supplier costs at purchase time. Catalogue
 * prices change; an order's history must not.
 */

/** Customer-facing lifecycle. Transitions are validated, not assumed. */
export const ORDER_STATUS = /** @type {const} */ ([
  "pending_payment",
  "paid",
  "routing",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const STATUS_LABEL = {
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  routing: "Enviando al proveedor",
  fulfilled: "Preparado por el proveedor",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

/** Allowed transitions. Anything not listed here is a bug, not a business case. */
const TRANSITIONS = {
  pending_payment: ["paid", "cancelled"],
  paid: ["routing", "cancelled", "refunded"],
  routing: ["fulfilled", "cancelled", "refunded"],
  fulfilled: ["shipped", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

/**
 * Customer-order status → the parcel status it implies for every purchase
 * order underneath it. Lives here, next to the lifecycle it mirrors, because
 * the tracking page, the order list and the back office all have to agree on
 * what "shipped" means for a parcel.
 */
export const PO_STATUS_ON = {
  fulfilled: "packed",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
};

/**
 * Patch that keeps every parcel's status in step with its order. Returns an
 * empty object for the statuses that say nothing about the parcels (a payment
 * does not pack a box), so it can be spread into `advanceOrder` unconditionally.
 */
export function purchaseOrderPatch(order, to) {
  const poStatus = PO_STATUS_ON[to];
  if (!poStatus || !order.purchaseOrders) return {};
  return { purchaseOrders: order.purchaseOrders.map((po) => ({ ...po, status: poStatus })) };
}

/**
 * Loose reference matching: a customer reading "NX-JXWK-ABCD" off an email
 * routinely types "nx jxwk abcd". Case and punctuation are dropped so both
 * resolve to the same order.
 */
export const normaliseReference = (raw) =>
  String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Human-readable order reference: NX-<base36 day>-<4 chars>.
 * Short enough to read over the phone, unique enough for a demo dataset.
 * @param {() => number} random injectable for deterministic tests
 */
export function orderReference(now = Date.now(), random = Math.random) {
  const day = Math.floor(now / 86400000).toString(36).toUpperCase();
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 — misread aloud
  let tail = "";
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(random() * alphabet.length)];
  return `NX-${day}-${tail}`;
}

/**
 * Build an order from a cart snapshot and a checkout form.
 *
 * @param {{snapshot: ReturnType<import('./cart.js').Cart['snapshot']>, customer: object, payment: object, now?: number, random?: () => number}} input
 * @returns {object} order
 */
export function createOrder({ snapshot, customer, payment, now = Date.now(), random = Math.random }) {
  if (!snapshot?.lines?.length) throw new Error("Cannot create an order from an empty cart");

  const { lines, totals } = snapshot;

  // Group lines by supplier: one purchase order per supplier, each with its own
  // cost basis and its own tracking number.
  const bySupplier = new Map();
  for (const line of lines) {
    if (!bySupplier.has(line.supplierId)) bySupplier.set(line.supplierId, []);
    bySupplier.get(line.supplierId).push(line);
  }

  const purchaseOrders = [...bySupplier.entries()].map(([supplierId, supplierLines], i) => ({
    id: `PO-${supplierId}-${(now + i).toString(36).toUpperCase()}`,
    supplierId,
    status: "queued",
    lines: supplierLines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      title: l.title,
      qty: l.qty,
      unitCost: l.supplierCost,
    })),
    cost: supplierLines.reduce((sum, l) => sum + l.supplierCost * l.qty, 0),
    trackingNumber: null,
    carrier: null,
  }));

  const goodsCost = purchaseOrders.reduce((sum, po) => sum + po.cost, 0);
  const processingFee = Math.round(totals.total * 0.014) + 25;
  const grossProfit = totals.net - goodsCost - processingFee;

  return {
    reference: orderReference(now, random),
    createdAt: now,
    status: "pending_payment",
    lines: structuredClone(lines),
    totals: structuredClone(totals),
    customer: {
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone ?? "",
      address: customer.address,
      city: customer.city,
      postalCode: customer.postalCode,
      country: customer.country,
      notes: customer.notes ?? "",
    },
    payment: {
      method: payment.method,
      // Never store a card number. Only the last four, exactly as a real
      // integration would: the PAN goes straight to the processor.
      last4: payment.last4 ?? null,
      brand: payment.brand ?? null,
      status: "authorised",
    },
    purchaseOrders,
    economics: {
      revenueGross: totals.total,
      revenueNet: totals.net,
      tax: totals.tax,
      goodsCost,
      processingFee,
      grossProfit,
      marginRate: totals.net > 0 ? grossProfit / totals.net : 0,
    },
    timeline: [{ at: now, status: "pending_payment", note: "Pedido creado" }],
    // Delivery window from the shipping zone, not a made-up promise.
    eta: {
      minDays: totals.zone.etaDays[0],
      maxDays: totals.zone.etaDays[1],
      minAt: now + totals.zone.etaDays[0] * 86400000,
      maxAt: now + totals.zone.etaDays[1] * 86400000,
    },
  };
}

/**
 * Move an order to a new status, appending to its timeline.
 * @returns {object} a new order object (does not mutate the input)
 */
export function advanceOrder(order, to, { note = "", at = Date.now(), patch = {} } = {}) {
  if (!canTransition(order.status, to)) {
    throw new Error(`Invalid transition: ${order.status} → ${to}`);
  }
  return {
    ...order,
    ...patch,
    status: to,
    timeline: [...order.timeline, { at, status: to, note: note || STATUS_LABEL[to] }],
  };
}

/**
 * Simulated fulfilment: assigns carriers and tracking numbers to each PO.
 * Stands in for the supplier API call a live integration would make.
 */
export function routeToSuppliers(order, { at = Date.now(), random = Math.random } = {}) {
  const carriers = ["Correos Express", "SEUR", "GLS", "DHL Parcel", "Cainiao"];
  const purchaseOrders = order.purchaseOrders.map((po, i) => ({
    ...po,
    status: "accepted",
    carrier: carriers[Math.floor(random() * carriers.length)],
    trackingNumber: `${po.supplierId.toUpperCase()}${String(Math.floor(random() * 1e9)).padStart(9, "0")}${i}`,
  }));

  return advanceOrder(order, "routing", {
    at,
    note: `Enviado a ${purchaseOrders.length} proveedor(es)`,
    patch: { purchaseOrders },
  });
}

/** Aggregate P&L across a set of orders, for the back office. */
export function aggregateEconomics(orders) {
  const live = orders.filter((o) => o.status !== "cancelled" && o.status !== "refunded");

  const sum = (fn) => live.reduce((acc, o) => acc + fn(o), 0);
  const revenueGross = sum((o) => o.economics.revenueGross);
  const revenueNet = sum((o) => o.economics.revenueNet);
  const grossProfit = sum((o) => o.economics.grossProfit);

  return {
    orders: live.length,
    cancelled: orders.length - live.length,
    revenueGross,
    revenueNet,
    goodsCost: sum((o) => o.economics.goodsCost),
    processingFees: sum((o) => o.economics.processingFee),
    tax: sum((o) => o.economics.tax),
    grossProfit,
    marginRate: revenueNet > 0 ? grossProfit / revenueNet : 0,
    averageOrderValue: live.length ? Math.round(revenueGross / live.length) : 0,
    units: sum((o) => o.lines.reduce((n, l) => n + l.qty, 0)),
  };
}
