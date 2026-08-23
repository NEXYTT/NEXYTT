/**
 * "Mis pedidos" — the whole order book stored in this browser.
 *
 * The list is deliberately dumb about money and status: every figure is read
 * from the frozen order, and the labels come from `orders.js`, so the listing
 * can never disagree with the tracking page.
 *
 * The sample-order button exists because a shop with no orders is a page nobody
 * can review. It builds a real order out of real catalogue products through the
 * same `Cart` → `createOrder` → `routeToSuppliers` path a checkout uses, on a
 * throwaway in-memory store so the shopper's actual cart is never touched.
 */

import { el, $, replace, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money, dateTime, relative } from "../../../assets/js/format.js";
import { Cart } from "../core/cart.js";
import { createMemoryStore } from "../../../assets/js/storage.js";
import {
  ORDER_STATUS,
  STATUS_LABEL,
  createOrder,
  advanceOrder,
  routeToSuppliers,
} from "../core/orders.js";
import { listOrders, saveOrder, products } from "../core/context.js";
import { findById } from "../core/catalog.js";
import { mountHeader, mountFooter, breadcrumbs } from "./shell.js";
import { productArt } from "./productArt.js";

const DAY = 86400000;
const THUMBS = 4;

/**
 * Badge tone per status — same reading as the tracking page (green: good news,
 * red: no parcel is coming). Kept local so neither page controller has to
 * import the other's module-level side effects.
 */
const STATUS_TONE = {
  pending_payment: "badge--warn",
  paid: "badge--info",
  routing: "badge--info",
  fulfilled: "badge--accent",
  shipped: "badge--accent",
  delivered: "badge--win",
  cancelled: "badge--loss",
  refunded: "badge--loss",
};

/** Order status → the parcel status it implies for every purchase order. */
const PO_STATUS_ON = {
  fulfilled: "packed",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Loose reference matching, so "nx jxwk" finds NX-JXWK-ABCD. */
const normaliseRef = (raw) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const unitsIn = (order) => order.lines.reduce((n, l) => n + l.qty, 0);

/**
 * `hidden` is only a UA rule, so any class that sets `display` (`.toolbar`)
 * beats it: both have to be toggled.
 */
function setHidden(node, hidden) {
  node.hidden = hidden;
  node.style.display = hidden ? "none" : "";
}

/* --- Filter state ----------------------------------------------------------- */

let filterStatus = "all";
let queryText = "";

/* --- Toolbar ---------------------------------------------------------------- */

const statusSelect = el("select.select", {
  "aria-label": "Filtrar por estado del pedido",
  onchange: () => {
    filterStatus = statusSelect.value;
    renderList();
  },
});

const searchInput = el("input.input", {
  type: "search",
  placeholder: "Buscar por referencia…",
  autocomplete: "off",
  spellcheck: "false",
  "aria-label": "Buscar un pedido por su referencia",
  oninput: () => {
    queryText = searchInput.value;
    renderList();
  },
});

const sampleButton = el("button.btn.btn--ghost.btn--sm", {
  type: "button",
  "aria-label": "Generar un pedido de ejemplo con productos del catálogo",
  onclick: () => createSampleOrder(),
}, [icon("sparkle", { size: 16 }), el("span", {}, "Pedido de ejemplo")]);

const toolbar = $("#toolbar");
const listHost = $("#list");
const lede = $("#lede");

replace(toolbar, [
  el("div", { style: { flex: "1 1 220px", minWidth: "0" } }, [searchInput]),
  el("div", { style: { flex: "0 1 240px", minWidth: "0" } }, [statusSelect]),
  el("span.spacer.hide-sm"),
  sampleButton,
]);

/**
 * Rebuild the status options from the orders that actually exist. Offering
 * "Reembolsado (0)" in a list with no refunds is a dead end, and a filter left
 * pointing at a status that has just disappeared would show nothing for ever.
 */
function syncStatusOptions(orders) {
  const counts = new Map();
  for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);

  const options = [el("option", { value: "all" }, `Todos los estados (${orders.length})`)];
  for (const status of ORDER_STATUS) {
    const count = counts.get(status) ?? 0;
    if (count) options.push(el("option", { value: status }, `${STATUS_LABEL[status]} (${count})`));
  }

  if (filterStatus !== "all" && !counts.has(filterStatus)) filterStatus = "all";
  replace(statusSelect, options);
  statusSelect.value = filterStatus;
}

/* --- Order card -------------------------------------------------------------- */

/** Up to `THUMBS` product illustrations, so a row is recognisable at a glance. */
function thumbStrip(order) {
  const shown = order.lines.slice(0, THUMBS);
  const rest = order.lines.length - shown.length;

  return el("div.row", { style: { gap: "var(--space-2)" }, "aria-hidden": "true" }, [
    ...shown.map((line) => {
      const product = findById(products, line.productId);
      const style = { width: "44px", height: "44px", flex: "none" };
      if (!product) {
        return el("div.cart-line__media", {
          style: { ...style, display: "grid", placeItems: "center", color: "var(--fg-subtle)" },
        }, [icon("package", { size: 18 })]);
      }
      const variantIndex = Math.max(0, product.variants?.findIndex((v) => v.id === line.variantId) ?? 0);
      return el("div.cart-line__media", { style, html: productArt(product, { variantIndex }) });
    }),
    rest > 0 ? el("span.text-xs.subtle", {}, `+${rest}`) : null,
  ]);
}

/**
 * The whole card is the link. No nested buttons: one row, one destination, one
 * tab stop — which is also what makes the 44 px tap target trivially satisfied.
 */
function orderCard(order) {
  const units = unitsIn(order);
  const parcels = order.purchaseOrders?.length ?? 0;

  return el("a.card.card--pad", {
    href: `order.html?ref=${encodeURIComponent(order.reference)}`,
    "aria-label": `Pedido ${order.reference} del ${dateTime(order.createdAt)}, ${STATUS_LABEL[order.status]}, ${plural(units, "artículo", "artículos")}, total ${money(order.totals.total)}`,
    style: { display: "grid", gap: "var(--space-3)", alignContent: "start" },
  }, [
    el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
      el("strong.mono", { style: { fontSize: "var(--text-md)", overflowWrap: "anywhere" } }, order.reference),
      el(`span.badge.${STATUS_TONE[order.status] ?? "badge"}`, {}, STATUS_LABEL[order.status]),
    ]),

    el("p.text-xs.subtle", {}, `${dateTime(order.createdAt)} · ${relative(order.createdAt)}`),

    thumbStrip(order),

    el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
      el("span.text-sm.muted", {}, [
        el("span", {}, plural(units, "artículo", "artículos")),
        parcels > 1 ? el("span", {}, ` · ${parcels} paquetes`) : null,
      ]),
      el("strong", { style: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } }, money(order.totals.total)),
    ]),

    el("span.text-sm.text-accent.row", { style: { gap: "var(--space-1)" } }, [
      el("span", {}, "Ver seguimiento"),
      icon("chevronRight", { size: 16 }),
    ]),
  ]);
}

/* --- Sample order ------------------------------------------------------------- */

/** Clearly fictional customer: this order never leaves the browser. */
const SAMPLE_CUSTOMER = {
  email: "ana.ruiz@ejemplo.es",
  firstName: "Ana",
  lastName: "Ruiz",
  phone: "600 123 456",
  address: "Calle Mayor 14, 3.º B",
  city: "Madrid",
  postalCode: "28013",
  country: "ES",
  notes: "Dejar en conserjería si no hay nadie.",
};

const SAMPLE_PAYMENT = { method: "card", last4: "4242", brand: "Visa" };

/** Endings worth showing, so the status filter has something to filter. */
const SCENARIOS = ["paid", "routing", "fulfilled", "shipped", "delivered", "delivered", "cancelled"];

/** The fulfilment path, minus the state every order starts in. */
const PATH = ["paid", "routing", "fulfilled", "shipped", "delivered"];

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Two or three products from *different* suppliers, so the sample order splits
 * into several purchase orders — the case the tracking page exists to explain.
 */
function pickLines() {
  const bySupplier = new Map();
  for (const product of products) {
    if (!bySupplier.has(product.supplierId)) bySupplier.set(product.supplierId, []);
    bySupplier.get(product.supplierId).push(product);
  }

  const suppliersShuffled = [...bySupplier.keys()].sort(() => Math.random() - 0.5);
  const wanted = 2 + Math.floor(Math.random() * 2); // 2–3 suppliers

  return suppliersShuffled.slice(0, wanted).map((supplierId) => ({
    product: pickOne(bySupplier.get(supplierId)),
    qty: Math.random() < 0.75 ? 1 : 2,
  }));
}

/** Keep every parcel's status in step with the order it belongs to. */
function purchaseOrderPatch(order, to) {
  const poStatus = PO_STATUS_ON[to];
  if (!poStatus || !order.purchaseOrders) return {};
  return { purchaseOrders: order.purchaseOrders.map((po) => ({ ...po, status: poStatus })) };
}

/**
 * Walk a freshly created order up to `target`, dating each milestone between
 * the purchase and now so the timeline reads like something that really
 * happened instead of eight events at the same second.
 */
function walkTo(order, target, createdAt) {
  const steps = target === "cancelled"
    ? ["paid", "cancelled"]
    : PATH.slice(0, PATH.indexOf(target) + 1);

  const span = Math.max(DAY, Date.now() - createdAt);

  return steps.reduce((current, status, i) => {
    const at = createdAt + Math.round((span * (i + 1)) / (steps.length + 1));
    // `routeToSuppliers` is what assigns carriers and tracking numbers; it wraps
    // `advanceOrder`, so the transition is validated the same way.
    return status === "routing"
      ? routeToSuppliers(current, { at })
      : advanceOrder(current, status, { at, patch: purchaseOrderPatch(current, status) });
  }, order);
}

function createSampleOrder() {
  // A throwaway cart on an in-memory store: building the sample must not touch
  // the shopper's real cart, which lives in localStorage under the same class.
  const draft = new Cart({ store: createMemoryStore() });

  for (const { product, qty } of pickLines()) {
    const variant = product.variants?.length ? pickOne(product.variants) : null;
    // Same payload `shell.js#addToCart` builds — repeated rather than imported
    // because that helper writes straight into the live cart.
    draft.add({
      productId: product.id,
      variantId: variant?.id ?? null,
      title: product.title,
      variantLabel: variant?.label ?? "",
      unitPrice: product.price + (variant?.priceDelta ?? 0),
      compareAt: product.compareAt,
      grams: product.grams,
      supplierId: product.supplierId,
      supplierCost: product.supplierCost,
      slug: product.slug,
      art: product.art,
    }, qty);
  }

  // Backdated by 2–6 days: long enough for the milestones to spread out over
  // real dates, short enough that the delivery window frozen into the order
  // (3–6 días for Spain) still straddles today instead of having lapsed.
  const createdAt = Date.now() - Math.round((2 + Math.random() * 4) * DAY);
  const target = pickOne(SCENARIOS);

  const order = walkTo(
    createOrder({ snapshot: draft.snapshot(), customer: SAMPLE_CUSTOMER, payment: SAMPLE_PAYMENT, now: createdAt }),
    target,
    createdAt
  );

  saveOrder(order);
  // Show it whatever the filter said, otherwise the new order lands outside the
  // current view and the button looks broken.
  filterStatus = "all";
  queryText = "";
  searchInput.value = "";
  render();

  toast(`${order.reference} · ${STATUS_LABEL[order.status]}. Ábrelo para ver el seguimiento.`, {
    variant: "win",
    title: "Pedido de ejemplo creado",
  });
}

/* --- Views -------------------------------------------------------------------- */

function emptyState() {
  return el("div.card", {}, [
    el("div.empty", {}, [
      el("div.empty__icon", { "aria-hidden": "true" }, [icon("package", { size: 40 })]),
      el("h2", { style: { color: "var(--fg)", fontSize: "var(--text-xl)" } }, "Todavía no has hecho ningún pedido"),
      el("p.text-sm", { style: { marginTop: "var(--space-2)", maxWidth: "52ch", marginInline: "auto" } },
        "Cuando completes una compra aparecerá aquí con su estado y su seguimiento. Los pedidos se guardan en este navegador, así que no se ven desde otro dispositivo."),
      el("div.row.row--wrap", { style: { gap: "var(--space-3)", justifyContent: "center", marginTop: "var(--space-5)" } }, [
        el("a.btn.btn--primary", { href: "index.html" }, [icon("cart", { size: 18 }), el("span", {}, "Ver el catálogo")]),
        el("button.btn.btn--ghost", {
          type: "button",
          "aria-label": "Generar un pedido de ejemplo con productos del catálogo",
          onclick: () => createSampleOrder(),
        }, [icon("sparkle", { size: 18 }), el("span", {}, "Generar un pedido de ejemplo")]),
      ]),
      el("p.text-xs.subtle", { style: { marginTop: "var(--space-4)" } },
        "El pedido de ejemplo usa productos y proveedores reales del catálogo. Sirve para ver la página funcionando sin tener que comprar."),
    ]),
  ]);
}

function noMatchesState() {
  return el("div.card", {}, [
    el("div.empty", {}, [
      el("div.empty__icon", { "aria-hidden": "true" }, [icon("search", { size: 40 })]),
      el("h2", { style: { color: "var(--fg)", fontSize: "var(--text-lg)" } }, "Ningún pedido coincide"),
      el("p.text-sm", { style: { marginTop: "var(--space-2)" } },
        "Prueba con otra referencia o quita el filtro de estado."),
      el("button.btn.btn--ghost", {
        type: "button",
        style: { marginTop: "var(--space-4)" },
        onclick: () => {
          filterStatus = "all";
          queryText = "";
          searchInput.value = "";
          statusSelect.value = "all";
          renderList();
        },
      }, "Quitar los filtros"),
    ]),
  ]);
}

/** Apply the current filter and search to the stored orders. */
function visibleOrders(orders) {
  const wanted = normaliseRef(queryText);
  return orders.filter((order) => {
    if (filterStatus !== "all" && order.status !== filterStatus) return false;
    return !wanted || normaliseRef(order.reference).includes(wanted);
  });
}

/** Repaint only the results, so the filter controls keep focus while typing. */
function renderList() {
  const orders = listOrders();
  const shown = visibleOrders(orders);

  if (!orders.length) {
    replace(listHost, [emptyState()]);
    return;
  }

  if (!shown.length) {
    replace(listHost, [noMatchesState()]);
    return;
  }

  replace(listHost, [
    el("p.text-sm.subtle", { role: "status", style: { marginBottom: "var(--space-3)" } },
      shown.length === orders.length
        ? `${plural(orders.length, "pedido", "pedidos")}`
        : `${shown.length} de ${orders.length} pedidos`),
    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
        gap: "var(--space-4)",
      },
    }, shown.map(orderCard)),
  ]);
}

/** Full repaint: the header line, the filter options and the list. */
function render() {
  const orders = listOrders();

  setHidden(toolbar, orders.length === 0);
  syncStatusOptions(orders);

  const units = orders.reduce((n, o) => n + unitsIn(o), 0);
  lede.textContent = orders.length
    ? `${plural(orders.length, "pedido", "pedidos")} · ${plural(units, "artículo", "artículos")} en total. Toca cualquiera para ver su seguimiento.`
    : "Aquí aparecerán tus compras, con su estado y su número de seguimiento.";

  renderList();
}

/* --- Boot --------------------------------------------------------------------- */

mountHeader({ active: "orders" });

$("#crumbs").append(breadcrumbs([{ label: "Inicio", href: "index.html" }, { label: "Mis pedidos" }]));

render();
mountFooter();
