/**
 * Storefront home + catalogue controller.
 *
 * One page, two jobs: the shop window (hero, trust bar, bestsellers, category
 * cards) and the catalogue proper (facets, sort, pagination).
 *
 * The filter state is the single source of truth and it is mirrored into the
 * query string on every change with `history.replaceState`, so a filtered view
 * can be pasted into a chat and reopened exactly as it was. `replaceState`
 * rather than `pushState` on purpose: typing six letters in the search box must
 * not bury the previous page under six history entries — the back button has to
 * take you where you came from, not through the keystrokes.
 */

import { el, $, replace } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money } from "../../../assets/js/format.js";
import { queryCatalog, facetCategories, facetTags, priceBounds, SORTS } from "../core/catalog.js";
import { products, recentlyViewed } from "../core/context.js";
import { CATEGORIES, categoryLabel } from "../../data/products.js";
import { mountHeader, mountFooter, productCard, addToCart } from "./shell.js";
import { productArt } from "./productArt.js";

const PER_PAGE = 12;

/* Facets are computed once over the whole catalogue: the counts a shopper reads
   in the sidebar are "how many exist", not "how many survive the current
   filters" — counts that drop to zero as you tick boxes read as a broken page. */
const CATEGORY_FACETS = facetCategories(products);
const CATEGORY_COUNTS = new Map(CATEGORY_FACETS.map((c) => [c.id, c.count]));
const TAG_FACETS = facetTags(products);
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const TAG_IDS = new Set(TAG_FACETS.map((t) => t.id));
const BOUNDS = priceBounds(products);

/** Rating cut-offs offered in the sidebar; below 4,0 nothing would be filtered out. */
const RATING_STEPS = [0, 4, 4.3, 4.5, 4.7];

/** Tag ids are slugs; only the ones that don't survive a plain capitalisation need an entry. */
const TAG_LABELS = { bestseller: "Top ventas", "usb-c": "USB-C" };
const tagLabel = (id) => TAG_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

const decimal = (value) => value.toFixed(1).replace(".", ",");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* --- State ---------------------------------------------------------------- */

const defaults = () => ({
  q: "",
  categories: [],
  tags: [],
  minPrice: null,
  maxPrice: null,
  minRating: 0,
  inStockOnly: false,
  sort: "relevance",
  page: 1,
});

const state = defaults();

const isFiltered = () =>
  Boolean(
    state.q ||
      state.categories.length ||
      state.tags.length ||
      state.minPrice != null ||
      state.maxPrice != null ||
      state.minRating > 0 ||
      state.inStockOnly
  );

/**
 * Hydrate the state from the query string. Every value is validated against the
 * real catalogue: a hand-edited `?cat=zapatos` must degrade to "no filter",
 * never to an empty grid the shopper cannot explain.
 */
function readUrl() {
  const params = new URLSearchParams(location.search);
  const csv = (key) =>
    (params.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  Object.assign(state, defaults());

  state.q = params.get("q") ?? "";
  state.categories = csv("cat").filter((id) => CATEGORY_IDS.has(id));
  state.tags = csv("tag").filter((id) => TAG_IDS.has(id));

  // Prices travel through the URL in minor units (cents), like everywhere else
  // in the codebase — a float in a shareable link is a rounding bug waiting to
  // happen. Only the two number inputs work in euros.
  state.minPrice = intParam(params.get("min"));
  state.maxPrice = intParam(params.get("max"));

  const rating = Number(params.get("rating"));
  state.minRating = RATING_STEPS.includes(rating) ? rating : 0;
  state.inStockOnly = params.get("stock") === "1";

  const sort = params.get("sort");
  state.sort = sort && SORTS[sort] ? sort : "relevance";

  const page = Number.parseInt(params.get("page") ?? "1", 10);
  state.page = Number.isFinite(page) && page > 0 ? page : 1;
}

const intParam = (raw) => {
  if (raw == null || raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Only non-default values reach the URL, so a clean catalogue has a clean link. */
function writeUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.categories.length) params.set("cat", state.categories.join(","));
  if (state.tags.length) params.set("tag", state.tags.join(","));
  if (state.minPrice != null) params.set("min", String(state.minPrice));
  if (state.maxPrice != null) params.set("max", String(state.maxPrice));
  if (state.minRating > 0) params.set("rating", String(state.minRating));
  if (state.inStockOnly) params.set("stock", "1");
  if (state.sort !== "relevance") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));

  const query = params.toString();
  const url = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  try {
    history.replaceState(null, "", url);
  } catch {
    // Opened straight from disk (file://) some browsers refuse to rewrite the
    // URL. The page works the same; it just isn't shareable in that mode.
  }
}

/* --- Shop window ---------------------------------------------------------- */

const bestsellers = products.filter((p) => p.bestseller);

/**
 * Hero artwork: a small composition of real product illustrations rather than a
 * stock photo, so it stays honest about what the shop sells and still renders
 * offline. `.product-card__media` is reused for the 100% sizing of the SVG.
 */
function heroArt() {
  const [lead, second, third] = bestsellers;
  const tile = (product, extra = {}) =>
    el("div.product-card__media", {
      html: productArt(product, { variantIndex: extra.variantIndex ?? 0 }),
      style: {
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md)",
        border: "1px solid var(--border)",
        ...extra.style,
      },
    });

  return el("div", { style: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" } }, [
    tile(lead, { style: { gridColumn: "1 / -1" } }),
    tile(second, { variantIndex: 1, style: { aspectRatio: "1" } }),
    tile(third, { variantIndex: 2, style: { aspectRatio: "1" } }),
  ]);
}

const TRUST = [
  { glyph: "truck", title: "Envío gratis desde 49 €", note: "Entrega en 2–5 días laborables en península." },
  { glyph: "refresh", title: "Devoluciones en 30 días", note: "Sin explicaciones y con etiqueta de retorno incluida." },
  { glyph: "shield", title: "Pago seguro", note: "Tarjeta, PayPal o Bizum con cifrado y 3-D Secure." },
  { glyph: "user", title: "Atención en español", note: "Personas, no formularios, de lunes a viernes." },
];

const trustItem = ({ glyph, title, note }) =>
  el("div.trust__item", {}, [
    el("span.trust__icon", {}, [icon(glyph, { size: 20 })]),
    el("div", {}, [
      el("strong", { style: { display: "block", fontSize: "var(--text-sm)" } }, title),
      el("span.text-xs.muted", {}, note),
    ]),
  ]);

/** Category tiles keep a reference so the active one can be marked after a filter change. */
const categoryTiles = new Map();

function categoryCard(category) {
  const count = CATEGORY_COUNTS.get(category.id) ?? 0;
  const card = el("button.card.card--pad", {
    type: "button",
    onclick: () => selectCategory(category.id),
    "aria-label": `Filtrar por ${category.label}, ${plural(count, "producto", "productos")}`,
    "aria-pressed": "false",
    style: {
      display: "grid",
      gap: "var(--space-2)",
      justifyItems: "start",
      textAlign: "left",
      cursor: "pointer",
    },
  }, [
    el("span", {
      "aria-hidden": "true",
      style: {
        width: "44px",
        height: "44px",
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        color: "var(--accent)",
      },
    }, [icon(category.glyph, { size: 22 })]),
    el("strong", {}, category.label),
    el("span.text-xs.subtle", {}, plural(count, "producto", "productos")),
  ]);

  categoryTiles.set(category.id, card);
  return card;
}

/**
 * A category tile is a shortcut, not a checkbox: it replaces the selection so a
 * second click on the same tile clears it and shows everything again.
 */
function selectCategory(id) {
  const only = state.categories.length === 1 && state.categories[0] === id;
  state.categories = only ? [] : [id];
  state.page = 1;
  syncFilters();
  render();
  $("#catalogo").scrollIntoView({ block: "start" });
}

/* --- Filter sidebar ------------------------------------------------------- */

const categoryInputs = new Map();
const tagChips = new Map();
const ratingInputs = new Map();

const minPriceInput = priceInput("Precio mínimo en euros");
const maxPriceInput = priceInput("Precio máximo en euros");

const stockInput = el("input", {
  type: "checkbox",
  onchange: () => {
    state.inStockOnly = stockInput.checked;
    state.page = 1;
    render();
  },
});

const clearButton = el("button.btn.btn--ghost.btn--sm.btn--block", {
  type: "button",
  onclick: clearFilters,
}, "Limpiar filtros");

/**
 * Prices are typed in euros because that is what a shopper reads on the card,
 * and converted to integer cents on commit — the single float in the pipeline
 * dies here. Committing on `change` (blur / Enter) instead of on every
 * keystroke: filtering while "1" is on its way to "15" is just noise.
 */
function priceInput(label) {
  const input = el("input.input", {
    type: "number",
    inputmode: "decimal",
    min: "0",
    step: "1",
    "aria-label": label,
    onchange: () => commitPrices(),
  });
  return input;
}

const eurosToCents = (raw) => {
  const value = Number(String(raw).replace(",", "."));
  if (raw === "" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
};

function commitPrices() {
  let min = eurosToCents(minPriceInput.value);
  let max = eurosToCents(maxPriceInput.value);
  // An inverted range is a typo, not an intent to see nothing: swap it.
  if (min != null && max != null && min > max) [min, max] = [max, min];

  state.minPrice = min;
  state.maxPrice = max;
  state.page = 1;
  syncFilters();
  render();
}

function toggleValue(key, value, on) {
  const current = new Set(state[key]);
  if (on) current.add(value);
  else current.delete(value);
  state[key] = [...current];
  state.page = 1;
  render();
}

function buildFilters() {
  const categoryGroup = el("div.filter-group", {}, [
    el("h3.filter-group__title", {}, "Categoría"),
    ...CATEGORY_FACETS.map(({ id, count }) => {
      const input = el("input", {
        type: "checkbox",
        onchange: () => {
          toggleValue("categories", id, input.checked);
          syncCategoryTiles();
        },
      });
      categoryInputs.set(id, input);
      return el("label.filter-option", {}, [
        input,
        el("span", {}, categoryLabel(id)),
        el("span.filter-option__count", {}, String(count)),
      ]);
    }),
  ]);

  const tagGroup = el("div.filter-group", {}, [
    el("h3.filter-group__title", {}, "Etiquetas"),
    el("div.row.row--wrap", { style: { gap: "var(--space-2)" } },
      TAG_FACETS.map(({ id, count }) => {
        const chip = el("button.chip", {
          type: "button",
          "aria-pressed": "false",
          "aria-label": `Etiqueta ${tagLabel(id)}, ${plural(count, "producto", "productos")}`,
          onclick: () => {
            const on = chip.getAttribute("aria-pressed") !== "true";
            chip.setAttribute("aria-pressed", String(on));
            toggleValue("tags", id, on);
          },
        }, [
          el("span", {}, tagLabel(id)),
          el("span.text-xs", { style: { opacity: "0.7" } }, String(count)),
        ]);
        tagChips.set(id, chip);
        return chip;
      })
    ),
  ]);

  const priceGroup = el("div.filter-group", {}, [
    el("h3.filter-group__title", {}, "Precio"),
    el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" } }, [
      el("label.field", {}, [el("span.label", {}, "Desde €"), minPriceInput]),
      el("label.field", {}, [el("span.label", {}, "Hasta €"), maxPriceInput]),
    ]),
    el("span.field__hint", {}, `El catálogo va de ${money(BOUNDS.min)} a ${money(BOUNDS.max)}.`),
  ]);

  const ratingGroup = el("div.filter-group", {}, [
    el("h3.filter-group__title", {}, "Valoración mínima"),
    ...RATING_STEPS.map((value) => {
      const input = el("input", {
        type: "radio",
        name: "min-rating",
        checked: value === 0,
        onchange: () => {
          state.minRating = value;
          state.page = 1;
          render();
        },
      });
      ratingInputs.set(value, input);
      return el("label.filter-option", {}, [
        input,
        value === 0
          ? el("span", {}, "Todas")
          : el("span.row", { style: { gap: "var(--space-1)" } }, [
              icon("star", { size: 14, fill: true, class: "text-accent" }),
              el("span", {}, `${decimal(value)} o más`),
            ]),
      ]);
    }),
  ]);

  const stockGroup = el("div.filter-group", {}, [
    el("h3.filter-group__title", {}, "Disponibilidad"),
    el("label.filter-option", {}, [stockInput, el("span", {}, "Solo productos en stock")]),
  ]);

  return el("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-5)" } }, [
    categoryGroup,
    tagGroup,
    priceGroup,
    ratingGroup,
    stockGroup,
    clearButton,
  ]);
}

/** Push the state back into the controls — needed after "clear" and on load. */
function syncFilters() {
  for (const [id, input] of categoryInputs) input.checked = state.categories.includes(id);
  for (const [id, chip] of tagChips) chip.setAttribute("aria-pressed", String(state.tags.includes(id)));
  for (const [value, input] of ratingInputs) input.checked = value === state.minRating;

  // Cents → euros only for display; the state keeps the integer.
  minPriceInput.value = state.minPrice == null ? "" : String(state.minPrice / 100);
  maxPriceInput.value = state.maxPrice == null ? "" : String(state.maxPrice / 100);
  stockInput.checked = state.inStockOnly;
  sortSelect.value = state.sort;
  syncCategoryTiles();
}

function syncCategoryTiles() {
  for (const [id, tile] of categoryTiles) {
    const active = state.categories.includes(id);
    tile.setAttribute("aria-pressed", String(active));
    tile.style.borderColor = active ? "var(--accent)" : "";
    tile.style.background = active ? "var(--accent-soft)" : "";
  }
}

function clearFilters() {
  Object.assign(state, defaults());
  if (searchInput) searchInput.value = "";
  syncFilters();
  render();
}

/* --- Toolbar -------------------------------------------------------------- */

const resultCount = el("p.text-sm.muted", { role: "status", "aria-live": "polite" }, "");

const sortSelect = el("select.select", {
  "aria-label": "Ordenar productos",
  // `.select` is width:100% for form layouts; in the toolbar it has to size to
  // its longest option instead of eating the whole row.
  style: { width: "auto", minWidth: "180px" },
  onchange: () => {
    state.sort = sortSelect.value;
    state.page = 1;
    render();
  },
}, Object.values(SORTS).map((option) => el("option", { value: option.id }, option.label)));

const openFiltersButton = el("button.btn.btn--ghost.btn--sm", {
  type: "button",
  onclick: () => {
    if (!filtersDialog.open) filtersDialog.showModal();
  },
}, [icon("filter", { size: 16 }), el("span", {}, "Filtros")]);

const applyFiltersButton = el("button.btn.btn--primary.btn--block", {
  type: "button",
  onclick: () => filtersDialog.close(),
}, "Ver resultados");

// The panel is taller than a phone screen, so the dialog scrolls its body and
// keeps the header and the "ver resultados" footer pinned.
const filtersDialogBody = el("div.modal__body", { style: { maxHeight: "62vh", overflowY: "auto" } });

const filtersDialog = el("dialog.modal", { "aria-label": "Filtros del catálogo" }, [
  el("div.modal__head", {}, [
    el("h2", { style: { fontSize: "var(--text-lg)" } }, "Filtros"),
    el("button.btn.btn--ghost.btn--icon", {
      type: "button",
      "aria-label": "Cerrar los filtros",
      onclick: () => filtersDialog.close(),
    }, [icon("close")]),
  ]),
  filtersDialogBody,
  el("div.modal__foot", {}, [applyFiltersButton]),
]);

/* --- Results -------------------------------------------------------------- */

/**
 * Page numbers around the current one, with the first and last always visible
 * and every gap collapsed into a single ellipsis: 1 … 4 5 6 … 12.
 */
function pageWindow(current, pages) {
  const out = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - current) <= 1) out.push(n);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

function goToPage(page) {
  state.page = page;
  render();
  $("#catalogo").scrollIntoView({ block: "start" });
  // Move focus into the freshly rendered grid so a keyboard user doesn't get
  // dropped at the top of the document after paging.
  resultsHost.focus({ preventScroll: true });
}

function pagination(result) {
  if (result.pages <= 1) return null;

  const step = (label, page, disabled) =>
    el("button.btn.btn--ghost.btn--sm", {
      type: "button",
      disabled,
      onclick: () => goToPage(page),
    }, label);

  return el("nav.row.row--wrap", {
    "aria-label": "Paginación del catálogo",
    style: { justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-6)" },
  }, [
    step("Anterior", result.page - 1, result.page === 1),
    ...pageWindow(result.page, result.pages).map((entry) =>
      entry === "…"
        ? el("span.subtle", { "aria-hidden": "true" }, "…")
        : el(`button.btn.btn--sm${entry === result.page ? ".btn--primary" : ".btn--ghost"}`, {
            type: "button",
            "aria-label": `Página ${entry} de ${result.pages}`,
            ...(entry === result.page ? { "aria-current": "page" } : {}),
            onclick: () => goToPage(entry),
          }, String(entry))
    ),
    step("Siguiente", result.page + 1, result.page === result.pages),
  ]);
}

function emptyState() {
  return el("div.empty", {}, [
    el("div.empty__icon", {}, [icon("search", { size: 40 })]),
    el("p", { style: { fontWeight: "650", color: "var(--fg)" } }, "Ningún producto encaja con estos filtros"),
    el("p.text-sm", { style: { marginTop: "var(--space-2)" } },
      "Prueba a quitar una etiqueta, ampliar el rango de precio o bajar la valoración mínima."),
    el("button.btn.btn--primary", {
      type: "button",
      onclick: clearFilters,
      style: { marginTop: "var(--space-5)" },
    }, "Limpiar filtros"),
  ]);
}

/** Chips for the filters in force, each one removable. */
function activeFilterChips() {
  const chips = [];
  const removable = (label, onRemove) =>
    el("button.chip", {
      type: "button",
      "aria-label": `Quitar filtro: ${label}`,
      onclick: onRemove,
    }, [el("span", {}, label), icon("close", { size: 14 })]);

  if (state.q) {
    chips.push(removable(`«${state.q}»`, () => {
      state.q = "";
      if (searchInput) searchInput.value = "";
      state.page = 1;
      render();
    }));
  }
  for (const id of state.categories) {
    chips.push(removable(categoryLabel(id), () => {
      toggleValue("categories", id, false);
      syncFilters();
    }));
  }
  for (const id of state.tags) {
    chips.push(removable(tagLabel(id), () => {
      toggleValue("tags", id, false);
      syncFilters();
    }));
  }
  if (state.minPrice != null || state.maxPrice != null) {
    const label =
      state.minPrice != null && state.maxPrice != null
        ? `${money(state.minPrice)} – ${money(state.maxPrice)}`
        : state.minPrice != null
          ? `Desde ${money(state.minPrice)}`
          : `Hasta ${money(state.maxPrice)}`;
    chips.push(removable(label, () => {
      state.minPrice = null;
      state.maxPrice = null;
      state.page = 1;
      syncFilters();
      render();
    }));
  }
  if (state.minRating > 0) {
    chips.push(removable(`${decimal(state.minRating)} estrellas o más`, () => {
      state.minRating = 0;
      state.page = 1;
      syncFilters();
      render();
    }));
  }
  if (state.inStockOnly) {
    chips.push(removable("Solo en stock", () => {
      state.inStockOnly = false;
      state.page = 1;
      syncFilters();
      render();
    }));
  }
  return chips;
}

const resultsHost = $("#results");
const activeFiltersHost = $("#active-filters");

function render() {
  const result = queryCatalog(products, { ...state, perPage: PER_PAGE });
  // queryCatalog clamps an out-of-range page; keep the state (and the URL) honest.
  state.page = result.page;
  writeUrl();

  const from = result.total ? (result.page - 1) * result.perPage + 1 : 0;
  const to = Math.min(result.total, result.page * result.perPage);
  resultCount.textContent = result.total
    ? `${from}–${to} de ${plural(result.total, "producto", "productos")}`
    : "Sin resultados";
  applyFiltersButton.textContent = result.total
    ? `Ver ${plural(result.total, "producto", "productos")}`
    : "Sin resultados";
  clearButton.disabled = !isFiltered();

  const chips = activeFilterChips();
  activeFiltersHost.style.display = chips.length ? "" : "none";
  replace(activeFiltersHost, chips);

  replace(resultsHost, result.total
    ? [
        el("div.product-grid", {}, result.items.map((p) => productCard(p, { onAdd: addToCart }))),
        pagination(result),
      ]
    : [emptyState()]);
}

/* --- Responsive filters --------------------------------------------------- */

/** Matches the breakpoint where shop.css collapses `.catalog` to a single column. */
const narrow = matchMedia("(max-width: 900px)");
const filtersHost = $("#filters-host");
const filtersPanel = buildFilters();

/**
 * One panel, two homes. On a phone the sidebar would push the grid below the
 * fold, so the same live node moves into a modal dialog instead of being
 * duplicated — duplicated controls drift out of sync the moment one is used.
 */
function placeFilters() {
  if (narrow.matches) {
    filtersDialogBody.append(filtersPanel);
    filtersHost.style.display = "none";
    openFiltersButton.style.display = "";
  } else {
    if (filtersDialog.open) filtersDialog.close();
    filtersHost.append(filtersPanel);
    filtersHost.style.display = "";
    openFiltersButton.style.display = "none";
  }
}

/* --- Boot ----------------------------------------------------------------- */

readUrl();

const { searchInput } = mountHeader({ active: "catalog", searchValue: state.q, onSearch });

let searchTimer = 0;
function onSearch(value) {
  clearTimeout(searchTimer);
  // ~200 ms: long enough to swallow a burst of keystrokes, short enough that the
  // grid still feels like it is answering as you type.
  searchTimer = setTimeout(() => {
    state.q = value.trim();
    state.page = 1;
    render();
  }, 200);
}

$("#hero-art").append(heroArt());
replace($("#trust"), TRUST.map(trustItem));
replace($("#bestsellers"), bestsellers.map((p) => productCard(p, { onAdd: addToCart })));
replace($("#category-grid"), CATEGORIES.map(categoryCard));

replace($("#toolbar"), [
  resultCount,
  el("span.spacer"),
  openFiltersButton,
  el("label.row", { style: { gap: "var(--space-2)" } }, [
    el("span.text-sm.muted.hide-sm", {}, "Ordenar por"),
    sortSelect,
  ]),
]);

document.body.append(filtersDialog);
// Clicking the backdrop closes the dialog: the click lands on the dialog itself
// because the padding belongs to the inner blocks.
filtersDialog.addEventListener("click", (ev) => {
  if (ev.target === filtersDialog) filtersDialog.close();
});
narrow.addEventListener("change", placeFilters);
placeFilters();

syncFilters();
render();

// Back/forward (or a hand-edited link) must rebuild the view from the URL.
addEventListener("popstate", () => {
  readUrl();
  if (searchInput) searchInput.value = state.q;
  syncFilters();
  render();
});

const recent = recentlyViewed();
if (recent.length) {
  const section = $("#recientes");
  section.hidden = false;
  replace($("#recent-rail"), recent.map((p) =>
    el("div", { style: { flex: "0 0 240px", scrollSnapAlign: "start" } }, [
      productCard(p, { onAdd: addToCart }),
    ])
  ));
}

mountFooter();
