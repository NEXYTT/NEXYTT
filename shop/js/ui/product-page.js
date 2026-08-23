/**
 * Product detail page.
 *
 * Reads `?slug=` and renders the whole PDP: gallery, variant picker, honest
 * stock counter, a shipping estimate computed from the real zone tables for the
 * chosen country and the parcel weight, the long-form accordions, the review
 * summary and the "also viewed" rail.
 *
 * Two decisions worth stating:
 *
 * 1. A missing or unknown slug is a *normal* outcome (stale link, edited URL),
 *    not an error. It renders an empty state with a way back to the catalogue,
 *    never a blank page or a thrown exception.
 * 2. The shipping figure is computed for **this line only** — one product, N
 *    units — and is labelled as such. Quoting the cart's free-shipping progress
 *    on a page that knows nothing about the rest of the cart would be a lie the
 *    checkout would then have to walk back.
 */

import { el, $, replace, queryParam, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money, dateOnly } from "../../../assets/js/format.js";
import { products, store, markViewed, wishlist, toggleWish } from "../core/context.js";
import { findBySlug, relatedProducts } from "../core/catalog.js";
import { discountPercent, zoneForCountry, shippingCost, SHIPPING_ZONES } from "../core/pricing.js";
import { categoryLabel, variantPrice, variantOf } from "../../data/products.js";
import { reviewsFor, reviewSummary } from "../../data/reviews.js";
import {
  mountHeader,
  mountFooter,
  productCard,
  addToCart,
  ratingRow,
  breadcrumbs,
} from "./shell.js";
import { galleryViews } from "./productArt.js";

/** Below this many units left we say the number out loud instead of "en stock". */
const LOW_STOCK = 15;
const COUNTRY_KEY = "pdp.country";

/**
 * Destinations offered by the estimator, in zone order. The last entry has no
 * zone of its own on purpose: it exercises the `INTL` fallback in
 * `zoneForCountry()`, which is what any unlisted country resolves to.
 */
const COUNTRIES = [
  { code: "ES", label: "España (península)" },
  { code: "PT", label: "Portugal" },
  { code: "FR", label: "Francia" },
  { code: "DE", label: "Alemania" },
  { code: "IT", label: "Italia" },
  { code: "NL", label: "Países Bajos" },
  { code: "BE", label: "Bélgica" },
  { code: "GB", label: "Reino Unido" },
  { code: "MX", label: "México" },
  { code: "AR", label: "Argentina" },
  { code: "CL", label: "Chile" },
  { code: "CO", label: "Colombia" },
  { code: "US", label: "Estados Unidos" },
  { code: "ZZ", label: "Otro país" },
];

/* --- Small shared helpers -------------------------------------------------- */

const decimal = (value, digits = 1) =>
  value.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const plural = (n, one, many) => `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;

const weight = (grams) =>
  grams >= 1000 ? `${decimal(grams / 1000, 2)} kg` : `${grams} g`;

/** Star row. Decorative: every caller pairs it with the figure in plain text. */
const starsRow = (rating, size = 14) =>
  el("span.rating__stars", { "aria-hidden": "true" },
    Array.from({ length: 5 }, (_, i) => icon("star", { size, fill: i < Math.round(rating) })));

/**
 * Generated art carries a viewBox but no intrinsic size, and only
 * `.gallery__main svg` has a CSS rule for it — thumbnails would collapse to the
 * 300×150 replaced-element default without this.
 */
function fitArt(host) {
  const svg = host.querySelector("svg");
  if (svg) Object.assign(svg.style, { width: "100%", height: "100%", display: "block" });
  return host;
}

/**
 * Carriers quote *working* days, so a 3-day parcel ordered on a Friday arrives
 * on Wednesday, not on Monday. Weekends are skipped; public holidays are not
 * modelled, which is why the page says "estimada".
 */
function addBusinessDays(from, days) {
  const date = new Date(from);
  for (let left = days; left > 0; ) {
    date.setDate(date.getDate() + 1);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return date;
}

/** Reviews carry a bare ISO day; parsing at midday keeps any timezone from shifting it. */
const reviewDate = (iso) => new Date(`${iso}T12:00:00`).getTime();

/* --- Boot ------------------------------------------------------------------ */

mountHeader({ active: "catalog" });

const app = $("#app");
const product = findBySlug(products, queryParam("slug", ""));

if (product) renderProduct(app, product);
else renderNotFound(app);

mountFooter();

/* --- Empty state ----------------------------------------------------------- */

function renderNotFound(root) {
  document.title = "Producto no encontrado · NEXYTT Store";

  replace(root, [
    breadcrumbs([{ label: "Inicio", href: "index.html" }, { label: "Producto no encontrado" }]),
    el("div.empty", {}, [
      el("div.empty__icon", { "aria-hidden": "true" }, [icon("package", { size: 44 })]),
      el("h1", { style: { fontSize: "var(--text-2xl)" } }, "No encontramos este producto"),
      el("p.muted", { style: { maxWidth: "48ch", margin: "var(--space-3) auto 0" } },
        "El enlace puede estar caducado o el artículo ya no forma parte del catálogo. Búscalo desde la portada o echa un vistazo a las categorías."),
      el("div.row.row--wrap", { style: { justifyContent: "center", marginTop: "var(--space-5)" } }, [
        el("a.btn.btn--primary", { href: "index.html" }, "Ver el catálogo"),
        el("a.btn.btn--ghost", { href: "orders.html" }, "Mis pedidos"),
      ]),
    ]),
  ]);
}

/* --- Product page ---------------------------------------------------------- */

function renderProduct(root, product) {
  document.title = `${product.title} · NEXYTT Store`;
  const meta = $('meta[name="description"]');
  if (meta) meta.setAttribute("content", product.summary);

  // Feeds the "recently viewed" rails elsewhere in the store.
  markViewed(product.id);

  const variants = product.variants ?? [];
  const state = {
    // Preselect the first variant that can actually ship: landing on a sold-out
    // default reads as a broken page rather than as a sold-out colour.
    variantId: (variants.find((v) => v.stock > 0) ?? variants[0])?.id ?? null,
    qty: 1,
    country: store.get(COUNTRY_KEY) ?? "ES",
  };

  const stockLeft = () => variantOf(product, state.variantId)?.stock ?? product.stock;
  const unitPrice = () => variantPrice(product, state.variantId);
  const clampQty = (n) => Math.min(Math.max(1, Math.floor(n) || 1), Math.max(1, stockLeft()));

  /* --- Gallery ------------------------------------------------------------ */

  const views = galleryViews(product);
  const main = fitArt(el("div.gallery__main", { html: views[0] }));

  const thumbs = views.map((markup, i) =>
    fitArt(el("button.gallery__thumb", {
      type: "button",
      "aria-pressed": String(i === 0),
      "aria-label": `Ver la imagen ${i + 1} de ${product.title}`,
      html: markup,
      onclick: () => selectView(i),
    }))
  );

  function selectView(index) {
    main.innerHTML = views[index];
    fitArt(main);
    thumbs.forEach((thumb, i) => thumb.setAttribute("aria-pressed", String(i === index)));
  }

  const gallery = el("div.gallery", {}, [
    main,
    el("div.gallery__thumbs", {}, thumbs),
    el("p.text-xs.subtle", { style: { margin: 0 } },
      "Ilustraciones generadas para el catálogo de demostración; no son fotografías del artículo."),
  ]);

  /* --- Price -------------------------------------------------------------- */

  const priceNow = el("span.price__now", {});
  const priceWas = el("span.price__was", {});
  const priceBadge = el("span.badge.badge--loss", {});
  const priceBlock = el("div.price.price--lg", {}, [priceNow, priceWas, priceBadge]);

  /* --- Variants ----------------------------------------------------------- */

  const variantButtons = variants.map((variant) =>
    el("button.variant-btn", {
      type: "button",
      // A variant with no stock stays visible but unpickable: hiding it makes
      // the shopper think the colour never existed.
      disabled: variant.stock <= 0,
      "aria-label": `${variant.label}, ${money(product.price + variant.priceDelta)}${variant.stock <= 0 ? ", sin stock" : ""}`,
      onclick: () => {
        state.variantId = variant.id;
        state.qty = clampQty(state.qty);
        refresh();
      },
    }, [
      variant.label,
      variant.priceDelta
        ? el("span.subtle", { style: { marginLeft: "var(--space-2)" } }, `+${money(variant.priceDelta)}`)
        : null,
    ])
  );

  const variantBlock = variants.length
    ? el("div", { style: { display: "grid", gap: "var(--space-2)" } }, [
        el("span.label", {}, "Acabado"),
        el("div.variant-row", { role: "group", "aria-label": "Elige un acabado" }, variantButtons),
      ])
    : null;

  /* --- Stock, quantity, actions ------------------------------------------- */

  const stockNote = el("p.text-sm", { style: { margin: 0, fontWeight: "650" } });

  const qtyInput = el("input", {
    type: "number",
    min: "1",
    step: "1",
    inputmode: "numeric",
    "aria-label": "Cantidad",
    onchange: (ev) => {
      state.qty = clampQty(Number(ev.target.value));
      refresh();
    },
  });

  const qtyDown = el("button", {
    type: "button",
    "aria-label": "Quitar una unidad",
    onclick: () => { state.qty = clampQty(state.qty - 1); refresh(); },
  }, [icon("minus", { size: 16 })]);

  const qtyUp = el("button", {
    type: "button",
    "aria-label": "Añadir una unidad",
    onclick: () => { state.qty = clampQty(state.qty + 1); refresh(); },
  }, [icon("plus", { size: 16 })]);

  const qtyControl = el("div.qty", {}, [qtyDown, qtyInput, qtyUp]);

  const addBtn = el("button.btn.btn--primary.btn--lg", {
    type: "button",
    style: { flex: "1 1 12rem" },
    onclick: () => {
      if (stockLeft() <= 0) return;
      addToCart(product, { variantId: state.variantId, qty: state.qty });
    },
  });

  const wishBtn = el("button.btn.btn--ghost.btn--lg", { type: "button" });
  wishBtn.addEventListener("click", () => {
    const saved = toggleWish(product.id);
    paintWish(saved);
    toast(
      saved ? `${product.title} guardado en tu lista de deseos.` : "Quitado de tu lista de deseos.",
      { variant: saved ? "win" : "info" }
    );
  });

  function paintWish(saved) {
    wishBtn.setAttribute("aria-pressed", String(saved));
    wishBtn.setAttribute(
      "aria-label",
      saved ? `Quitar ${product.title} de la lista de deseos` : `Guardar ${product.title} en la lista de deseos`
    );
    replace(wishBtn, [
      icon("heart", { size: 18, fill: saved }),
      el("span.hide-sm", {}, saved ? "Guardado" : "Guardar"),
    ]);
  }
  paintWish(wishlist().includes(product.id));

  /* --- Shipping estimate --------------------------------------------------- */

  const countrySelect = el("select.select", {
    id: "pdp-country",
    onchange: (ev) => {
      state.country = ev.target.value;
      store.set(COUNTRY_KEY, state.country);
      refresh();
    },
  }, COUNTRIES.map((c) => el("option", { value: c.code }, c.label)));
  // `value` has to be assigned after the options exist, or the select ignores it.
  countrySelect.value = state.country;
  if (!countrySelect.value) countrySelect.value = "ES";
  state.country = countrySelect.value;

  const shippingOut = el("div", { style: { display: "grid", gap: "var(--space-3)" } });

  const shippingBlock = el("div.card.card--pad", { style: { display: "grid", gap: "var(--space-4)" } }, [
    el("div.field", {}, [
      el("label.label", { htmlFor: "pdp-country" }, "Calcular envío a"),
      countrySelect,
    ]),
    shippingOut,
  ]);

  function paintShipping() {
    const zone = zoneForCountry(state.country);
    const units = state.qty;
    const subtotal = unitPrice() * units;
    const grams = product.grams * units;
    const ship = shippingCost({ zone, grams, subtotal });
    const [minDays, maxDays] = zone.etaDays;
    const now = Date.now();

    replace(shippingOut, [
      el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
        el("span.row", { style: { gap: "var(--space-2)", color: "var(--fg-muted)" } }, [
          icon("truck", { size: 16 }),
          el("span.text-sm", {}, zone.label),
        ]),
        ship.free
          ? el("span.badge.badge--win", {}, "Envío gratis")
          : el("strong", { style: { fontSize: "var(--text-lg)" } }, money(ship.cost)),
      ]),

      el("p.text-sm.muted", { style: { margin: 0 } },
        `Llega entre el ${dateOnly(addBusinessDays(now, minDays).getTime())} y el ${dateOnly(addBusinessDays(now, maxDays).getTime())}, ${minDays}-${maxDays} días laborables.`),

      ship.free
        ? el("p.text-sm.muted", { style: { margin: 0 } },
            `Este pedido supera los ${money(zone.freeOver)} de envío gratuito a ${zone.label.toLowerCase()}.`)
        : el("div", { style: { display: "grid", gap: "var(--space-2)" } }, [
            el("div.progress-free", { "aria-hidden": "true" }, [
              el("div.progress-free__fill", {
                style: { width: `${Math.min(100, (subtotal / zone.freeOver) * 100).toFixed(1)}%` },
              }),
            ]),
            el("p.text-sm.muted", { style: { margin: 0 } }, [
              "Te faltan ",
              el("strong", {}, money(ship.missingForFree)),
              ` para el envío gratis (desde ${money(zone.freeOver)}).`,
            ]),
          ]),

      el("p.text-xs.subtle", { style: { margin: 0 } },
        `Calculado para ${plural(units, "unidad", "unidades")} de este artículo, ${weight(grams)} de peso facturable. El carrito recalcula el total con el resto de líneas.`),
    ]);
  }

  /* --- Accordions ---------------------------------------------------------- */

  const specRows = Object.entries(product.specs ?? {}).map(([key, value]) =>
    el("tr", {}, [el("td", {}, key), el("td", {}, value)])
  );

  const accordions = el("div", { style: { marginTop: "var(--space-5)" } }, [
    accordion("Descripción", [el("p", { style: { margin: 0 } }, product.description)], true),
    accordion("Características", [
      el("ul", { style: { margin: 0, paddingLeft: "1.15rem", display: "grid", gap: "var(--space-2)" } },
        (product.bullets ?? []).map((line) => el("li", {}, line))),
    ]),
    accordion("Especificaciones", [
      el("div.table-wrap", {}, [
        el("table.table.spec-table", {}, [
          el("caption.visually-hidden", {}, `Especificaciones técnicas de ${product.title}`),
          el("tbody", {}, specRows),
        ]),
      ]),
    ]),
    accordion("Envíos y devoluciones", [
      el("p", { style: { marginTop: 0 } },
        "Los plazos se cuentan en días laborables desde que el proveedor confirma el pedido. Tarifas vigentes por zona:"),
      el("ul", { style: { margin: 0, paddingLeft: "1.15rem", display: "grid", gap: "var(--space-2)" } },
        // Generated from the pricing module so the copy can never drift from
        // what the estimator above actually charges.
        Object.values(SHIPPING_ZONES).map((zone) =>
          el("li", {}, [
            el("strong", {}, zone.label),
            `: desde ${money(zone.base)} · ${zone.etaDays[0]}-${zone.etaDays[1]} días laborables · gratis a partir de ${money(zone.freeOver)}.`,
          ])
        )),
      el("p", { style: { marginBottom: 0 } },
        "Devoluciones en 30 días desde la entrega, con el artículo completo y su embalaje. La recogida es gratuita en España peninsular; en el resto de zonas se descuenta el coste del reembolso."),
    ]),
  ]);

  /* --- Right column -------------------------------------------------------- */

  const reviewCount = reviewsFor(product.id).length;

  const info = el("div", { style: { display: "grid", gap: "var(--space-4)" } }, [
    el("span.eyebrow", {}, product.brand),
    el("h1", { style: { fontSize: "var(--text-2xl)", margin: 0, lineHeight: "var(--leading-tight)" } }, product.title),

    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      ratingRow(product),
      reviewCount
        ? el("a.text-sm", { href: "#resenas" }, `Ver ${plural(reviewCount, "reseña", "reseñas")}`)
        : null,
      product.bestseller ? el("span.badge.badge--accent", {}, "Top ventas") : null,
    ]),

    priceBlock,
    el("p.text-xs.subtle", { style: { margin: 0 } }, "IVA incluido. Envío calculado abajo."),
    el("p.muted", { style: { margin: 0 } }, product.summary),

    variantBlock,
    stockNote,

    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [qtyControl, addBtn, wishBtn]),

    shippingBlock,
    accordions,
  ]);

  /* --- Assemble ------------------------------------------------------------ */

  const shortTitle = product.title.length > 44 ? `${product.title.slice(0, 42).trimEnd()}…` : product.title;

  replace(root, [
    breadcrumbs([
      { label: "Inicio", href: "index.html" },
      { label: categoryLabel(product.category), href: `index.html?cat=${product.category}` },
      { label: shortTitle },
    ]),
    el("div.pdp", {}, [gallery, info]),
    reviewsSection(product),
    relatedRail(product),
  ]);

  refresh();

  /* --- Reactive redraw ----------------------------------------------------- */

  function refresh() {
    const price = unitPrice();
    const left = stockLeft();
    const discount = discountPercent(price, product.compareAt);

    priceNow.textContent = money(price);
    priceWas.textContent = money(product.compareAt);
    priceWas.classList.toggle("hide", product.compareAt <= price);
    priceBadge.textContent = `−${discount}%`;
    priceBadge.classList.toggle("hide", discount <= 0);

    for (const [i, button] of variantButtons.entries()) {
      button.setAttribute("aria-pressed", String(variants[i].id === state.variantId));
    }

    // Honest stock: say the number only when it is genuinely low, so that the
    // scarcity line means something when it does appear.
    if (left <= 0) {
      stockNote.textContent = "Sin stock en este acabado";
      stockNote.style.color = "var(--loss)";
    } else if (left <= LOW_STOCK) {
      stockNote.textContent = `Quedan ${plural(left, "unidad", "unidades")}`;
      stockNote.style.color = "var(--warn)";
    } else {
      stockNote.textContent = `En stock · ${plural(left, "unidad disponible", "unidades disponibles")}`;
      stockNote.style.color = "var(--win)";
    }

    state.qty = clampQty(state.qty);
    qtyInput.value = String(state.qty);
    qtyInput.max = String(Math.max(1, left));
    qtyDown.disabled = state.qty <= 1;
    qtyUp.disabled = state.qty >= left;
    qtyControl.classList.toggle("hide", left <= 0);

    addBtn.disabled = left <= 0;
    replace(addBtn, [
      icon("cart", { size: 18 }),
      el("span", {}, left <= 0 ? "Sin stock" : `Añadir al carrito · ${money(price * state.qty)}`),
    ]);

    paintShipping();
  }
}

/* --- Accordion ------------------------------------------------------------- */

function accordion(title, body, open = false) {
  const chevron = icon("chevronDown", { size: 18 });
  chevron.style.transition = "transform var(--dur-fast) var(--ease-out)";

  const panel = el("div.accordion__body", {}, body);

  const head = el("button.accordion__head", {
    type: "button",
    "aria-expanded": String(open),
    onclick: () => {
      const next = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(next));
      panel.classList.toggle("hide", !next);
      chevron.style.transform = next ? "rotate(180deg)" : "";
    },
  }, [el("span", {}, title), chevron]);

  panel.classList.toggle("hide", !open);
  if (open) chevron.style.transform = "rotate(180deg)";

  return el("div.accordion", {}, [head, panel]);
}

/* --- Reviews --------------------------------------------------------------- */

function reviewsSection(product) {
  const list = reviewsFor(product.id);
  const summary = reviewSummary(product.id);

  const heading = el("h2", { style: { fontSize: "var(--text-xl)", margin: "0 0 var(--space-4)" } },
    "Opiniones de clientes");

  if (!summary.count) {
    return el("section#resenas", { style: { marginTop: "var(--space-8)" } }, [
      heading,
      el("div.empty", {}, [
        el("div.empty__icon", { "aria-hidden": "true" }, [icon("star", { size: 40 })]),
        el("p.muted", { style: { margin: 0 } },
          "Todavía no hay reseñas publicadas de este producto. El catálogo registra " +
          `${plural(product.reviewCount, "valoración", "valoraciones")} con una media de ${decimal(product.rating)} sobre 5.`),
      ]),
    ]);
  }

  const breakdown = el("div", {
    style: { display: "grid", gap: "var(--space-2)", flex: "1 1 17rem", minWidth: "0" },
  },
    summary.distribution.map((row) =>
      el("div.row", { style: { gap: "var(--space-3)" } }, [
        el("span.text-xs.muted", { style: { flex: "none", width: "4.5rem" } },
          `${row.stars} ${row.stars === 1 ? "estrella" : "estrellas"}`),
        el("span.bar-track", { style: { flex: "1 1 auto" }, "aria-hidden": "true" }, [
          el("span.bar-fill", {
            style: { display: "block", width: `${(row.share * 100).toFixed(1)}%`, background: "var(--warn)" },
          }),
        ]),
        el("span.text-xs.subtle.num", { style: { flex: "none", width: "1.75rem", textAlign: "right" } },
          String(row.count)),
      ])
    )
  );

  // Flex rather than a two-column grid: the storefront ships no media query for
  // this block, and wrapping on flex-basis lets the breakdown drop below the
  // average on a phone instead of squeezing the bars past their min-width.
  const summaryCard = el("div.card.card--pad", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-5)",
      alignItems: "center",
    },
  }, [
    el("div", { style: { flex: "0 1 auto", minWidth: "9rem" } }, [
      el("div", {
        style: {
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-4xl)",
          fontWeight: "800",
          lineHeight: "1",
        },
      }, decimal(summary.average)),
      starsRow(summary.average, 18),
      el("p.text-sm.muted", { style: { margin: "var(--space-2) 0 0" } },
        `Media de ${plural(summary.count, "reseña publicada", "reseñas publicadas")}, ${summary.verified} de compra verificada.`),
      el("p.text-xs.subtle", { style: { margin: "var(--space-1) 0 0" } },
        `Valoración global del catálogo: ${decimal(product.rating)} sobre ${plural(product.reviewCount, "valoración", "valoraciones")}.`),
    ]),
    breakdown,
  ]);

  const cards = list.map((review) =>
    el("article.card.card--pad", { style: { display: "grid", gap: "var(--space-2)" } }, [
      el("div.row.row--between.row--wrap", { style: { gap: "var(--space-2)" } }, [
        el("div.row", { style: { gap: "var(--space-2)" } }, [
          el("strong", {}, review.author),
          el("span.text-xs.subtle", {}, dateOnly(reviewDate(review.date))),
        ]),
        review.verified
          ? el("span.badge.badge--win", {}, [icon("check", { size: 12 }), "Compra verificada"])
          : el("span.badge", {}, "Sin compra verificada"),
      ]),

      el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, [
        starsRow(review.rating),
        el("span.visually-hidden", {}, `${review.rating} de 5 estrellas`),
        el("strong.text-sm", {}, review.title),
      ]),

      el("p.text-sm.muted", { style: { margin: 0, lineHeight: "var(--leading-normal)" } }, review.body),

      el("span.text-xs.subtle", {},
        review.helpful === 1
          ? "1 persona ha encontrado útil esta reseña"
          : `${review.helpful.toLocaleString("es-ES")} personas han encontrado útil esta reseña`),
    ])
  );

  return el("section#resenas", { style: { marginTop: "var(--space-8)" } }, [
    heading,
    el("div", { style: { display: "grid", gap: "var(--space-4)" } }, [summaryCard, ...cards]),
    el("p.text-xs.subtle", { style: { marginTop: "var(--space-4)" } },
      "NEXYTT Store es un proyecto de demostración: estas reseñas se han escrito para el ejemplo y no proceden de compras reales."),
  ]);
}

/* --- Related rail ---------------------------------------------------------- */

function relatedRail(product) {
  const related = relatedProducts(products, product, 4);
  if (!related.length) return null;

  return el("section", { style: { marginTop: "var(--space-8)" } }, [
    el("h2", { style: { fontSize: "var(--text-xl)", margin: "0 0 var(--space-4)" } },
      "También te puede interesar"),
    el("div.product-grid", {}, related.map((item) => productCard(item, { onAdd: addToCart }))),
  ]);
}
