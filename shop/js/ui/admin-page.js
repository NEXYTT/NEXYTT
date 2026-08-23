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
      kpi("Margen medio", percent(figures.marginRate), {
        note: `sobre ${money(figures.revenueNet)} netos`,
      }),
      kpi("Pedidos", String(figures.orders), {
        note: figures.cancelled ? `${figures.cancelled} fuera del cómputo` : "en el periodo",
      }),
      kpi("Ticket medio", money(figures.averageOrderValue), { note: "IVA incluido" }),
      kpi("Unidades", String(figures.units), {
        note: figures.orders ? `${(figures.units / figures.orders).toFixed(2)} por pedido` : "—",
      }),
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
    cell: (c) => el("td", { style: { minWidth: "220px" } }, [
      el("a", { href: `product.html?slug=${encodeURIComponent(c.slug)}`, style: { color: "inherit", fontWeight: "600" } }, c.title),
      el("div.text-xs.subtle", {}, `${c.brand} · ${c.categoryLabel}`),
    ]),
  },
  {
    key: "supplier",
    label: "Proveedor",
    sort: (c) => supplierName(c.supplierId).toLowerCase(),
    cell: (c) => el("td.text-sm", { style: { minWidth: "150px" } }, supplierName(c.supplierId)),
  },
  { key: "price", label: "Precio", num: true, sort: (c) => c.price, cell: (c) => el("td.num", {}, money(c.price)) },
  { key: "supplierCost", label: "Coste", num: true, sort: (c) => c.supplierCost, cell: (c) => el("td.num.muted", {}, money(c.supplierCost)) },
  {
    key: "supplierShipping",
    label: "Envío prov.",
    num: true,
    sort: (c) => c.supplierShipping,
    cell: (c) => el("td.num.muted", {}, c.supplierShipping ? money(c.supplierShipping) : "incluido"),
  },
  {
    key: "margin",
    label: "Margen unit.",
    num: true,
    sort: (c) => c.margin,
    cell: (c) => el("td.num", {}, [signedMoney(c.margin)]),
  },
  {
    key: "marginRate",
    label: "% margen",
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
    label: "P. sugerido",
    num: true,
    sort: (c) => c.suggestedPrice,
    cell: (c) => el("td.num", { title: `Precio que alcanzaría el ${percent(c.targetMargin, { decimals: 0 })} con este CAC, redondeado al ,99 superior.` }, money(c.suggestedPrice)),
  },
  {
    key: "priceGap",
    label: "Desvío",
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
    cell: (c) => el("td", {}, [
      verdictBadge(c.verdict),
      el("div.text-xs.subtle", { style: { marginTop: "var(--space-1)", maxWidth: "26ch" } }, c.reasons[0]?.text ?? ""),
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
