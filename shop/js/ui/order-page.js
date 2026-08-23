/**
 * Order confirmation and tracking.
 *
 * One page covers the two moments a customer looks up an order: the seconds
 * after paying, and every anxious check afterwards. Both need the same data, so
 * there is a single view driven by `?ref=`.
 *
 * Three decisions worth stating:
 *
 *  1. **The page reads the order, it never recomputes it.** Prices, VAT and the
 *     delivery window were frozen by `createOrder` at purchase time. A tracking
 *     page that recalculates the total from today's catalogue is how a customer
 *     ends up seeing a figure that does not match their bank statement.
 *  2. **Shipments are per supplier, not per order.** In dropshipping a cart
 *     routinely spans several warehouses, so a purchase order is the unit that
 *     actually has a carrier and a tracking number. The customer is told why.
 *  3. **The status simulator is a demo affordance, labelled as such.** It goes
 *     through `advanceOrder`/`canTransition` like a real fulfilment webhook
 *     would, so an impossible transition is impossible here too.
 */

import { el, $, replace, toast, queryParam, copyText } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money, percent, dateTime, relative } from "../../../assets/js/format.js";
import {
  ORDER_STATUS,
  STATUS_LABEL,
  advanceOrder,
  canTransition,
  normaliseReference,
  purchaseOrderPatch,
  routeToSuppliers,
} from "../core/orders.js";
import { getOrder, saveOrder, listOrders, products, suppliers } from "../core/context.js";
import { findById } from "../core/catalog.js";
import { mountHeader, mountFooter, breadcrumbs, countryName, statusBadge } from "./shell.js";
import { productArt } from "./productArt.js";

/**
 * The lifecycle a fulfilled order walks, in order. `cancelled` and `refunded`
 * are endings that hang off it rather than steps on it, so they are excluded
 * from the milestone list and only shown when an order actually reaches them.
 */
const HAPPY_PATH = ORDER_STATUS.filter((s) => s !== "cancelled" && s !== "refunded");

/** Supplier-side status of a parcel. Separate vocabulary from the customer order. */
const PO_STATUS_LABEL = {
  queued: "En cola en el proveedor",
  accepted: "Aceptado por el proveedor",
  packed: "Preparado y empaquetado",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const PAYMENT_LABEL = {
  card: "Tarjeta",
  paypal: "PayPal",
  bizum: "Bizum",
  transfer: "Transferencia bancaria",
  cod: "Contra reembolso",
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Dates for a delivery promise. `format.js#dateOnly` is the right call for a
 * log line, but a promise reads better with the day of the week — that is the
 * part a customer plans around. The comma Spanish puts after the weekday is
 * dropped because these are read inside a sentence, not as a heading.
 */
const longDate = (ts) =>
  new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(ts)).replace(",", "");

/** "lunes 24" — the short half of a range that ends in the same month. */
const weekdayDay = (ts) =>
  new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric" }).format(new Date(ts));

/** "entre el lunes 24 y el jueves 27 de agosto" — the month is said once. */
function deliveryRange(minAt, maxAt) {
  const from = new Date(minAt);
  const to = new Date(maxAt);
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  return `entre el ${sameMonth ? weekdayDay(minAt) : longDate(minAt)} y el ${longDate(maxAt)}`;
}

const supplierById = (id) => suppliers.find((s) => s.id === id) ?? null;

/**
 * Find an order by reference, tolerating case and punctuation. A customer
 * reading "NX-JXWK-ABCD" off an email routinely types "nx jxwk abcd".
 */
function lookupOrder(ref) {
  if (!ref) return null;
  const direct = getOrder(ref);
  if (direct) return direct;
  const wanted = normaliseReference(ref);
  if (!wanted) return null;
  return listOrders().find((o) => normaliseReference(o.reference) === wanted) ?? null;
}

/* --- Small shared pieces --------------------------------------------------- */

/**
 * Copy-to-clipboard button. `copyText` resolves false when the clipboard is
 * blocked (insecure origin, `file://`, denied permission), so the failure is
 * reported instead of silently pretending it worked.
 */
function copyButton(text, { label, compact = false }) {
  return el(`button.btn.btn--ghost${compact ? ".btn--sm" : ""}`, {
    type: "button",
    "aria-label": label,
    onclick: async () => {
      const ok = await copyText(text);
      toast(
        ok ? `${text} copiado al portapapeles.` : "No se ha podido copiar. Selecciona el texto y cópialo a mano.",
        { variant: ok ? "win" : "warn" }
      );
    },
  }, [icon("copy", { size: compact ? 14 : 16 }), el("span", {}, "Copiar")]);
}

/** Section wrapper: heading + body inside a card, used by every block below. */
function section(title, { id, lede = null, aside = null }, children) {
  return el("section.card.card--pad", { "aria-labelledby": id, style: { display: "grid", gap: "var(--space-4)" } }, [
    el("div.row.row--between.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("div", { style: { minWidth: "0" } }, [
        el("h2", { id, style: { fontSize: "var(--text-lg)" } }, title),
        lede ? el("p.text-sm.muted", { style: { marginTop: "var(--space-1)" } }, lede) : null,
      ]),
      aside,
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

/** Label / value pair for the address and payment panels. */
const dataRow = (label, value) =>
  el("div", { style: { display: "grid", gap: "2px" } }, [
    el("span.eyebrow", {}, label),
    el("span.text-sm", { style: { overflowWrap: "anywhere" } }, value),
  ]);

/* --- Header ---------------------------------------------------------------- */

function successHeader(order) {
  const closed = order.status === "cancelled" || order.status === "refunded";
  const unpaid = order.status === "pending_payment";
  const name = order.customer?.firstName?.trim();

  const title = order.status === "cancelled"
    ? "Pedido cancelado"
    : order.status === "refunded"
      ? "Pedido reembolsado"
      : unpaid
        ? "Tu pedido está pendiente de pago"
        : name
          ? `¡Gracias por tu pedido, ${name}!`
          : "¡Gracias por tu pedido!";

  // A pedido that has not been paid for yet must not be greeted as confirmed:
  // nothing has been charged and nothing has been sent to a supplier.
  const flag = closed
    ? { tone: "badge--loss", glyph: "info", text: "Pedido cerrado" }
    : unpaid
      ? { tone: "badge--warn", glyph: "clock", text: "Pago pendiente" }
      : { tone: "badge--win", glyph: "check", text: "Pedido confirmado" };

  return el("header.card.card--pad", { style: { display: "grid", gap: "var(--space-4)" } }, [
    el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, [
      el(`span.badge.${flag.tone}`, {}, [icon(flag.glyph, { size: 14 }), el("span", {}, flag.text)]),
      statusBadge(order.status),
    ]),

    el("div", {}, [
      el("h1", {}, title),
      el("p.muted", { style: { marginTop: "var(--space-2)" } }, [
        el("span", {}, unpaid ? "Te avisaremos a " : "Hemos enviado la confirmación a "),
        el("strong", { style: { color: "var(--fg)", overflowWrap: "anywhere" } }, order.customer?.email ?? "tu correo"),
        el("span", {}, unpaid
          ? " en cuanto se confirme el pago. Guarda esta página: desde aquí puedes seguir el pedido en cualquier momento."
          : ". Guarda esta página: desde aquí puedes seguir el pedido en cualquier momento."),
      ]),
    ]),

    // The reference is the one thing a customer has to be able to read aloud or
    // paste into an email, so it gets its own high-contrast block.
    el("div.card.card--inset.card--pad", {}, [
      el("div.row.row--between.row--wrap", { style: { gap: "var(--space-3)" } }, [
        el("div", { style: { minWidth: "0" } }, [
          el("span.eyebrow", {}, "Referencia del pedido"),
          el("strong.mono", {
            style: {
              display: "block",
              fontSize: "var(--text-2xl)",
              letterSpacing: "0.02em",
              overflowWrap: "anywhere",
              lineHeight: "var(--leading-tight)",
            },
          }, order.reference),
        ]),
        copyButton(order.reference, { label: `Copiar la referencia ${order.reference}` }),
      ]),
      el("p.text-xs.subtle", { style: { marginTop: "var(--space-3)" } },
        `Pedido realizado el ${dateTime(order.createdAt)} · ${relative(order.createdAt)}`),
    ]),

    el("p.text-xs.subtle", {},
      "Tienda de demostración: el cobro está simulado y no se envía ningún correo real."),
  ]);
}

/* --- Timeline -------------------------------------------------------------- */

/**
 * Which milestones to draw. A cancelled or refunded order stops where it
 * stopped: leaving "En tránsito" listed as pending would promise a delivery
 * that is never coming.
 */
function trackedStatuses(order) {
  if (order.status !== "cancelled" && order.status !== "refunded") return HAPPY_PATH;
  const reached = new Set((order.timeline ?? []).map((e) => e.status));
  return [...HAPPY_PATH.filter((s) => reached.has(s)), order.status];
}

function timelineList(order) {
  // First occurrence wins: a status could in principle be recorded twice, and
  // the milestone date a customer cares about is when it first happened.
  const firstEvent = new Map();
  for (const event of order.timeline ?? []) {
    if (!firstEvent.has(event.status)) firstEvent.set(event.status, event);
  }

  return el("ol.timeline", {}, trackedStatuses(order).map((status) => {
    const event = firstEvent.get(status);
    const current = status === order.status;
    const done = Boolean(event) && !current;

    return el("li", {
      dataset: { done: String(done), current: String(current) },
      ...(current ? { "aria-current": "step" } : {}),
    }, [
      el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
        el("strong", {
          style: { fontSize: "var(--text-sm)", color: event ? "var(--fg)" : "var(--fg-subtle)" },
        }, STATUS_LABEL[status]),
        el("span.text-xs.subtle", {}, event ? dateTime(event.at) : "Pendiente"),
      ]),
      // The note carries the detail the label cannot ("Enviado a 2 proveedores").
      event && event.note && event.note !== STATUS_LABEL[status]
        ? el("p.text-xs.muted", { style: { marginTop: "2px" } }, event.note)
        : null,
      current ? el("span.badge.badge--accent", { style: { marginTop: "var(--space-2)" } }, "Estado actual") : null,
    ]);
  }));
}

/* --- Delivery estimate ------------------------------------------------------ */

/**
 * The delivery window in plain Spanish. `order.eta` was frozen from the
 * shipping zone at purchase time, so this reads the promise that was actually
 * made rather than re-quoting today's table.
 */
function etaSentence(order, now = Date.now()) {
  if (order.status === "delivered") {
    const event = (order.timeline ?? []).find((e) => e.status === "delivered");
    return event ? `Entregado el ${longDate(event.at)}.` : "Pedido entregado.";
  }
  if (order.status === "cancelled") return "El pedido se canceló, así que no habrá entrega.";
  if (order.status === "refunded") return "El pedido se reembolsó. Si ya tenías el paquete, te indicamos cómo devolverlo.";

  const eta = order.eta;
  if (!eta) return "En cuanto el proveedor confirme el envío te daremos una fecha estimada.";

  // The clock only starts at payment, so an unpaid order gets the promised
  // window rather than a date it has no way of meeting.
  if (order.status === "pending_payment") {
    return `En cuanto se confirme el pago empezará a contar el plazo de entrega: ${eta.minDays}–${eta.maxDays} días laborables.`;
  }

  if (now > eta.maxAt) {
    // Being honest about a missed window beats showing a date that has passed.
    return `La fecha estimada era el ${longDate(eta.maxAt)} y ya ha pasado. Escríbenos y lo revisamos contigo.`;
  }
  if (now >= eta.minAt) {
    return `Debería llegar hoy y, como muy tarde, el ${longDate(eta.maxAt)}.`;
  }
  // The relative form anchors on the earliest date, which is what "llega" means
  // to someone waiting: the first day a parcel could be at the door.
  return `Llega ${relative(eta.minAt, { now })}, ${deliveryRange(eta.minAt, eta.maxAt)}.`;
}

function etaCard(order) {
  const eta = order.eta;
  const open = order.status !== "delivered" && order.status !== "cancelled" && order.status !== "refunded";

  return el("div.card.card--inset.card--pad", { style: { display: "grid", gap: "var(--space-2)" } }, [
    el("div.row", { style: { gap: "var(--space-3)", alignItems: "flex-start" } }, [
      el("span", { style: { color: "var(--accent)", flex: "none" }, "aria-hidden": "true" }, [icon("truck", { size: 22 })]),
      el("div", { style: { minWidth: "0" } }, [
        el("span.eyebrow", {}, "Entrega estimada"),
        el("p", { style: { fontWeight: "650", lineHeight: "var(--leading-snug)" } }, etaSentence(order)),
      ]),
    ]),
    eta && open
      ? el("p.text-xs.subtle", {},
          `Plazo comprometido: ${eta.minDays}–${eta.maxDays} días laborables desde la compra · ${order.totals?.zone?.label ?? ""}`)
      : null,
  ]);
}

/* --- Shipments -------------------------------------------------------------- */

/** Thumbnail for a line, falling back to a glyph when the product left the catalogue. */
function lineArt(line, { className = "cart-line__media", size = null } = {}) {
  const product = findById(products, line.productId);
  const style = size ? { width: `${size}px`, height: `${size}px`, flex: "none" } : {};

  if (!product) {
    return el(`div.${className}`, {
      style: { ...style, display: "grid", placeItems: "center", color: "var(--fg-subtle)" },
      "aria-hidden": "true",
    }, [icon("package", { size: 20 })]);
  }

  const variantIndex = Math.max(0, product.variants?.findIndex((v) => v.id === line.variantId) ?? 0);
  return el(`div.${className}`, {
    style,
    html: productArt(product, { variantIndex }),
    "aria-hidden": "true",
  });
}

/**
 * One block per purchase order. Everything shown here is customer-facing:
 * `po.lines[].unitCost` is what *we* pay the supplier and never appears.
 */
function shipmentCard(order, po, index) {
  const supplier = supplierById(po.supplierId);
  const total = order.purchaseOrders.length;

  const items = po.lines.map((poLine) => {
    // The purchase-order line knows quantity; the order line knows the variant
    // label the customer chose. They are matched on product + variant.
    const orderLine = order.lines.find(
      (l) => l.productId === poLine.productId && (l.variantId ?? null) === (poLine.variantId ?? null)
    );

    return el("li.row", { style: { gap: "var(--space-3)", padding: "var(--space-2) 0", alignItems: "center" } }, [
      lineArt(poLine, { className: "cart-line__media", size: 44 }),
      el("div", { style: { minWidth: "0", flex: "1 1 auto" } }, [
        el("span.text-sm", { style: { display: "block", fontWeight: "650" } }, poLine.title),
        orderLine?.variantLabel ? el("span.text-xs.subtle", {}, orderLine.variantLabel) : null,
      ]),
      el("span.text-sm.mono", { style: { flex: "none" } }, `×${poLine.qty}`),
    ]);
  });

  const tracking = po.trackingNumber
    ? el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
        el("div", { style: { minWidth: "0" } }, [
          el("span.eyebrow", {}, `Seguimiento · ${po.carrier}`),
          el("span.mono.text-sm", { style: { display: "block", overflowWrap: "anywhere" } }, po.trackingNumber),
        ]),
        copyButton(po.trackingNumber, {
          label: `Copiar el número de seguimiento ${po.trackingNumber}`,
          compact: true,
        }),
      ])
    : el("p.text-sm.muted", {},
        "El proveedor todavía no ha generado el número de seguimiento. Aparecerá aquí en cuanto el paquete salga del almacén.");

  return el("article.card.card--pad", { style: { display: "grid", gap: "var(--space-3)" } }, [
    el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
      el("div.row", { style: { gap: "var(--space-2)", minWidth: "0" } }, [
        el("span", { style: { color: "var(--fg-muted)", flex: "none" }, "aria-hidden": "true" }, [icon("package", { size: 18 })]),
        el("strong", { style: { fontSize: "var(--text-sm)" } }, `Paquete ${index + 1} de ${total}`),
      ]),
      el("span.badge", {}, PO_STATUS_LABEL[po.status] ?? po.status),
    ]),

    el("p.text-xs.subtle", { style: { overflowWrap: "anywhere" } }, [
      el("span", {}, supplier ? `Enviado por ${supplier.name}` : `Proveedor ${po.supplierId}`),
      supplier ? el("span", {}, ` · ${countryName(supplier.country)} · preparación en ${supplier.leadTimeDays[0]}–${supplier.leadTimeDays[1]} días`) : null,
    ]),

    el("div.card.card--inset", { style: { padding: "var(--space-3)" } }, [tracking]),

    el("ul", { style: { listStyle: "none", padding: "0", margin: "0" } }, items),
  ]);
}

function shipmentsSection(order) {
  const count = order.purchaseOrders?.length ?? 0;
  if (!count) return null;

  const closed = order.status === "cancelled" || order.status === "refunded";
  const lede = closed
    ? `El pedido incluía ${plural(count, "paquete", "paquetes")}.`
    : count > 1
      ? `Tu pedido viaja en ${count} paquetes independientes.`
      : "Tu pedido viaja en un único paquete.";

  return section("Envíos", { id: "shipments-title", lede }, [
    // The split is the single most common support question in dropshipping:
    // explaining it up front is cheaper than answering it afterwards.
    el("p.text-sm.muted", {}, count > 1
      ? "Cada artículo sale del almacén del proveedor que lo fabrica o lo tiene en stock, así que un mismo pedido puede repartirse en varios paquetes. Cada uno tiene su propio transportista, su número de seguimiento y su fecha de llegada: es normal que uno llegue antes que otro y no falta nada por ello."
      : "Todos los artículos salen del mismo almacén, así que llegan juntos. Cuando un pedido incluye productos de varios proveedores se reparte en varios paquetes, cada uno con su seguimiento."),

    el("div", { style: { display: "grid", gap: "var(--space-4)" } },
      order.purchaseOrders.map((po, i) => shipmentCard(order, po, i))),
  ]);
}

/* --- Order detail ------------------------------------------------------------ */

function orderLineRow(line) {
  const product = findById(products, line.productId);
  const slug = line.slug ?? product?.slug ?? null;
  const href = slug ? `product.html?slug=${encodeURIComponent(slug)}` : "index.html";

  return el("article.cart-line", {}, [
    lineArt(line),
    el("div", { style: { display: "grid", gap: "var(--space-1)", minWidth: "0" } }, [
      product ? el("span.eyebrow", {}, product.brand) : null,
      el("a", { href, style: { fontWeight: "650", color: "var(--fg)" } }, line.title),
      el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, [
        line.variantLabel ? el("span.badge", {}, line.variantLabel) : null,
        el("span.text-sm.muted", {}, `${money(line.unitPrice)} × ${line.qty}`),
      ]),
    ]),
    el("div.cart-line__actions", {}, [
      el("strong", { style: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } },
        money(line.unitPrice * line.qty)),
    ]),
  ]);
}

const summaryRow = (label, value, { total = false, tone = "" } = {}) =>
  el(`div.summary__row${total ? ".summary__row--total" : ""}`, {}, [
    el("span", { class: total ? "" : "muted" }, label),
    el("span", {
      class: tone,
      style: { fontVariantNumeric: "tabular-nums", fontWeight: total ? "800" : "650", whiteSpace: "nowrap" },
    }, value),
  ]);

function totalsBlock(order) {
  const t = order.totals;
  // The VAT rate is derived from the frozen figures instead of looked up by
  // country: the order must always add up to what was charged, even if the
  // rate table changes later.
  const rate = t.net > 0 ? t.tax / t.net : 0;

  return el("div", {}, [
    summaryRow(`Subtotal (${plural(t.count, "artículo", "artículos")})`, money(t.subtotal)),
    t.discount > 0
      ? summaryRow(t.promo ? `Descuento (${t.promo.code})` : "Descuento", `−${money(t.discount)}`, { tone: "text-win" })
      : null,
    summaryRow(`Envío · ${t.zone?.label ?? ""}`, t.shipping === 0 ? "Gratis" : money(t.shipping), {
      tone: t.shipping === 0 ? "text-win" : "",
    }),
    el("hr.divider", { style: { margin: "var(--space-2) 0" } }),
    summaryRow("Base imponible", money(t.net)),
    summaryRow(`IVA (${percent(rate, { decimals: 0 })}) incluido`, money(t.tax)),
    // Nothing has been charged yet while the order sits unpaid, so the label
    // must not claim it has.
    summaryRow(order.status === "pending_payment" ? "Total a pagar" : "Total pagado", money(t.total), { total: true }),
  ].filter(Boolean));
}

function paymentPanel(order) {
  const payment = order.payment ?? {};
  const method = PAYMENT_LABEL[payment.method] ?? payment.method ?? "Pago";
  const card = [payment.brand, payment.last4 ? `•••• ${payment.last4}` : null].filter(Boolean).join(" ");

  return el("div.panel", { style: { display: "grid", gap: "var(--space-3)" } }, [
    el("div.row", { style: { gap: "var(--space-2)" } }, [
      el("span", { style: { color: "var(--fg-muted)" }, "aria-hidden": "true" }, [icon("wallet", { size: 18 })]),
      el("strong", { style: { fontSize: "var(--text-sm)" } }, "Método de pago"),
    ]),
    dataRow(method, card || "Pago autorizado"),
    // Never anything but the last four: the PAN goes to the processor and is
    // not stored by the shop, so there is nothing else to show. The note only
    // makes sense for a card — PayPal and Bizum have no digits to withhold.
    payment.last4
      ? el("p.text-xs.subtle", {}, "Solo conservamos los cuatro últimos dígitos. El número completo nunca llega a la tienda.")
      : null,
  ]);
}

function addressPanel(order) {
  const c = order.customer ?? {};
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");

  return el("div.panel", { style: { display: "grid", gap: "var(--space-3)" } }, [
    el("div.row", { style: { gap: "var(--space-2)" } }, [
      el("span", { style: { color: "var(--fg-muted)" }, "aria-hidden": "true" }, [icon("home", { size: 18 })]),
      el("strong", { style: { fontSize: "var(--text-sm)" } }, "Dirección de envío"),
    ]),
    el("address", { style: { fontStyle: "normal", fontSize: "var(--text-sm)", lineHeight: "var(--leading-snug)", overflowWrap: "anywhere" } }, [
      name ? el("strong", { style: { display: "block" } }, name) : null,
      el("span", { style: { display: "block" } }, c.address ?? ""),
      el("span", { style: { display: "block" } }, [c.postalCode, c.city].filter(Boolean).join(" ")),
      el("span", { style: { display: "block" } }, countryName(c.country)),
      c.phone ? el("span.subtle", { style: { display: "block" } }, `Tel. ${c.phone}`) : null,
    ]),
    c.notes ? el("p.text-xs.muted", {}, `Nota para el repartidor: ${c.notes}`) : null,
  ]);
}

/* --- Status simulator --------------------------------------------------------- */

/** The next step on the happy path, or null when the order has run its course. */
function nextStatus(order) {
  const index = HAPPY_PATH.indexOf(order.status);
  if (index === -1) return null; // cancelled / refunded: nothing follows
  const next = HAPPY_PATH[index + 1] ?? null;
  return next && canTransition(order.status, next) ? next : null;
}

function simulateNext(order) {
  const to = nextStatus(order);
  if (!to) return;

  const at = Date.now();
  // `routeToSuppliers` is the only place that assigns a carrier and a tracking
  // number — it wraps `advanceOrder` — so the routing hop goes through it and
  // the parcels come back with something to track.
  const next = to === "routing"
    ? routeToSuppliers(order, { at })
    : advanceOrder(order, to, { at, patch: purchaseOrderPatch(order, to) });

  saveOrder(next);
  toast(`Estado simulado: ${STATUS_LABEL[to]}.`, { variant: "info", title: "Pedido actualizado" });
  render();
}

function simulatorCard(order) {
  const to = nextStatus(order);

  return el("section.card.card--pad", { "aria-labelledby": "sim-title", style: { display: "grid", gap: "var(--space-3)" } }, [
    el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, [
      el("span.badge.badge--warn", {}, "Simulación"),
      el("h2", { id: "sim-title", style: { fontSize: "var(--text-lg)" } }, "Ver la línea de tiempo en marcha"),
    ]),
    el("p.text-sm.muted", {},
      "Esta tienda es una demostración: no hay proveedores reales que confirmen envíos. El botón hace avanzar el pedido al siguiente estado válido de su ciclo de vida, igual que haría el aviso del proveedor, y queda registrado en la línea de tiempo con la fecha de ahora."),
    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("button.btn.btn--primary", {
        type: "button",
        disabled: !to,
        "aria-label": to ? `Simular el siguiente estado del pedido: ${STATUS_LABEL[to]}` : "No hay más estados que simular",
        onclick: () => simulateNext(order),
      }, [icon("refresh", { size: 16 }), el("span", {}, "Simular siguiente estado")]),
      el("span.text-sm.subtle", {}, to
        ? `Siguiente: ${STATUS_LABEL[to]}`
        : "El pedido ya está en un estado final."),
    ]),
  ]);
}

/* --- Views --------------------------------------------------------------------- */

function orderView(order) {
  const units = order.lines.reduce((n, l) => n + l.qty, 0);

  return [
    successHeader(order),

    section("Estado del pedido", {
      id: "timeline-title",
      lede: "Cada hito queda fechado en cuanto ocurre.",
      aside: statusBadge(order.status),
    }, [
      etaCard(order),
      timelineList(order),
    ]),

    shipmentsSection(order),

    section("Detalle del pedido", {
      id: "detail-title",
      lede: `${plural(units, "artículo", "artículos")} en ${plural(order.lines.length, "línea", "líneas")}. Los precios ya llevan el IVA.`,
    }, [
      el("div", {}, order.lines.map(orderLineRow)),

      el("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "var(--space-4)",
          marginTop: "var(--space-4)",
        },
      }, [addressPanel(order), paymentPanel(order)]),

      el("div.card.card--inset.card--pad", {}, [totalsBlock(order)]),
    ]),

    simulatorCard(order),

    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("a.btn.btn--ghost", { href: "orders.html" }, [icon("clock", { size: 16 }), el("span", {}, "Ver todos mis pedidos")]),
      el("a.btn.btn--ghost", { href: "index.html" }, [icon("cart", { size: 16 }), el("span", {}, "Seguir comprando")]),
    ]),
  ];
}

/** No reference, or a reference nobody recognises: offer a way forward. */
function missingView(ref) {
  const recent = listOrders().slice(0, 3);

  const input = el("input.input", {
    type: "search",
    name: "ref",
    value: ref ?? "",
    placeholder: "NX-XXXX-XXXX",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Referencia del pedido",
  });

  const form = el("form.row.row--wrap", {
    style: { gap: "var(--space-2)", alignItems: "stretch", justifyContent: "center" },
    onsubmit: (ev) => {
      ev.preventDefault();
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      // A full reload keeps the URL shareable and the back button meaningful.
      location.href = `order.html?ref=${encodeURIComponent(value.toUpperCase())}`;
    },
  }, [
    el("div", { style: { flex: "1 1 220px", minWidth: "0" } }, [input]),
    el("button.btn.btn--primary", { type: "submit" }, [icon("search", { size: 16 }), el("span", {}, "Buscar")]),
  ]);

  return [
    el("div.card", {}, [
      el("div.empty", {}, [
        el("div.empty__icon", { "aria-hidden": "true" }, [icon("package", { size: 40 })]),
        el("h1", { style: { color: "var(--fg)", fontSize: "var(--text-2xl)" } },
          ref ? "No encontramos ese pedido" : "Sigue tu pedido"),
        el("p.text-sm", { style: { marginTop: "var(--space-2)", maxWidth: "52ch", marginInline: "auto" } },
          ref
            ? `La referencia ${ref} no aparece en este navegador. Comprueba que esté bien escrita: los pedidos de esta demostración se guardan en tu propio equipo, así que no se ven desde otro dispositivo.`
            : "Escribe la referencia que te dimos al confirmar la compra —empieza por NX— y te contamos dónde está tu paquete."),
        el("div", { style: { marginTop: "var(--space-5)", maxWidth: "420px", marginInline: "auto" } }, [form]),
      ]),
    ]),

    recent.length
      ? section("Tus pedidos recientes", { id: "recent-title", lede: "Guardados en este navegador." }, [
          el("div.row.row--wrap", { style: { gap: "var(--space-2)" } },
            recent.map((o) => el("a.chip", {
              href: `order.html?ref=${encodeURIComponent(o.reference)}`,
              "aria-label": `Ver el pedido ${o.reference}, ${STATUS_LABEL[o.status]}`,
            }, [
              el("span.mono", {}, o.reference),
              el("span.text-xs.subtle", {}, STATUS_LABEL[o.status]),
            ]))),
        ])
      : null,

    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("a.btn.btn--ghost", { href: "orders.html" }, [icon("clock", { size: 16 }), el("span", {}, "Ver el listado de pedidos")]),
      el("a.btn.btn--ghost", { href: "index.html" }, [icon("cart", { size: 16 }), el("span", {}, "Ir al catálogo")]),
    ]),
  ];
}

/* --- Boot ------------------------------------------------------------------------ */

const root = $("#order-root");
const crumbs = $("#crumbs");
const requestedRef = queryParam("ref");

/**
 * Repaint from storage. The simulator writes through `saveOrder` and then calls
 * this, so the page always shows persisted state rather than an in-memory copy
 * that a reload would contradict.
 */
function render() {
  const order = lookupOrder(requestedRef);

  replace(crumbs, [breadcrumbs([
    { label: "Inicio", href: "index.html" },
    { label: "Mis pedidos", href: "orders.html" },
    { label: order ? order.reference : "Seguimiento" },
  ])]);

  document.title = order
    ? `Pedido ${order.reference} · NEXYTT Store`
    : "Seguimiento del pedido · NEXYTT Store";

  replace(root, order ? orderView(order) : missingView(requestedRef));
}

mountHeader({ active: "orders" });
render();
mountFooter();
