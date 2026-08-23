/**
 * Panel de operación — the back office of the dropshipping business.
 *
 * The storefront sells; this page decides what is worth selling. Every figure
 * on it comes from `core/analytics.js` and `core/pricing.js`, which are pure
 * and unit-tested, so the page is only a renderer: it owns the knobs (CAC,
 * target margin, simulated volume), never the arithmetic.
 *
 * Two rendering rules make the live recalculation work:
 *
 *  1. Controls that hold typed input are built **once** and moved between
 *     repaints. Rebuilding an `<input>` while someone is typing in it steals
 *     the caret, and this page is nothing but inputs.
 *  2. Only the results container is repainted. `paintProducts()` and
 *     `paintSimulator()` replace their own output node and nothing else.
 *
 * The imported catalogue lives in `state.catalog`, never in the shared
 * `products` array from `core/context.js`: a CSV import must not leak new
 * prices into the storefront that the shopper is browsing in another tab.
 */

import { el, $, replace, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money, percent, dateOnly, compact } from "../../../assets/js/format.js";
import { products, suppliers, listOrders, saveOrder, store } from "../core/context.js";
import { categoryLabel } from "../../data/products.js";
import { aggregateEconomics, routeToSuppliers, canTransition, STATUS_LABEL } from "../core/orders.js";
import { SHIPPING_ZONES, PAYMENT_FEE } from "../core/pricing.js";
import {
  DEFAULT_CAC,
  DEFAULT_TARGET_MARGIN,
  DEFAULT_REFUND_RATE,
  VERDICT_CRITERIA,
  VERDICT_LABEL,
  VERDICT_TONE,
  VERDICT_RULE_TEXT,
  RISK_MODEL,
  MIX_PRESETS,
  productScorecard,
  supplierScorecard,
  catalogSummary,
  simulateMonth,
  revenueByCategory,
  toCsv,
  parseCsv,
  catalogRows,
  applyCatalogRows,
  CATALOG_COLUMNS,
  EDITABLE_COLUMNS,
} from "../core/analytics.js";
import { mountHeader, mountFooter, breadcrumbs } from "./shell.js";

/* --- State ---------------------------------------------------------------- */

const SETTINGS_KEY = "admin";

/** Knobs worth surviving a reload; the imported catalogue deliberately is not. */
const savedSettings = store.get(SETTINGS_KEY) ?? {};

const state = {
  tab: "resumen",
  adCostPerOrder: numberOr(savedSettings.adCostPerOrder, DEFAULT_CAC),
  targetMargin: numberOr(savedSettings.targetMargin, DEFAULT_TARGET_MARGIN),
  sort: { key: "marginRate", dir: "desc" },
  /** Working copy of the catalogue: a CSV import edits this, not the storefront's. */
  catalog: products.map((p) => ({ ...p })),
  imported: false,
  sim: {
    orders: numberOr(savedSettings.simOrders, 320),
    adSpend: numberOr(savedSettings.simAdSpend, 190000),
    refundRate: numberOr(savedSettings.simRefundRate, DEFAULT_REFUND_RATE),
    mix: MIX_PRESETS[savedSettings.simMix] ? savedSettings.simMix : "ventas",
  },
};

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function persist() {
  store.set(SETTINGS_KEY, {
    adCostPerOrder: state.adCostPerOrder,
    targetMargin: state.targetMargin,
    simOrders: state.sim.orders,
    simAdSpend: state.sim.adSpend,
    simRefundRate: state.sim.refundRate,
    simMix: state.sim.mix,
  });
}

/** Options every scorecard call shares, so no two tabs can disagree. */
const econOpts = () => ({
  adCostPerOrder: state.adCostPerOrder,
  targetMargin: state.targetMargin,
});

const supplierName = (id) => suppliers.find((s) => s.id === id)?.name ?? id;

/* --- Small shared pieces -------------------------------------------------- */

/** A KPI tile. `tone` colours the delta line, not the value: the number stays readable. */
function kpi(label, value, { note = "", tone = "" } = {}) {
  return el("div.kpi", {}, [
    el("div.kpi__label", {}, label),
    el("div.kpi__value", {}, value),
    note ? el("div.kpi__delta", { class: tone ? `text-${tone}` : "muted" }, note) : null,
  ]);
}

/** Section wrapper: a titled card with an optional explanatory lede. */
function section(title, lede, children, { flush = false } = {}) {
  return el(`div.card${flush ? ".card--flush" : ".card--pad"}`, {}, [
    el("div", { style: flush ? { padding: "var(--space-5) var(--space-5) var(--space-3)" } : {} }, [
      el("h2", { style: { fontSize: "var(--text-lg)" } }, title),
      lede ? el("p.text-sm.muted", { style: { marginTop: "var(--space-2)", maxWidth: "76ch" } }, lede) : null,
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

/** Horizontal bar row: label, value and a proportional `.bar-fill`. */
function barRow(label, valueText, ratio, { hint = "", colour = "var(--accent)" } = {}) {
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return el("div", { style: { display: "grid", gap: "var(--space-2)" } }, [
    el("div.row.row--between", { style: { gap: "var(--space-3)" } }, [
      el("span.text-sm", { style: { minWidth: "0", overflowWrap: "anywhere" } }, label),
      el("strong.num.text-sm", { style: { whiteSpace: "nowrap" } }, valueText),
    ]),
    el("div.bar-track", {}, [el("div.bar-fill", { style: { width, background: colour } })]),
    hint ? el("span.text-xs.subtle", {}, hint) : null,
  ]);
}

const verdictBadge = (verdict) =>
  el(`span.badge.${VERDICT_TONE[verdict]}`, { title: VERDICT_RULE_TEXT[verdict] }, VERDICT_LABEL[verdict]);

/** `null` break-even ROAS means the order cannot pay for its own traffic at any price. */
const roasText = (value) => (value === null ? "—" : `${value.toFixed(2)}×`);

/** Signed money, coloured: the eye should find a loss without reading it. */
const signedMoney = (cents) =>
  el("span.num", { class: cents < 0 ? "text-loss" : cents > 0 ? "text-win" : "muted" }, money(cents));

/** A wide table always lives inside its own scroller so the page never scrolls sideways. */
const tableWrap = (table) => el("div.table-wrap", {}, [table]);

/**
 * Number field bound to a slider. Both write the same value, so you can drag to
 * explore and type to be exact — which is how these two knobs actually get used.
 *
 * @param {{id:string, label:string, hint?:string, min:number, max:number, step:number,
 *          value:number, format?:(n:number)=>string, onInput:(n:number)=>void}} config
 */
function sliderField({ id, label, hint = "", min, max, step, value, suffix = "", onInput }) {
  const number = el("input.input", {
    id,
    type: "number",
    min, max, step,
    value: String(value),
    inputmode: "decimal",
    style: { width: "7.5rem", flex: "none" },
  });

  const range = el("input", {
    type: "range",
    min, max, step,
    value: String(value),
    "aria-label": `${label} (deslizador)`,
    style: { flex: "1 1 120px", minWidth: "0", accentColor: "var(--accent)" },
  });

  const sync = (raw, echoTo) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    echoTo.value = String(clamped);
    onInput(clamped);
  };

  number.addEventListener("input", () => sync(number.value, range));
  range.addEventListener("input", () => sync(range.value, number));

  return el("div.field", { style: { minWidth: "0" } }, [
    el("label.label", { for: id }, label),
    el("div.row", { style: { gap: "var(--space-3)" } }, [
      range,
      number,
      suffix ? el("span.text-sm.muted", { style: { flex: "none" } }, suffix) : null,
    ]),
    hint ? el("p.field__hint", {}, hint) : null,
  ]);
}

/* --- Tab: RESUMEN ---------------------------------------------------------- */

/**
 * The headline figures. Real orders win whenever there are any; otherwise the
 * page falls back to the simulated month and says so loudly, because a KPI row
 * that silently shows made-up revenue is worse than no KPI row at all.
 *
 * "Beneficio bruto" means the same thing in both cases — net revenue minus
 * goods minus payment fees, *before* advertising — so the two sources are
 * directly comparable. Advertising enters in the simulator tab, where it can be
 * set.
 */
function summaryFigures() {
  const orders = listOrders();
  const agg = aggregateEconomics(orders);

  if (agg.orders > 0) {
    return {
      source: "real",
      orders: agg.orders,
      cancelled: agg.cancelled,
      revenueGross: agg.revenueGross,
      revenueNet: agg.revenueNet,
      goodsCost: agg.goodsCost,
      fees: agg.processingFees,
      tax: agg.tax,
      grossProfit: agg.grossProfit,
      marginRate: agg.marginRate,
      averageOrderValue: agg.averageOrderValue,
      units: agg.units,
      categories: revenueByCategory(orders, state.catalog),
    };
  }

  const sim = simulateMonth(state.catalog, { ...state.sim, targetMargin: state.targetMargin });
  const grossProfit = sim.revenueNet - sim.cogs - sim.fees;

  return {
    source: "sim",
    sim,
    orders: sim.orders,
    cancelled: 0,
    revenueGross: sim.revenueGross,
    revenueNet: sim.revenueNet,
    goodsCost: sim.cogs,
    fees: sim.fees,
    tax: sim.tax,
    grossProfit,
    marginRate: sim.revenueNet > 0 ? grossProfit / sim.revenueNet : 0,
    averageOrderValue: sim.averageOrderValue,
    units: sim.units,
    categories: categoriesFromSim(sim),
  };
}

/** Roll the simulated per-product lines up to categories, same shape as `revenueByCategory`. */
function categoriesFromSim(sim) {
  const buckets = new Map();
  for (const line of sim.byProduct) {
    const id = line.product.category;
    const bucket = buckets.get(id) ?? { id, label: "", revenue: 0, units: 0 };
    bucket.label = bucket.label || categoryLabel(id);
    bucket.revenue += line.revenueGross;
    bucket.units += line.orders;
    buckets.set(id, bucket);
  }
  const total = [...buckets.values()].reduce((a, b) => a + b.revenue, 0);
  return [...buckets.values()]
    .map((b) => ({ ...b, share: total > 0 ? b.revenue / total : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

function sourceBanner(figures) {
  if (figures.source === "real") {
    return el("div.card.card--pad.card--inset.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("span", { "aria-hidden": "true", style: { color: "var(--win)" } }, [icon("check", { size: 18 })]),
      el("p.text-sm", { style: { margin: 0, minWidth: "0" } }, [
        el("strong", {}, "Datos reales. "),
        el("span.muted", {}, `${figures.orders} pedidos cobrados en este navegador${figures.cancelled ? `, ${figures.cancelled} cancelados o reembolsados fuera del cómputo` : ""}. Los importes salen congelados de cada pedido, no del catálogo actual.`),
      ]),
    ]);
  }

  return el("div.card.card--pad.card--inset.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
    el("span", { "aria-hidden": "true", style: { color: "var(--warn)" } }, [icon("info", { size: 18 })]),
    el("div", { style: { minWidth: "0", flex: "1 1 320px" } }, [
      el("p.text-sm", { style: { margin: 0 } }, [
        el("strong", {}, "Todavía no hay ningún pedido. "),
        el("span.muted", {}, `Lo que ves es el mes simulado: ${figures.orders} pedidos con el mix «${MIX_PRESETS[state.sim.mix].label}». No es facturación, es un escenario.`),
      ]),
    ]),
    el("div.row", { style: { gap: "var(--space-2)", flexWrap: "wrap" } }, [
      el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: () => selectTab("simulador"),
      }, "Ajustar el escenario"),
      el("a.btn.btn--ghost.btn--sm", { href: "orders.html" }, "Generar un pedido"),
    ]),
  ]);
}

function renderSummary() {
  const figures = summaryFigures();
  const summary = catalogSummary(state.catalog, econOpts());
  const simulated = figures.source === "sim";
  const maxRevenue = Math.max(1, ...figures.categories.map((c) => c.revenue));

  return el("div.stack", { style: { "--stack-gap": "var(--space-5)" } }, [
    sourceBanner(figures),

    el("div.kpi-grid", {}, [
      kpi("Ingresos", money(figures.revenueGross), {
        note: simulated ? "mes simulado" : "pedidos cobrados",
        tone: simulated ? "" : "win",
      }),
      kpi("Beneficio bruto", money(figures.grossProfit), {
        note: "antes de publicidad",
        tone: figures.grossProfit >= 0 ? "win" : "loss",
      }),
      kpi("Margen bruto", percent(figures.marginRate), {
        note: `sobre ${money(figures.revenueNet)} netos, sin publicidad`,
      }),
      kpi("Pedidos", String(figures.orders), {
        note: figures.cancelled ? `${figures.cancelled} fuera del cómputo` : "en el periodo",
      }),
      kpi("Ticket medio", money(figures.averageOrderValue), { note: "IVA incluido" }),
      kpi("Unidades", String(figures.units), {
        note: figures.orders ? `${(figures.units / figures.orders).toFixed(2)} por pedido` : "—",
      }),
    ]),

    // The single most misread number on this page: the summary margin is gross,
    // the catalogue margin is after acquisition cost. Saying so once, here,
    // stops the two tabs looking like they contradict each other.
    el("p.text-xs.subtle", {}, [
      el("strong", {}, "Ojo con el margen: "),
      `arriba es bruto — ingreso neto menos proveedor y comisión, sin publicidad. En la pestaña de productos el margen ya descuenta el CAC de ${money(state.adCostPerOrder)}, y por eso sale bastante más bajo (${percent(summary.avgMarginRate, { decimals: 1 })} de media ponderada). El simulador es el único sitio donde ambas conviven en la misma cuenta.`,
    ]),

    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
        gap: "var(--space-5)",
        alignItems: "start",
      },
    }, [
      section(
        "Ingresos por categoría",
        simulated
          ? "Reparto del mes simulado. Cambia el mix en el simulador para ver otro escenario."
          : "Reparto de la facturación real entre las categorías del catálogo.",
        el("div", { style: { display: "grid", gap: "var(--space-4)", marginTop: "var(--space-4)" } },
          figures.categories.length
            ? figures.categories.map((c) =>
                barRow(
                  c.label,
                  money(c.revenue),
                  c.revenue / maxRevenue,
                  { hint: `${percent(c.share, { decimals: 1 })} del total · ${c.units} uds.` }
                )
              )
            : [el("p.text-sm.subtle", {}, "Sin ventas todavía.")]
        )
      ),

      section(
        "Salud del catálogo",
        `Veredicto de las ${summary.count} referencias con un CAC de ${money(state.adCostPerOrder)} y un objetivo del ${percent(state.targetMargin, { decimals: 0 })}.`,
        el("div", { style: { display: "grid", gap: "var(--space-4)", marginTop: "var(--space-4)" } }, [
          barRow("Escalar", `${summary.verdicts.escalar} referencias`, summary.verdicts.escalar / summary.count, { colour: "var(--win)" }),
          barRow("Vigilar", `${summary.verdicts.vigilar} referencias`, summary.verdicts.vigilar / summary.count, { colour: "var(--warn)" }),
          barRow("Retirar", `${summary.verdicts.retirar} referencias`, summary.verdicts.retirar / summary.count, { colour: "var(--loss)" }),
          el("hr.divider"),
          el("div.kpi-grid", { style: { gap: "var(--space-3)" } }, [
            kpi("Markup medio", `${summary.avgMarkup.toFixed(2)}×`, { note: "precio ÷ coste puesto en casa" }),
            kpi("Margen mediano", percent(summary.medianMarginRate), { note: "la referencia del medio" }),
            kpi("Stock a coste", money(summary.stockAtCost), { note: `${compact(summary.stockUnits)} uds.` }),
          ]),
        ])
      ),
    ]),

    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
        gap: "var(--space-5)",
        alignItems: "start",
      },
    }, [
      marginRanking("Los 5 mejores por margen", "Lo que hay que empujar en campaña.", summary.best),
      marginRanking("Los 5 peores por margen", "Candidatos a subir de precio, renegociar coste o retirar.", summary.worst),
    ]),
  ]);
}

/** Compact ranking table used twice on the summary tab. */
function marginRanking(title, lede, cards) {
  return section(title, lede, tableWrap(
    el("table.table", { style: { minWidth: "420px" } }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Producto"),
          el("th.num", {}, "Margen"),
          el("th.num", {}, "%"),
          el("th", {}, "Veredicto"),
        ]),
      ]),
      el("tbody", {}, cards.map((c) =>
        el("tr", {}, [
          el("td", {}, [
            el("a", { href: `product.html?slug=${encodeURIComponent(c.slug)}`, style: { color: "inherit", fontWeight: "600" } }, c.title),
            el("div.text-xs.subtle", {}, `${c.categoryLabel} · ${supplierName(c.supplierId)}`),
          ]),
          el("td.num", {}, [signedMoney(c.margin)]),
          el("td.num", { class: c.marginRate < 0 ? "text-loss" : "" }, percent(c.marginRate, { decimals: 1 })),
          el("td", {}, [verdictBadge(c.verdict)]),
        ])
      )),
    ])
  ), { flush: true });
}

/* --- Tab: PRODUCTOS -------------------------------------------------------- */

/** Escalar first when sorting by verdict: the actionable end of the list goes on top. */
const VERDICT_RANK = { escalar: 3, vigilar: 2, retirar: 1 };

/**
 * Table definition. Each column knows how to sort itself and how to draw itself,
 * so adding a column never means touching the sort code.
 * `num: true` gets right alignment and tabular figures from base.css.
 */
const PRODUCT_COLUMNS = [
  {
    key: "title",
    label: "Producto",
    sort: (c) => c.title.toLowerCase(),
    cell: (c) => el("td", { style: { minWidth: "190px" } }, [
      el("a", { href: `product.html?slug=${encodeURIComponent(c.slug)}`, style: { color: "inherit", fontWeight: "600" } }, c.title),
      el("div.text-xs.subtle", {}, `${c.brand} · ${c.categoryLabel}`),
    ]),
  },
  {
    key: "supplier",
    label: "Proveedor",
    sort: (c) => supplierName(c.supplierId).toLowerCase(),
    cell: (c) => el("td.text-sm", { style: { minWidth: "128px" } }, supplierName(c.supplierId)),
  },
  { key: "price", label: "Precio", num: true, sort: (c) => c.price, cell: (c) => el("td.num", {}, money(c.price)) },
  { key: "supplierCost", label: "Coste", num: true, sort: (c) => c.supplierCost, cell: (c) => el("td.num.muted", {}, money(c.supplierCost)) },
  {
    key: "supplierShipping",
    label: "Envío",
    hint: "Lo que el proveedor nos cobra por mandar la unidad",
    num: true,
    sort: (c) => c.supplierShipping,
    cell: (c) => el("td.num.muted", {}, c.supplierShipping ? money(c.supplierShipping) : "incluido"),
  },
  {
    key: "margin",
    label: "Margen",
    hint: "Contribución por unidad, ya descontados IVA, proveedor, comisión, CAC y reserva de reembolso",
    num: true,
    sort: (c) => c.margin,
    cell: (c) => el("td.num", {}, [signedMoney(c.margin)]),
  },
  {
    key: "marginRate",
    label: "%",
    hint: "Margen unitario sobre el ingreso neto",
    num: true,
    sort: (c) => c.marginRate,
    cell: (c) => el("td.num", { class: c.marginRate < 0 ? "text-loss" : "" }, percent(c.marginRate, { decimals: 1 })),
  },
  {
    key: "markup",
    label: "Markup",
    num: true,
    sort: (c) => c.markup,
    cell: (c) => el("td.num.muted", {}, `${c.markup.toFixed(2)}×`),
  },
  {
    key: "breakEvenRoas",
    label: "ROAS eq.",
    hint: "Euros de ingreso que debe devolver cada euro de publicidad para no perder dinero",
    num: true,
    // `null` means unreachable at any spend — sorts to the worst end, not the top.
    sort: (c) => (c.breakEvenRoas === null ? Infinity : c.breakEvenRoas),
    cell: (c) => el("td.num", {
      class: c.breakEvenRoas === null || c.breakEvenRoas > VERDICT_CRITERIA.scaleRoasCeiling ? "text-loss" : "",
      title: "Euros de ingreso que debe devolver cada euro de publicidad para no perder dinero.",
    }, roasText(c.breakEvenRoas)),
  },
  {
    key: "suggestedPrice",
    label: "Sugerido",
    hint: "Precio que alcanzaría el margen objetivo con este CAC, redondeado al ,99 superior",
    num: true,
    sort: (c) => c.suggestedPrice,
    cell: (c) => el("td.num", { title: `Precio que alcanzaría el ${percent(c.targetMargin, { decimals: 0 })} con este CAC, redondeado al ,99 superior.` }, money(c.suggestedPrice)),
  },
  {
    key: "priceGap",
    label: "Desvío",
    hint: "Diferencia entre el precio actual y el sugerido",
    num: true,
    sort: (c) => c.priceGapRate,
    // Positive = we already charge above what the target needs. Negative = the
    // price is short of the target and that gap is the work to be done.
    cell: (c) => el("td.num", { class: c.priceGap < 0 ? "text-loss" : "text-win" }, [
      el("span", {}, `${c.priceGap >= 0 ? "+" : "−"}${money(Math.abs(c.priceGap))}`),
      el("div.text-xs.subtle", {}, percent(c.priceGapRate, { decimals: 1 })),
    ]),
  },
  {
    key: "verdict",
    label: "Veredicto",
    sort: (c) => VERDICT_RANK[c.verdict],
    // The reasons live in the tooltip, not in a second visible line: printed,
    // they pushed a twelve-column table past any laptop screen, and the policy
    // behind them is spelled out in full under the table anyway.
    cell: (c) => el("td", {}, [
      el(`span.badge.${VERDICT_TONE[c.verdict]}`, {
        title: c.reasons.map((r) => r.text).join(" "),
      }, VERDICT_LABEL[c.verdict]),
    ]),
  },
];

function sortCards(cards) {
  const column = PRODUCT_COLUMNS.find((c) => c.key === state.sort.key) ?? PRODUCT_COLUMNS[0];
  const direction = state.sort.dir === "asc" ? 1 : -1;
  return [...cards].sort((a, b) => {
    const av = column.sort(a);
    const bv = column.sort(b);
    if (av === bv) return a.title.localeCompare(b.title, "es");
    return av > bv ? direction : -direction;
  });
}

function toggleSort(key) {
  // First click on a new column sorts descending: for money columns "biggest
  // first" is the question being asked nine times out of ten.
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === "desc" ? "asc" : "desc" }
    : { key, dir: "desc" };
  paintProducts();
  $(`[data-sort-key="${key}"]`)?.focus();
}

const SORT_GLYPH = { asc: "▲", desc: "▼" };

function sortHeader(column) {
  const active = state.sort.key === column.key;
  return el("th", {
    class: column.num ? "num" : "",
    scope: "col",
    "aria-sort": active ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none",
  }, [
    el("button", {
      type: "button",
      dataset: { sortKey: column.key },
      onclick: () => toggleSort(column.key),
      "aria-label": `Ordenar por ${column.label}`,
      title: column.hint ?? null,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        width: "100%",
        justifyContent: column.num ? "flex-end" : "flex-start",
        padding: 0,
        border: 0,
        background: "none",
        font: "inherit",
        letterSpacing: "inherit",
        textTransform: "inherit",
        color: active ? "var(--accent)" : "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
      },
    }, [
      el("span", {}, column.label),
      el("span", { "aria-hidden": "true", style: { opacity: active ? "1" : "0.25" } }, active ? SORT_GLYPH[state.sort.dir] : "▼"),
    ]),
  ]);
}

/** Weighted totals row. A mean of percentages would let a 3 € keyring outvote a 60 € headphone. */
function totalsRow(cards) {
  const sum = (fn) => cards.reduce((a, c) => a + fn(c), 0);
  const revenueNet = sum((c) => c.revenueNet);
  const margin = sum((c) => c.margin);

  const cells = PRODUCT_COLUMNS.map((column) => {
    switch (column.key) {
      case "title": return el("td", {}, [el("strong", {}, `${cards.length} referencias`)]);
      case "price": return el("td.num", {}, [el("strong", {}, money(sum((c) => c.price)))]);
      case "supplierCost": return el("td.num", {}, [el("strong", {}, money(sum((c) => c.supplierCost)))]);
      case "supplierShipping": return el("td.num", {}, [el("strong", {}, money(sum((c) => c.supplierShipping)))]);
      case "margin": return el("td.num", {}, [el("strong", {}, [signedMoney(margin)])]);
      case "marginRate": return el("td.num", {}, [el("strong", {}, percent(revenueNet > 0 ? margin / revenueNet : 0, { decimals: 1 }))]);
      default: return el("td", {}, "");
    }
  });

  return el("tfoot", {}, [el("tr", { style: { borderTop: "2px solid var(--border-strong)" } }, cells)]);
}

/* --- Live controls (built once) -------------------------------------------- */

const productsOutput = el("div");

const cacField = sliderField({
  id: "admin-cac",
  label: "Coste de adquisición por pedido (CAC)",
  hint: "Lo que cuesta traer un pedido: anuncios, influencer, cupón. Se carga entero a cada unidad.",
  min: 0, max: 30, step: 0.5,
  value: state.adCostPerOrder / 100,
  suffix: "€",
  onInput: (euros) => {
    state.adCostPerOrder = Math.round(euros * 100);
    persist();
    paintProducts();
    renderHeadline();
  },
});

const targetField = sliderField({
  id: "admin-target",
  label: "Margen objetivo sobre ingreso neto",
  hint: "Contribución que queremos después de proveedor, comisión y publicidad. El precio sugerido resuelve para este número.",
  min: 5, max: 70, step: 1,
  value: Math.round(state.targetMargin * 100),
  suffix: "%",
  onInput: (pct) => {
    state.targetMargin = pct / 100;
    persist();
    paintProducts();
    renderHeadline();
  },
});

const fileInput = el("input", {
  type: "file",
  accept: ".csv,text/csv",
  "aria-label": "Seleccionar un archivo CSV con los precios a importar",
  style: { display: "none" },
  onchange: (ev) => importCsv(ev.target.files?.[0] ?? null),
});

const productsShell = el("div.stack", { style: { "--stack-gap": "var(--space-5)" } }, [
  el("div.card.card--pad", {}, [
    el("h2", { style: { fontSize: "var(--text-lg)" } }, "Supuestos de la campaña"),
    el("p.text-sm.muted", { style: { marginTop: "var(--space-2)", maxWidth: "76ch" } },
      "Estos dos números recalculan toda la tabla al instante: el margen, el ROAS de equilibrio, el precio sugerido y el veredicto de cada referencia. Súbelos hasta que el catálogo se ponga rojo y sabrás cuánto aguanta el negocio."),
    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        gap: "var(--space-5)",
        marginTop: "var(--space-5)",
      },
    }, [cacField, targetField]),

    el("hr.divider", { style: { margin: "var(--space-5) 0 var(--space-4)" } }),

    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportCsv },
        [icon("external", { size: 16 }), el("span", {}, "Exportar catálogo (CSV)")]),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => fileInput.click() },
        [icon("refresh", { size: 16 }), el("span", {}, "Importar precios (CSV)")]),
      fileInput,
      el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: () => {
          state.adCostPerOrder = DEFAULT_CAC;
          state.targetMargin = DEFAULT_TARGET_MARGIN;
          state.catalog = products.map((p) => ({ ...p }));
          state.imported = false;
          persist();
          resetControlValues();
          paintProducts();
          renderHeadline();
          toast("Supuestos y catálogo restaurados.", { variant: "info" });
        },
      }, "Restablecer"),
      el("span.spacer.hide-sm"),
      el("span.text-xs.subtle", {},
        `Columnas editables: ${EDITABLE_COLUMNS.join(", ")}. En céntimos enteros.`),
    ]),
  ]),

  productsOutput,
]);

/** Push state back into the two number/range pairs after a programmatic reset. */
function resetControlValues() {
  const write = (selector, value) => {
    for (const node of [$(`#${selector}`), $(`#${selector}`)?.parentElement?.querySelector("input[type=range]")]) {
      if (node) node.value = String(value);
    }
  };
  write("admin-cac", state.adCostPerOrder / 100);
  write("admin-target", Math.round(state.targetMargin * 100));
}

function paintProducts() {
  const cards = state.catalog.map((p) => productScorecard(p, econOpts()));
  const sorted = sortCards(cards);
  const counts = cards.reduce((acc, c) => ({ ...acc, [c.verdict]: acc[c.verdict] + 1 }), { escalar: 0, vigilar: 0, retirar: 0 });

  replace(productsOutput, [
    el("div.card.card--flush", {}, [
      el("div.row.row--between.row--wrap", { style: { gap: "var(--space-3)", padding: "var(--space-5) var(--space-5) var(--space-4)" } }, [
        el("div", { style: { minWidth: "0" } }, [
          el("h2", { style: { fontSize: "var(--text-lg)" } }, "Catálogo completo"),
          el("p.text-sm.muted", { style: { marginTop: "var(--space-2)" } },
            `${cards.length} referencias con CAC ${money(state.adCostPerOrder)} y objetivo ${percent(state.targetMargin, { decimals: 0 })}. Pulsa una cabecera para ordenar.`),
        ]),
        el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, [
          el("span.badge.badge--win", {}, `${counts.escalar} escalar`),
          el("span.badge.badge--warn", {}, `${counts.vigilar} vigilar`),
          el("span.badge.badge--loss", {}, `${counts.retirar} retirar`),
        ]),
      ]),

      state.imported
        ? el("p.text-xs", {
            style: { padding: "0 var(--space-5) var(--space-3)", color: "var(--warn)" },
          }, "Catálogo modificado por una importación CSV. Los cambios viven solo en esta pestaña; la tienda sigue con sus precios.")
        : null,

      tableWrap(
        el("table.table", { style: { minWidth: "1180px" } }, [
          el("thead", {}, [el("tr", {}, PRODUCT_COLUMNS.map(sortHeader))]),
          el("tbody", {}, sorted.map((card) => el("tr", {}, PRODUCT_COLUMNS.map((column) => column.cell(card))))),
          totalsRow(cards),
        ])
      ),

      el("div", { style: { padding: "var(--space-4) var(--space-5) var(--space-5)" } }, [
        el("h3", { style: { fontSize: "var(--text-sm)" } }, "Cómo se decide el veredicto"),
        el("ul.text-xs.muted", { style: { marginTop: "var(--space-2)", paddingLeft: "1.1rem", display: "grid", gap: "var(--space-1)" } }, [
          el("li", {}, [el("strong.text-win", {}, "Escalar: "), VERDICT_RULE_TEXT.escalar]),
          el("li", {}, [el("strong.text-loss", {}, "Retirar: "), VERDICT_RULE_TEXT.retirar]),
          el("li", {}, [el("strong", { style: { color: "var(--warn)" } }, "Vigilar: "), VERDICT_RULE_TEXT.vigilar]),
          el("li", {}, `El margen unitario ya descuenta IVA, coste del proveedor, su envío, la comisión de pago (${percent(PAYMENT_FEE.rate, { decimals: 1 })} + ${money(PAYMENT_FEE.fixed)}), el CAC y una reserva del ${percent(DEFAULT_REFUND_RATE, { decimals: 0 })} para reembolsos.`),
        ]),
      ]),
    ]),
  ]);
}

function renderProducts() {
  paintProducts();
  return productsShell;
}

/* --- CSV import / export ---------------------------------------------------- */

function exportCsv() {
  const csv = toCsv(catalogRows(state.catalog));
  // A BOM so Excel in Spanish opens the file as UTF-8 instead of mangling the
  // accents — the single most common complaint about CSV exports in ES.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: `nexytt-catalogo-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`${state.catalog.length} referencias exportadas con ${CATALOG_COLUMNS.length} columnas.`, { variant: "win", title: "CSV generado" });
}

async function importCsv(file) {
  if (!file) return;
  try {
    // Strip the BOM our own export writes, otherwise the first header becomes "﻿id".
    const text = (await file.text()).replace(/^﻿/, "");
    const rows = parseCsv(text);
    if (!rows.length) {
      toast("El archivo no tiene ninguna fila de datos.", { variant: "warn", title: "CSV vacío" });
      return;
    }

    const result = applyCatalogRows(state.catalog, rows);
    if (!result.changes.length) {
      toast(`Leídas ${rows.length} filas, ningún precio distinto del actual.`, { variant: "info", title: "Sin cambios" });
    } else {
      state.catalog = result.products;
      state.imported = true;
      paintProducts();
      renderHeadline();
      const detail = [
        `${result.changes.length} valores actualizados`,
        result.invalid.length ? `${result.invalid.length} descartados` : "",
        result.unknown.length ? `${result.unknown.length} ids desconocidos` : "",
      ].filter(Boolean).join(" · ");
      toast(detail, { variant: "win", title: "Catálogo actualizado" });
    }
  } catch (error) {
    toast("No se ha podido leer el archivo. Debe ser un CSV de texto.", { variant: "loss", title: "Importación fallida" });
    console.warn("CSV import failed", error);
  } finally {
    // Reset the input so re-selecting the same file fires `change` again.
    fileInput.value = "";
  }
}

/* --- Tab: PROVEEDORES ------------------------------------------------------ */

/** One factor bar inside a supplier card, showing the raw rate and how close it is to its ceiling. */
function riskFactor(label, rawText, ratio, ceilingText) {
  const colour = ratio >= 0.66 ? "var(--loss)" : ratio >= 0.33 ? "var(--warn)" : "var(--win)";
  return barRow(label, rawText, ratio, { hint: `${percent(ratio, { decimals: 0 })} del techo tolerable (${ceilingText})`, colour });
}

function supplierCard(card) {
  const { supplier } = card;
  const { weights } = RISK_MODEL;

  return el("article.card.card--pad", { style: { display: "grid", gap: "var(--space-5)", alignContent: "start" } }, [
    el("div.row.row--between.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("div", { style: { minWidth: "0" } }, [
        el("h3", { style: { fontSize: "var(--text-lg)" } }, supplier.name),
        el("p.text-xs.subtle", { style: { marginTop: "var(--space-1)" } },
          `${supplier.platform} · ${supplier.country} · desde ${supplier.since} · ${supplier.paymentTerms}`),
      ]),
      el("div", { style: { textAlign: "right", flex: "none" } }, [
        el(`span.badge.${card.band.tone}`, {}, `${card.band.label} · ${card.riskScore}/100`),
        el("div.text-xs.subtle", { style: { marginTop: "var(--space-1)" } }, `★ ${supplier.rating.toFixed(1)}`),
      ]),
    ]),

    el("div.kpi-grid", { style: { gap: "var(--space-3)" } }, [
      kpi("Referencias", String(card.productCount), { note: `${card.stockUnits} uds. en stock` }),
      kpi("Coste del surtido", money(card.totalCost), { note: "una unidad de cada" }),
      kpi("Plazo de entrega", `${card.leadTimeDays[0]}–${card.leadTimeDays[1]} d`, { note: `media ${card.avgLeadDays} días` }),
      kpi("Margen medio", percent(card.avgMarginRate), {
        note: `${card.verdicts.escalar} escalar / ${card.verdicts.retirar} retirar`,
        tone: card.avgMarginRate > 0 ? "win" : "loss",
      }),
    ]),

    el("div", { style: { display: "grid", gap: "var(--space-4)" } }, [
      el("h4", { style: { fontSize: "var(--text-sm)" } }, "De dónde viene el riesgo"),
      riskFactor(
        `Defectuosos (peso ${percent(weights.defectRate, { decimals: 0 })})`,
        percent(card.defectRate, { decimals: 1 }),
        card.riskFactors.defectRate,
        percent(RISK_MODEL.ceilings.defectRate, { decimals: 0 })
      ),
      riskFactor(
        `Disputas (peso ${percent(weights.disputeRate, { decimals: 0 })})`,
        percent(card.disputeRate, { decimals: 1 }),
        card.riskFactors.disputeRate,
        percent(RISK_MODEL.ceilings.disputeRate, { decimals: 0 })
      ),
      riskFactor(
        `Plazo peor caso (peso ${percent(weights.leadTime, { decimals: 0 })})`,
        `${card.maxLeadDays} días`,
        card.riskFactors.leadTime,
        `${RISK_MODEL.ceilings.leadTimeDays} días`
      ),
      el("p.text-xs.subtle", {}, [
        el("strong", {}, "Exposición: "),
        `${money(card.stockAtCost)} de stock pagado a este proveedor. Si deja de servir, hay que reubicar ${card.productCount} referencias.`,
      ]),
    ]),

    tableWrap(
      el("table.table", { style: { minWidth: "480px" } }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col" }, "Le compramos"),
            el("th.num", { scope: "col" }, "Coste"),
            el("th.num", { scope: "col" }, "Precio"),
            el("th.num", { scope: "col" }, "Margen"),
            el("th", { scope: "col" }, "Veredicto"),
          ]),
        ]),
        el("tbody", {}, card.products.map((p) =>
          el("tr", {}, [
            el("td", {}, [
              el("a", { href: `product.html?slug=${encodeURIComponent(p.slug)}`, style: { color: "inherit" } }, p.title),
            ]),
            el("td.num.muted", {}, money(p.landedCost)),
            el("td.num", {}, money(p.price)),
            el("td.num", {}, [signedMoney(p.margin)]),
            el("td", {}, [verdictBadge(p.verdict)]),
          ])
        )),
      ])
    ),

    el("p.text-xs.subtle", { style: { margin: 0 } }, supplier.notes),
  ]);
}

function renderSuppliers() {
  const cards = suppliers
    .map((s) => supplierScorecard(s, state.catalog, econOpts()))
    .sort((a, b) => b.risk - a.risk);

  const worst = cards[0];

  return el("div.stack", { style: { "--stack-gap": "var(--space-5)" } }, [
    el("div.card.card--pad", {}, [
      el("h2", { style: { fontSize: "var(--text-lg)" } }, "Riesgo de proveedor"),
      el("p.text-sm.muted", { style: { marginTop: "var(--space-2)", maxWidth: "80ch" } }, [
        "En dropshipping el proveedor es el producto: el plazo y la tasa de defectos mueven la cuenta de resultados más que el precio de venta. ",
        `El riesgo es un compuesto 0–100 de tres factores normalizados contra su techo tolerable y ponderados `,
        `${percent(RISK_MODEL.weights.defectRate, { decimals: 0 })} defectos, `,
        `${percent(RISK_MODEL.weights.disputeRate, { decimals: 0 })} disputas y `,
        `${percent(RISK_MODEL.weights.leadTime, { decimals: 0 })} plazo. `,
        "Ordenados de peor a mejor: el de arriba es el que hay que sustituir primero.",
      ]),
      el("div.kpi-grid", { style: { marginTop: "var(--space-5)" } }, [
        kpi("Proveedores", String(cards.length), { note: `${cards.filter((c) => c.band.id === "alto").length} en riesgo alto` }),
        kpi("Mayor riesgo", worst?.name ?? "—", { note: `${worst?.riskScore ?? 0}/100`, tone: "loss" }),
        kpi("Stock a coste", money(cards.reduce((n, c) => n + c.stockAtCost, 0)), { note: "capital inmovilizado" }),
        kpi("Plazo más largo", `${Math.max(...cards.map((c) => c.maxLeadDays))} d`, { note: "peor caso del catálogo" }),
      ]),
    ]),

    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
        gap: "var(--space-5)",
        alignItems: "start",
      },
    }, cards.map(supplierCard)),
  ]);
}

/* --- Tab: PEDIDOS ---------------------------------------------------------- */

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

/**
 * Purchase orders still sitting on our side. `createOrder` opens every PO as
 * "queued"; `routeToSuppliers` is what turns them into an accepted parcel with
 * a carrier and a tracking number. Anything still queued is money already
 * collected from a customer whose goods nobody has ordered yet.
 */
function pendingPurchaseOrders(orders) {
  return orders.flatMap((order) =>
    (order.purchaseOrders ?? [])
      .filter((po) => po.status === "queued" && order.status !== "cancelled" && order.status !== "refunded")
      .map((po) => ({ order, po }))
  );
}

function routePurchaseOrder(order) {
  // The state machine owns the rules; the button only asks whether it may.
  if (!canTransition(order.status, "routing")) {
    toast(`Un pedido en «${STATUS_LABEL[order.status]}» no se puede enrutar todavía.`, { variant: "warn", title: "Transición no válida" });
    return;
  }
  const routed = routeToSuppliers(order);
  saveOrder(routed);
  renderTab();
  renderHeadline();
  toast(`${routed.purchaseOrders.length} orden(es) de compra enviadas con número de seguimiento.`, {
    variant: "win",
    title: `${routed.reference} enrutado`,
  });
}

function ordersEmptyState() {
  return el("div.card", {}, [
    el("div.empty", {}, [
      el("div.empty__icon", { "aria-hidden": "true" }, [icon("package", { size: 40 })]),
      el("h2", { style: { color: "var(--fg)", fontSize: "var(--text-lg)" } }, "Ningún pedido todavía"),
      el("p.text-sm", { style: { marginTop: "var(--space-2)", maxWidth: "56ch", marginInline: "auto" } },
        "El libro de pedidos vive en este navegador. Pasa por el carrito o genera uno de ejemplo desde «Mis pedidos» y volverá aquí con su margen calculado."),
      el("div.row.row--wrap", { style: { gap: "var(--space-3)", justifyContent: "center", marginTop: "var(--space-5)" } }, [
        el("a.btn.btn--primary", { href: "orders.html" }, [icon("sparkle", { size: 18 }), el("span", {}, "Generar un pedido de ejemplo")]),
        el("a.btn.btn--ghost", { href: "index.html" }, "Ir al catálogo"),
      ]),
    ]),
  ]);
}

function renderOrders() {
  const orders = listOrders();
  if (!orders.length) return ordersEmptyState();

  const agg = aggregateEconomics(orders);
  const pending = pendingPurchaseOrders(orders);
  const pendingCost = pending.reduce((n, { po }) => n + po.cost, 0);

  return el("div.stack", { style: { "--stack-gap": "var(--space-5)" } }, [
    el("div.kpi-grid", {}, [
      kpi("Pedidos vivos", String(agg.orders), { note: agg.cancelled ? `${agg.cancelled} cancelados o reembolsados` : "ninguno cancelado" }),
      kpi("Facturación", money(agg.revenueGross), { note: `${money(agg.tax)} de IVA` }),
      kpi("Coste de mercancía", money(agg.goodsCost), { note: `+ ${money(agg.processingFees)} de comisiones` }),
      kpi("Beneficio bruto", money(agg.grossProfit), { note: percent(agg.marginRate), tone: agg.grossProfit >= 0 ? "win" : "loss" }),
    ]),

    section(
      "Órdenes de compra pendientes de enviar",
      pending.length
        ? `${pending.length} orden(es) por ${money(pendingCost)} esperando a que alguien las mande al proveedor. Hasta que se enruten, el cliente ha pagado y nadie ha comprado la mercancía.`
        : "Todas las órdenes de compra están enrutadas. Cada paquete tiene transportista y número de seguimiento.",
      pending.length
        ? tableWrap(el("table.table", { style: { minWidth: "700px" } }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { scope: "col" }, "Orden de compra"),
                el("th", { scope: "col" }, "Proveedor"),
                el("th.num", { scope: "col" }, "Líneas"),
                el("th.num", { scope: "col" }, "Coste"),
                el("th", { scope: "col" }, "Pedido"),
                el("th", { scope: "col" }, "Acción"),
              ]),
            ]),
            el("tbody", {}, pending.map(({ order, po }) => {
              const routable = canTransition(order.status, "routing");
              return el("tr", {}, [
                el("td.mono.text-xs", { style: { overflowWrap: "anywhere" } }, po.id),
                el("td.text-sm", {}, supplierName(po.supplierId)),
                el("td.num", {}, String(po.lines.length)),
                el("td.num", {}, money(po.cost)),
                el("td", {}, [
                  el("a.mono.text-xs", { href: `order.html?ref=${encodeURIComponent(order.reference)}`, style: { color: "inherit" } }, order.reference),
                  el("div", { style: { marginTop: "var(--space-1)" } }, [
                    el(`span.badge.${STATUS_TONE[order.status] ?? "badge"}`, {}, STATUS_LABEL[order.status]),
                  ]),
                ]),
                el("td", {}, [
                  el("button.btn.btn--primary.btn--sm", {
                    type: "button",
                    disabled: !routable,
                    title: routable
                      ? "Simula la llamada a la API del proveedor: asigna transportista y número de seguimiento."
                      : "El pedido tiene que estar pagado para poder enrutarlo.",
                    "aria-label": `Enrutar la orden ${po.id} a ${supplierName(po.supplierId)}`,
                    onclick: () => routePurchaseOrder(order),
                  }, [icon("truck", { size: 16 }), el("span", {}, "Enrutar")]),
                ]),
              ]);
            })),
          ]))
        : el("p.text-sm.subtle", { style: { padding: "0 var(--space-5) var(--space-5)" } }, "Nada que hacer aquí."),
      { flush: true }
    ),

    section(
      "Margen pedido a pedido",
      "Cifras congeladas en el momento de la compra: si mañana sube el coste del proveedor, este pedido sigue contando lo que costó de verdad.",
      tableWrap(el("table.table", { style: { minWidth: "860px" } }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col" }, "Referencia"),
            el("th", { scope: "col" }, "Fecha"),
            el("th", { scope: "col" }, "Estado"),
            el("th.num", { scope: "col" }, "Uds."),
            el("th.num", { scope: "col" }, "Bruto"),
            el("th.num", { scope: "col" }, "Neto"),
            el("th.num", { scope: "col" }, "Mercancía"),
            el("th.num", { scope: "col" }, "Comisión"),
            el("th.num", { scope: "col" }, "Margen"),
            el("th.num", { scope: "col" }, "%"),
          ]),
        ]),
        el("tbody", {}, orders.map((order) => {
          const e = order.economics;
          const dead = order.status === "cancelled" || order.status === "refunded";
          return el("tr", { style: dead ? { opacity: "0.55" } : {} }, [
            el("td", {}, [
              el("a.mono.text-xs", { href: `order.html?ref=${encodeURIComponent(order.reference)}`, style: { color: "inherit", overflowWrap: "anywhere" } }, order.reference),
            ]),
            el("td.text-xs.muted", { style: { whiteSpace: "nowrap" } }, dateOnly(order.createdAt)),
            el("td", {}, [el(`span.badge.${STATUS_TONE[order.status] ?? "badge"}`, {}, STATUS_LABEL[order.status])]),
            el("td.num", {}, String(order.lines.reduce((n, l) => n + l.qty, 0))),
            el("td.num", {}, money(e.revenueGross)),
            el("td.num.muted", {}, money(e.revenueNet)),
            el("td.num.muted", {}, money(e.goodsCost)),
            el("td.num.muted", {}, money(e.processingFee)),
            el("td.num", {}, [dead ? el("span.muted", {}, "—") : signedMoney(e.grossProfit)]),
            el("td.num", { class: e.grossProfit < 0 ? "text-loss" : "" }, dead ? "—" : percent(e.marginRate, { decimals: 1 })),
          ]);
        })),
      ])),
      { flush: true }
    ),

    el("p.text-xs.subtle", {},
      "El margen por pedido no descuenta publicidad: el pedido no sabe cuánto costó traerlo. Ese descuento se hace en el simulador, donde el gasto es una entrada."),
  ]);
}

/* --- Tab: SIMULADOR -------------------------------------------------------- */

const simOutput = el("div");

const simOrdersField = sliderField({
  id: "sim-orders",
  label: "Pedidos al mes",
  hint: "Volumen que asumimos vender. Un pedido, una unidad.",
  min: 0, max: 2000, step: 10,
  value: state.sim.orders,
  onInput: (value) => {
    state.sim.orders = Math.round(value);
    persist();
    paintSimulator();
    renderHeadline();
  },
});

const simSpendField = sliderField({
  id: "sim-spend",
  label: "Gasto en publicidad",
  hint: "Presupuesto mensual de campañas. Es coste fijo del mes, no por pedido.",
  min: 0, max: 20000, step: 100,
  value: state.sim.adSpend / 100,
  suffix: "€",
  onInput: (euros) => {
    state.sim.adSpend = Math.round(euros * 100);
    persist();
    paintSimulator();
    renderHeadline();
  },
});

const simRefundField = sliderField({
  id: "sim-refund",
  label: "Tasa de reembolso",
  hint: "Porcentaje de pedidos que acaban devueltos. Por debajo del 2% no es realista con envío desde China.",
  min: 0, max: 15, step: 0.5,
  value: +(state.sim.refundRate * 100).toFixed(1),
  suffix: "%",
  onInput: (pct) => {
    state.sim.refundRate = pct / 100;
    persist();
    paintSimulator();
  },
});

const mixSelect = el("select.select", {
  id: "sim-mix",
  onchange: () => {
    state.sim.mix = mixSelect.value;
    persist();
    paintSimulator();
  },
}, Object.values(MIX_PRESETS).map((preset) =>
  el("option", { value: preset.id, selected: preset.id === state.sim.mix }, preset.label)
));

const mixHint = el("p.field__hint", {}, MIX_PRESETS[state.sim.mix].hint);

const simShell = el("div.stack", { style: { "--stack-gap": "var(--space-5)" } }, [
  el("div.card.card--pad", {}, [
    el("h2", { style: { fontSize: "var(--text-lg)" } }, "Escenario del mes"),
    el("p.text-sm.muted", { style: { marginTop: "var(--space-2)", maxWidth: "80ch" } }, [
      "Cuatro entradas y una cuenta de resultados completa. Cada línea dice de dónde sale, ",
      "y las líneas suman exactamente el beneficio: no hay ningún ajuste escondido. ",
      `Se asume envío gratis para el cliente (lo es a partir de ${money(SHIPPING_ZONES.ES_PENINSULA.freeOver)} en península) `,
      "y el envío del proveedor cargado como coste, así que el escenario peca de pesimista, no de optimista.",
    ]),
    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
        gap: "var(--space-5)",
        marginTop: "var(--space-5)",
      },
    }, [
      simOrdersField,
      simSpendField,
      simRefundField,
      el("div.field", { style: { minWidth: "0" } }, [
        el("label.label", { for: "sim-mix" }, "Mix de productos"),
        mixSelect,
        mixHint,
      ]),
    ]),
  ]),

  simOutput,
]);

/** The P&L, rendered so a subtotal and a total read differently from a line item. */
function profitAndLoss(sim) {
  const rowStyle = (kind) => {
    if (kind === "total") return { borderTop: "2px solid var(--border-strong)", fontWeight: "800" };
    if (kind === "subtotal") return { borderTop: "1px solid var(--border-strong)", fontWeight: "700" };
    return {};
  };

  return tableWrap(el("table.table", { style: { minWidth: "620px" } }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col" }, "Concepto"),
        el("th", { scope: "col" }, "De dónde sale"),
        el("th.num", { scope: "col" }, "Importe"),
      ]),
    ]),
    el("tbody", {}, sim.lines.map((line) =>
      el("tr", { style: rowStyle(line.kind) }, [
        el("td", { style: { minWidth: "170px" } }, [
          el("span", {}, line.label),
          el("div.text-xs.subtle", { style: { fontWeight: "400", maxWidth: "44ch" } }, line.note),
        ]),
        el("td.mono.text-xs.muted", { style: { textAlign: "left", minWidth: "180px" } }, line.formula),
        el("td.num", {
          class: line.kind === "total" ? (line.amount >= 0 ? "text-win" : "text-loss") : "",
          style: { whiteSpace: "nowrap" },
        }, money(line.amount)),
      ])
    )),
  ]));
}

function paintSimulator() {
  const sim = simulateMonth(state.catalog, { ...state.sim, targetMargin: state.targetMargin });
  mixHint.textContent = MIX_PRESETS[state.sim.mix].hint;

  const profitable = sim.profit >= 0;
  const shortfall = sim.breakEvenOrders === null ? null : sim.breakEvenOrders - sim.orders;

  replace(simOutput, [
    el("div.kpi-grid", {}, [
      kpi("Beneficio del mes", money(sim.profit), {
        note: profitable ? "el mes cierra en positivo" : "el mes cierra en pérdidas",
        tone: profitable ? "win" : "loss",
      }),
      kpi("Margen neto", percent(sim.marginRate), { note: `sobre ${money(sim.revenueNet)} netos` }),
      kpi("ROAS actual", sim.roas === null ? "sin gasto" : `${sim.roas.toFixed(2)}×`, {
        note: `${money(sim.adCostPerOrder)} de CAC por pedido`,
      }),
      kpi("ROAS necesario", roasText(sim.breakEvenRoas), {
        note: "para no perder dinero",
        tone: sim.roas !== null && sim.breakEvenRoas !== null && sim.roas >= sim.breakEvenRoas ? "win" : "loss",
      }),
      kpi("Punto de equilibrio", sim.breakEvenOrders === null ? "—" : String(sim.breakEvenOrders), {
        note: shortfall === null
          ? "ningún volumen cubre el gasto"
          : shortfall <= 0 ? `pedidos · ${Math.abs(shortfall)} de colchón` : `pedidos · faltan ${shortfall}`,
        tone: shortfall !== null && shortfall <= 0 ? "win" : "loss",
      }),
      kpi("CAC máximo", money(sim.maxCacPerOrder), { note: "lo máximo pagable por pedido" }),
    ]),

    section(
      "Cuenta de resultados del mes",
      `${sim.orders} pedidos · ticket medio ${money(sim.averageOrderValue)} · mix «${MIX_PRESETS[state.sim.mix].label}»${sim.mixCollapsed ? " (ningún producto tiene contribución positiva con este CAC: se ha repartido a partes iguales)" : ""}.`,
      [
        profitAndLoss(sim),
        el("div", { style: { padding: "var(--space-4) var(--space-5) var(--space-5)", display: "grid", gap: "var(--space-3)" } }, [
          el("p.text-xs", { class: sim.check.balanced ? "text-win" : "text-loss" }, [
            icon(sim.check.balanced ? "check" : "close", { size: 14 }),
            el("span", { style: { marginLeft: "var(--space-2)" } },
              sim.check.balanced
                ? "Comprobado: las líneas de ingreso y coste suman exactamente el beneficio, sin desviación de redondeo."
                : `Descuadre de ${money(sim.check.delta)}. Esto es un error, no un redondeo.`),
          ]),
          el("p.text-xs.subtle", {},
            `Reembolsos: ${sim.refundedOrders} pedidos al ${percent(sim.refundRate, { decimals: 1 })}. Solo se anula su ingreso neto; su mercancía y su comisión siguen contadas arriba porque no vuelven.`),
        ]),
      ],
      { flush: true }
    ),

    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
        gap: "var(--space-5)",
        alignItems: "start",
      },
    }, [
      section("De dónde sale el punto de equilibrio", null, breakEvenExplainer(sim)),
      section(
        "Reparto del volumen",
        "Los diez productos que más facturan en este escenario.",
        tableWrap(el("table.table", { style: { minWidth: "440px" } }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { scope: "col" }, "Producto"),
              el("th.num", { scope: "col" }, "Pedidos"),
              el("th.num", { scope: "col" }, "Bruto"),
              el("th.num", { scope: "col" }, "Contribución"),
            ]),
          ]),
          el("tbody", {}, sim.byProduct.slice(0, 10).map((line) =>
            el("tr", {}, [
              el("td.text-sm", {}, [
                el("a", { href: `product.html?slug=${encodeURIComponent(line.product.slug)}`, style: { color: "inherit" } }, line.product.title),
              ]),
              el("td.num", {}, String(line.orders)),
              el("td.num", {}, money(line.revenueGross)),
              el("td.num", {}, [signedMoney(line.contribution)]),
            ])
          )),
        ])),
        { flush: true }
      ),
    ]),
  ]);
}

/**
 * The break-even walk-through. This is the part of the page that has to be
 * followable with a pen: each step shows its own arithmetic.
 */
function breakEvenExplainer(sim) {
  const contribution = Math.round(sim.contributionPerOrder);
  const steps = [
    ["1. Ingreso neto por pedido", money(sim.orders ? Math.round(sim.revenueNet / sim.orders) : 0), `ticket ${money(sim.averageOrderValue)} menos el IVA`],
    ["2. Menos mercancía y comisión", money(sim.orders ? -Math.round((sim.cogs + sim.fees) / sim.orders) : 0), "coste del proveedor, su envío y la pasarela"],
    ["3. Menos reembolsos", money(sim.orders ? -Math.round(sim.refundLoss / sim.orders) : 0), `${percent(sim.refundRate, { decimals: 1 })} del ingreso neto`],
    ["4. Contribución por pedido", money(contribution), "lo que queda para pagar la publicidad"],
    ["5. Publicidad del mes", money(sim.adSpend), "coste fijo a cubrir"],
  ];

  return el("div", { style: { display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" } }, [
    ...steps.map(([label, value, note], i) =>
      el("div.row.row--between", {
        style: {
          gap: "var(--space-3)",
          paddingTop: i === 3 ? "var(--space-3)" : "0",
          borderTop: i === 3 ? "1px solid var(--border-strong)" : "0",
        },
      }, [
        el("div", { style: { minWidth: "0" } }, [
          el("span.text-sm", { style: { fontWeight: i === 3 ? "700" : "400" } }, label),
          el("div.text-xs.subtle", {}, note),
        ]),
        el("strong.num.text-sm", { style: { whiteSpace: "nowrap" } }, value),
      ])
    ),
    el("hr.divider"),
    el("p.text-sm", {}, sim.breakEvenOrders === null
      ? "Con esta contribución por pedido no hay volumen que cubra la publicidad: cada pedido añade pérdidas. Hay que subir precio, bajar coste o bajar el CAC antes de gastar un euro más."
      : [
          el("strong", {}, `${money(sim.adSpend)} ÷ ${money(contribution)} = ${sim.breakEvenOrders} pedidos.`),
          el("span.muted", {}, ` A partir de ahí cada pedido deja ${money(contribution)} limpios. En ingresos son ${money(sim.breakEvenOrders * sim.averageOrderValue)}, es decir un ROAS de ${roasText(sim.breakEvenRoas)}.`),
        ]),
    el("p.text-xs.subtle", {},
      "El cálculo mantiene fijo el mix: si al escalar cambia qué productos se venden, la contribución media cambia con él."),
  ]);
}

function renderSimulator() {
  paintSimulator();
  return simShell;
}

/* --- Tabs and boot ---------------------------------------------------------- */

const TABS = [
  { id: "resumen", label: "Resumen", glyph: "chart", render: renderSummary },
  { id: "productos", label: "Productos", glyph: "package", render: renderProducts },
  { id: "proveedores", label: "Proveedores", glyph: "truck", render: renderSuppliers },
  { id: "pedidos", label: "Pedidos", glyph: "wallet", render: renderOrders },
  { id: "simulador", label: "Simulador", glyph: "radar", render: renderSimulator },
];

const tabStrip = $("#tabs");
const panel = $("#panel");
const headline = $("#headline");

function renderTabStrip() {
  replace(tabStrip, TABS.map((tab) =>
    el("button.tab", {
      type: "button",
      role: "tab",
      id: `tab-${tab.id}`,
      "aria-selected": String(tab.id === state.tab),
      "aria-controls": "panel",
      onclick: () => selectTab(tab.id),
    }, [
      el("span", { "aria-hidden": "true", style: { marginRight: "var(--space-2)", verticalAlign: "-3px" } }, [icon(tab.glyph, { size: 16 })]),
      el("span", {}, tab.label),
    ])
  ));
}

function renderTab() {
  const tab = TABS.find((t) => t.id === state.tab) ?? TABS[0];
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `tab-${tab.id}`);
  replace(panel, [tab.render()]);
}

function selectTab(id) {
  state.tab = id;
  // The hash keeps a reload (and a shared link) on the same tab. `replaceState`
  // rather than `pushState`: switching tabs is not a navigation the back button
  // should have to undo five times.
  history.replaceState(null, "", `#${id}`);
  renderTabStrip();
  renderTab();
}

// Editing the hash by hand (or following a link to `admin.html#simulador` from
// somewhere already on this page) is a same-document navigation: nothing
// reloads, so the tab has to be switched here.
addEventListener("hashchange", () => {
  const id = location.hash.replace("#", "");
  if (id && id !== state.tab && TABS.some((t) => t.id === id)) selectTab(id);
});

/** Compact status chips next to the page title, always in sync with the knobs. */
function renderHeadline() {
  const summary = catalogSummary(state.catalog, econOpts());
  const orders = listOrders();
  const agg = aggregateEconomics(orders);

  replace(headline, [
    el("div.row.row--wrap", { style: { gap: "var(--space-2)", justifyContent: "flex-end" } }, [
      el("span.chip", {}, `${summary.count} referencias`),
      el("span.chip", {}, `${suppliers.length} proveedores`),
      el("span.chip", {}, agg.orders ? `${agg.orders} pedidos` : "sin pedidos"),
      el("span.chip", { title: "Margen medio ponderado del catálogo con el CAC actual" },
        `margen ${percent(summary.avgMarginRate, { decimals: 1 })}`),
    ]),
  ]);
}

/* --- Boot -------------------------------------------------------------------- */

mountHeader({ active: "admin" });

$("#crumbs").append(breadcrumbs([{ label: "Inicio", href: "index.html" }, { label: "Panel de operación" }]));

const requestedTab = location.hash.replace("#", "");
if (TABS.some((t) => t.id === requestedTab)) state.tab = requestedTab;

renderHeadline();
renderTabStrip();
renderTab();
mountFooter();
