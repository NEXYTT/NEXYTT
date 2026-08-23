/**
 * Cart page controller.
 *
 * The cart is where a shop loses money to friction, so three things get more
 * care here than anywhere else:
 *
 *  1. The page never does arithmetic. Every figure comes from `cart.totals()`,
 *     which is the only place the order subtotal → descuento → envío → IVA is
 *     encoded. Two implementations of that order eventually disagree by a cent.
 *  2. A quantity edit repaints the row in place instead of rebuilding it, so
 *     the control under the finger (or the keyboard focus) survives the update.
 *  3. Deleting a line is undoable. A mis-tapped bin icon on a phone is the most
 *     common way a full cart becomes an abandoned one.
 */

import { el, $, $$, replace, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money, percent } from "../../../assets/js/format.js";
import { MAX_QTY, PROMOS } from "../core/cart.js";
import { SHIPPING_ZONES, vatRateFor } from "../core/pricing.js";
import { cart, products } from "../core/context.js";
import { findById, relatedProducts } from "../core/catalog.js";
import { mountHeader, mountFooter, productCard, addToCart, breadcrumbs } from "./shell.js";
import { productArt } from "./productArt.js";

/** How long the undo offer stays on screen. Long enough to read it, short enough not to nag. */
const UNDO_MS = 9000;
const CROSS_SELL = 4;
const SUGGESTIONS = 4;

/**
 * Destinations we quote for. Only real ISO codes are offered: the selected
 * country is persisted with the cart and travels into the order, where the
 * checkout reads it back to name the destination and pick the VAT rate.
 */
const COUNTRY_NAMES = {
  ES: "España",
  PT: "Portugal",
  FR: "Francia",
  DE: "Alemania",
  IT: "Italia",
  NL: "Países Bajos",
  BE: "Bélgica",
  GB: "Reino Unido",
  MX: "México",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  US: "Estados Unidos",
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* --- Hosts ---------------------------------------------------------------- */

const cartView = $("#cart-view");
const emptyView = $("#empty-view");
const linesHost = $("#lines");
const linesFoot = $("#lines-foot");
const summaryHost = $("#summary-host");
const crossSection = $("#cross-sell");
const crossGrid = $("#cross-grid");
const lede = $("#lede");

/* --- Shipping destination -------------------------------------------------- */

/**
 * Countries grouped by shipping zone, derived from `SHIPPING_ZONES` so the
 * group labels and the rates behind them can never drift apart. Whatever is
 * priced by the INTL fallback is grouped under its label.
 */
function countryOptions() {
  const grouped = [];
  const placed = new Set();

  for (const zone of Object.values(SHIPPING_ZONES)) {
    const codes = zone.countries.filter((code) => COUNTRY_NAMES[code]);
    for (const code of codes) placed.add(code);
    if (codes.length) grouped.push([zone.label, codes]);
  }

  const rest = Object.keys(COUNTRY_NAMES).filter((code) => !placed.has(code));
  if (rest.length) grouped.push([SHIPPING_ZONES.INTL.label, rest]);

  return grouped.map(([label, codes]) =>
    el("optgroup", { label }, codes.map((code) => el("option", { value: code }, COUNTRY_NAMES[code])))
  );
}

const countrySelect = el("select.select", {
  "aria-label": "País de envío",
  onchange: () => cart.setCountry(countrySelect.value),
}, countryOptions());

const shippingHint = el("span.field__hint");

const countryField = el("label.field", {}, [
  el("span.label", {}, "País de envío"),
  countrySelect,
  shippingHint,
]);

/* --- Promo code ------------------------------------------------------------ */

const promoError = el("p.field__error", { role: "alert" });

const promoInput = el("input.input", {
  type: "text",
  placeholder: "Ej. BIENVENIDO10",
  autocomplete: "off",
  spellcheck: "false",
  "aria-label": "Código promocional",
  onkeydown: (ev) => {
    if (ev.key !== "Enter") return;
    // The field lives inside no form, but Enter has to work anyway.
    ev.preventDefault();
    submitPromo();
  },
  // Clear the complaint as soon as the shopper starts fixing it.
  oninput: () => { promoError.textContent = ""; },
});

const promoRow = el("div.row", { style: { gap: "var(--space-2)", alignItems: "stretch" } }, [
  el("div", { style: { flex: "1 1 auto", minWidth: "0" } }, [promoInput]),
  el("button.btn.btn--ghost", { type: "button", onclick: () => submitPromo() }, "Aplicar"),
]);

const promoActive = el("div", { hidden: true });

/** Condition attached to a code, read straight from the promo table. */
const promoCondition = (promo) =>
  promo.minSubtotal > 0 ? `desde ${money(promo.minSubtotal)}` : "sin mínimo";

/**
 * The codes are listed openly with their condition: this is a demo shop, and a
 * promo field nobody can fill is a dead control.
 */
const promoHints = el("div.row.row--wrap", { style: { gap: "var(--space-2)" } },
  Object.values(PROMOS).map((promo) =>
    el("button.chip", {
      type: "button",
      "aria-label": `Probar el código ${promo.code}: ${promo.label}, ${promoCondition(promo)}`,
      onclick: () => {
        promoInput.value = promo.code;
        submitPromo();
      },
    }, [
      el("span.mono", {}, promo.code),
      el("span.text-xs.subtle", {}, promoCondition(promo)),
    ])
  )
);

function submitPromo() {
  const code = promoInput.value.trim();
  if (!code) {
    promoError.textContent = "Escribe un código para aplicarlo.";
    promoInput.focus();
    return;
  }

  const result = cart.applyPromo(code);
  if (!result.ok) {
    promoError.textContent = result.error;
    return;
  }

  promoError.textContent = "";
  promoInput.value = "";
  toast(`${result.promo.code}: ${result.promo.label}.`, { variant: "win", title: "Código aplicado" });
}

function removePromo() {
  // Silence the "you lost your discount" notice: this removal was deliberate.
  lastPromoCode = null;
  cart.clearPromo();
  promoError.textContent = "";
  toast("Código promocional retirado.", { variant: "info" });
}

/** Repaint the promo block: one code at a time, so the field hides while one is live. */
function renderPromo() {
  const promo = cart.promoCode ? PROMOS[cart.promoCode] : null;

  promoRow.hidden = Boolean(promo);
  promoHints.hidden = Boolean(promo);
  promoActive.hidden = !promo;
  if (!promo) return;

  replace(promoActive, [
    el("div.row.row--between", { style: { gap: "var(--space-3)" } }, [
      el("span.row", { style: { gap: "var(--space-2)", minWidth: "0" } }, [
        el("span.badge.badge--win", {}, [icon("check", { size: 14 }), el("span.mono", {}, promo.code)]),
        el("span.text-sm.truncate", {}, promo.label),
      ]),
      el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        "aria-label": `Quitar el código ${promo.code}`,
        onclick: removePromo,
      }, "Quitar"),
    ]),
  ]);
}

/* --- Free-shipping progress ------------------------------------------------ */

const freeText = el("p.text-sm", { style: { fontWeight: "650" } });
const freeFill = el("div.progress-free__fill", { style: { width: "0%" } });
const freeBar = el("div.progress-free", {
  role: "progressbar",
  "aria-label": "Progreso hacia el envío gratis",
  "aria-valuemin": "0",
  "aria-valuemax": "100",
  "aria-valuenow": "0",
}, [freeFill]);

const freeBlock = el("div", { style: { display: "grid", gap: "var(--space-2)" } }, [freeText, freeBar]);

/* --- Summary --------------------------------------------------------------- */

/**
 * A summary row with a live value node. Rows are built once and only their text
 * changes, so nothing in the aside is destroyed while it holds focus.
 */
function summaryRow(labelText, { total = false } = {}) {
  const label = el("span", { class: total ? "" : "muted" }, labelText);
  const value = el("span", {
    style: { fontVariantNumeric: "tabular-nums", fontWeight: total ? "800" : "650", whiteSpace: "nowrap" },
  });
  const row = el(`div.summary__row${total ? ".summary__row--total" : ""}`, {}, [label, value]);
  return { row, label, value };
}

const rowSubtotal = summaryRow("Subtotal");
const rowDiscount = summaryRow("Descuento");
const rowShipping = summaryRow("Envío");
const rowNet = summaryRow("Base imponible");
const rowTax = summaryRow("IVA incluido");
const rowTotal = summaryRow("Total", { total: true });

const savingsNote = el("p", { hidden: true, style: { marginTop: "var(--space-3)" } });

const checkoutLink = el("a.btn.btn--primary.btn--lg.btn--block", {
  href: "checkout.html",
  style: { marginTop: "var(--space-4)" },
  onclick: (ev) => {
    // Belt and braces: the button is only reachable with lines in the cart, but
    // an empty cart must never reach the checkout.
    if (cart.isEmpty) ev.preventDefault();
  },
}, [icon("lock", { size: 18 }), el("span", {}, "Finalizar compra")]);

function buildSummary() {
  return el("div.card.card--pad", { style: { display: "grid", gap: "var(--space-4)" } }, [
    el("h2", { id: "summary-title", style: { fontSize: "var(--text-lg)" } }, "Resumen del pedido"),

    countryField,

    el("div", { style: { display: "grid", gap: "var(--space-2)" } }, [
      el("span.label", {}, "Código promocional"),
      promoRow,
      promoActive,
      promoError,
      promoHints,
    ]),

    el("hr.divider"),

    el("div", {}, [
      rowSubtotal.row,
      rowDiscount.row,
      rowShipping.row,
      rowNet.row,
      rowTax.row,
      rowTotal.row,
      savingsNote,
    ]),

    freeBlock,

    el("div", {}, [
      checkoutLink,
      el("p.text-xs.subtle", { style: { marginTop: "var(--space-3)", textAlign: "center" } },
        "Pago simulado: no se cobra nada. Precios con IVA incluido."),
    ]),
  ]);
}

/** Push `cart.totals()` into the aside. Nothing here recomputes money. */
function renderSummary() {
  const t = cart.totals();
  const rate = vatRateFor(cart.country);

  rowSubtotal.label.textContent = `Subtotal (${plural(t.count, "artículo", "artículos")})`;
  rowSubtotal.value.textContent = money(t.subtotal);

  rowDiscount.row.hidden = t.discount === 0;
  rowDiscount.label.textContent = t.promo ? `Descuento (${t.promo.code})` : "Descuento";
  rowDiscount.value.textContent = `−${money(t.discount)}`;
  rowDiscount.value.className = "text-win";

  rowShipping.label.textContent = `Envío · ${t.zone.label}`;
  rowShipping.value.textContent = t.shipping === 0 ? "Gratis" : money(t.shipping);
  rowShipping.value.className = t.shipping === 0 ? "text-win" : "";

  // Net and tax are shown together because their sum is the total, to the cent:
  // `extractTax` derives net by division and gives the remainder to the tax, so
  // the rounding can never leave a stray cent unaccounted for.
  rowNet.value.textContent = money(t.net);
  rowTax.label.textContent = `IVA (${percent(rate, { decimals: 0 })}) incluido`;
  rowTax.value.textContent = money(t.tax);
  rowTotal.value.textContent = money(t.total);

  savingsNote.hidden = t.savings <= 0;
  replace(savingsNote, [
    el("span.badge.badge--win", {}, `Te ahorras ${money(t.savings)}`),
  ]);

  const [minDays, maxDays] = t.zone.etaDays;
  shippingHint.textContent = `Entrega estimada en ${minDays}–${maxDays} días laborables.`;

  // The progress bar is a motivator, not a receipt: once the threshold is met
  // it disappears entirely instead of sitting there at 100%.
  const missing = t.missingForFree;
  if (missing > 0) {
    freeBlock.hidden = false;
    freeText.textContent = `Te faltan ${money(missing)} para el envío gratis`;
    const pct = Math.max(0, Math.min(100, Math.round((t.discounted / t.zone.freeOver) * 100)));
    freeFill.style.width = `${pct}%`;
    freeBar.setAttribute("aria-valuenow", String(pct));
  } else {
    freeBlock.hidden = true;
  }

  setDisabled(checkoutLink, t.count === 0);
}

/** A link cannot be `disabled`; this is the accessible equivalent. */
function setDisabled(link, disabled) {
  link.setAttribute("aria-disabled", String(disabled));
  link.tabIndex = disabled ? -1 : 0;
  link.style.opacity = disabled ? "0.5" : "";
  link.style.pointerEvents = disabled ? "none" : "";
}

/* --- Cart lines ------------------------------------------------------------ */

/** key → live nodes of a row, so a quantity change repaints instead of rebuilding. */
const lineNodes = new Map();

function cartLine(line) {
  const product = findById(products, line.productId);
  const slug = line.slug ?? product?.slug ?? null;
  const href = slug ? `product.html?slug=${encodeURIComponent(slug)}` : "index.html";
  // The picture follows the chosen variant, the same way it does on the product page.
  const variantIndex = Math.max(0, product?.variants?.findIndex((v) => v.id === line.variantId) ?? 0);

  // A cart persists across catalogue edits, so a line can outlive its product.
  // The row still has to render: it holds its own title, price and variant.
  const media = product
    ? el("a.cart-line__media", {
        href,
        html: productArt(product, { variantIndex }),
        // Decorative duplicate of the title link right next to it: kept out of
        // the tab order and out of the accessibility tree rather than read twice.
        "aria-hidden": "true",
        tabIndex: -1,
      })
    : el("div.cart-line__media", { style: { display: "grid", placeItems: "center", color: "var(--fg-subtle)" } },
        [icon("package", { size: 28 })]);

  const input = el("input", {
    type: "text",
    inputmode: "numeric",
    value: String(line.qty),
    "aria-label": `Cantidad de ${line.title}`,
    onchange: () => commitQty(line.key, input.value),
    // Select-on-focus: the field is 2 characters wide, retyping beats editing.
    onfocus: () => input.select(),
  });

  const minus = el("button", {
    type: "button",
    "aria-label": `Quitar una unidad de ${line.title}`,
    onclick: () => step(line.key, -1),
  }, [icon("minus", { size: 16 })]);

  const plus = el("button", {
    type: "button",
    "aria-label": `Añadir una unidad de ${line.title}`,
    onclick: () => step(line.key, +1),
  }, [icon("plus", { size: 16 })]);

  const hint = el("span.text-xs.subtle", { hidden: true }, `Máximo ${MAX_QTY} por pedido`);
  const subtotal = el("strong", { style: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } });

  const body = el("div", { style: { display: "grid", gap: "var(--space-2)", minWidth: "0" } }, [
    product ? el("span.eyebrow", {}, product.brand) : null,
    el("a", { href, style: { fontWeight: "650", color: "var(--fg)" } }, line.title),
    el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, [
      line.variantLabel ? el("span.badge", {}, line.variantLabel) : null,
      el("span.text-sm.muted", {}, `${money(line.unitPrice)} / unidad`),
    ]),
    el("div.row.row--wrap", { style: { gap: "var(--space-3)" } }, [
      el("div.qty", {}, [minus, input, plus]),
      hint,
    ]),
  ]);

  const actions = el("div.cart-line__actions.row.row--between", {
    style: { gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" },
  }, [
    subtotal,
    el("button.btn.btn--ghost.btn--sm", {
      type: "button",
      "aria-label": `Eliminar ${line.title} del carrito`,
      onclick: () => removeLine(line.key),
    }, [icon("trash", { size: 16 }), el("span", {}, "Quitar")]),
  ]);

  lineNodes.set(line.key, { input, minus, plus, hint, subtotal });
  return el("article.cart-line", {}, [media, body, actions]);
}

/** Repaint the quantity-dependent parts of every row from cart state. */
function syncLines() {
  for (const line of cart.lines) {
    const nodes = lineNodes.get(line.key);
    if (!nodes) continue;

    nodes.input.value = String(line.qty);
    nodes.subtotal.textContent = money(line.unitPrice * line.qty);
    nodes.hint.hidden = line.qty < MAX_QTY;
    setStepperDisabled(nodes.minus, line.qty <= 1);
    setStepperDisabled(nodes.plus, line.qty >= MAX_QTY);
  }
}

function setStepperDisabled(button, disabled) {
  button.disabled = disabled;
  button.style.opacity = disabled ? "0.4" : "";
  button.style.cursor = disabled ? "not-allowed" : "";
}

/**
 * `−` never empties a line: at one unit the button is disabled and removal goes
 * through the bin, which is the path that offers an undo.
 */
function step(key, delta) {
  const line = cart.lines.find((l) => l.key === key);
  if (!line) return;
  const next = line.qty + delta;
  if (next < 1 || next > MAX_QTY) return;
  cart.setQty(key, next);
}

function commitQty(key, raw) {
  const line = cart.lines.find((l) => l.key === key);
  if (!line) return;

  const parsed = Number.parseInt(String(raw).replace(/[^\d]/g, ""), 10);
  // A blank or nonsense entry is a typo, not an instruction to delete: put the
  // previous quantity back rather than silently emptying the line.
  if (!Number.isFinite(parsed) || parsed < 1) {
    syncLines();
    return;
  }

  const qty = Math.min(MAX_QTY, parsed);
  if (qty !== parsed) toast(`Máximo ${MAX_QTY} unidades por producto.`, { variant: "warn" });
  if (qty === line.qty) syncLines();
  else cart.setQty(key, qty);
}

/* --- Removal with undo ------------------------------------------------------ */

/**
 * `dom.js#toast` renders a plain message, so the undo button is attached to the
 * node it just appended instead of reimplementing the toast markup here.
 */
function undoToast(message, { title, undoLabel, onUndo }) {
  const dismiss = toast(message, { variant: "warn", title, timeout: UNDO_MS });
  const node = $$(".toast-host .toast").at(-1);
  if (!node) return;

  node.append(el("button.btn.btn--ghost.btn--sm", {
    type: "button",
    style: { marginLeft: "auto", flex: "none" },
    "aria-label": undoLabel,
    onclick: () => {
      onUndo();
      dismiss();
    },
  }, "Deshacer"));
}

function removeLine(key) {
  const index = cart.lines.findIndex((l) => l.key === key);
  if (index === -1) return;

  const snapshot = structuredClone(cart.lines[index]);
  // Dropping a line can take the cart below a promo's minimum, and the cart
  // clears the code when that happens. Undo has to restore the code too.
  const promoCode = cart.promoCode;

  cart.remove(key);

  undoToast(`Se ha quitado «${snapshot.title}» del carrito.`, {
    title: "Producto eliminado",
    undoLabel: `Deshacer y devolver ${snapshot.title} al carrito`,
    onUndo: () => {
      restoreLines([{ line: snapshot, index }], promoCode);
      toast(`«${snapshot.title}» vuelve a estar en el carrito.`, { variant: "win" });
    },
  });
}

function clearCart() {
  if (cart.isEmpty) return;

  const snapshot = cart.lines.map((line, index) => ({ line: structuredClone(line), index }));
  const promoCode = cart.promoCode;

  lastPromoCode = null; // clearing the cart drops the promo by design, not by surprise
  cart.clear();

  undoToast(`Se han quitado ${plural(snapshot.length, "producto", "productos")} del carrito.`, {
    title: "Carrito vacío",
    undoLabel: "Deshacer y recuperar el carrito",
    onUndo: () => {
      restoreLines(snapshot, promoCode);
      toast("Carrito recuperado.", { variant: "win" });
    },
  });
}

/**
 * Put removed lines back where they were. `Cart.add` appends, so a restored
 * line would otherwise jump to the bottom of the list — disorienting right
 * after an undo, which is exactly the moment the shopper is looking for it.
 */
function restoreLines(entries, promoCode) {
  for (const { line, index } of entries) {
    const { key, qty, ...item } = line;
    cart.add(item, qty);

    const now = cart.lines.findIndex((l) => l.key === key);
    if (now === -1 || now === index || index < 0) continue;
    const [moved] = cart.lines.splice(now, 1);
    cart.lines.splice(index, 0, moved);
    // No reorder API on the cart; `setQty` with the same value re-commits, which
    // persists the new order and emits the change that repaints the page.
    cart.setQty(key, moved.qty);
  }

  if (promoCode && !cart.promoCode) cart.applyPromo(promoCode);
}

/* --- Cross-sell ------------------------------------------------------------- */

/**
 * "Completa tu pedido": products related to what is already in the cart.
 *
 * Each line contributes its own related list and the ranks are added up, so a
 * product that complements two different items in the cart beats one that only
 * matches the first line. Anything already in the cart is excluded, and the
 * list is topped up with bestsellers when the cart is too narrow to fill it.
 */
function crossSellProducts(limit = CROSS_SELL) {
  const inCart = new Set(cart.lines.map((l) => l.productId));
  const scores = new Map();
  const depth = limit * 2;

  for (const line of cart.lines) {
    const product = findById(products, line.productId);
    if (!product) continue;
    relatedProducts(products, product, depth).forEach((candidate, rank) => {
      if (inCart.has(candidate.id)) return;
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + (depth - rank));
    });
  }

  const ranked = [...scores.entries()]
    .map(([id, score]) => ({ product: findById(products, id), score }))
    .filter((entry) => entry.product)
    .sort((a, b) => b.score - a.score || b.product.rating - a.product.rating)
    .map((entry) => entry.product);

  for (const product of products) {
    if (ranked.length >= limit) break;
    if (product.bestseller && !inCart.has(product.id) && !ranked.includes(product)) ranked.push(product);
  }

  return ranked.slice(0, limit);
}

/* --- Trust ------------------------------------------------------------------ */

const TRUST = [
  { glyph: "refresh", title: "Devoluciones en 30 días", note: "Sin explicaciones y con etiqueta de retorno incluida." },
  { glyph: "shield", title: "Pago seguro", note: "Tarjeta, PayPal o Bizum con cifrado y 3-D Secure." },
  { glyph: "headphones", title: "Atención en español", note: "Personas, no formularios, de lunes a viernes." },
];

const trustItem = ({ glyph, title, note }) =>
  el("div.trust__item", {}, [
    el("span.trust__icon", {}, [icon(glyph, { size: 20 })]),
    el("div", {}, [
      el("strong", { style: { display: "block", fontSize: "var(--text-sm)" } }, title),
      el("span.text-xs.muted", {}, note),
    ]),
  ]);

/* --- Render ----------------------------------------------------------------- */

function render() {
  const empty = cart.isEmpty;

  cartView.hidden = empty;
  emptyView.hidden = !empty;
  crossSection.hidden = empty;

  lede.textContent = empty
    ? "Aquí aparecerán los productos que vayas añadiendo."
    : `${plural(cart.count, "artículo", "artículos")} en ${plural(cart.lines.length, "línea", "líneas")}. Los precios ya llevan el IVA.`;

  if (empty) {
    renderPromo();
    return;
  }

  lineNodes.clear();
  replace(linesHost, cart.lines.map(cartLine));
  syncLines();

  renderPromo();
  renderSummary();
  replace(crossGrid, crossSellProducts().map((p) => productCard(p, { onAdd: addToCart })));
}

/* --- Boot ------------------------------------------------------------------- */

mountHeader();

$("#crumbs").append(breadcrumbs([{ label: "Inicio", href: "index.html" }, { label: "Carrito" }]));
$("#empty-icon").append(icon("cart", { size: 40 }));
summaryHost.append(buildSummary());

replace($("#trust"), TRUST.map(trustItem));
replace($("#suggestions"), products.filter((p) => p.bestseller).slice(0, SUGGESTIONS)
  .map((p) => productCard(p, { onAdd: addToCart })));

replace(linesFoot, [
  el("a.btn.btn--ghost.btn--sm", { href: "index.html" }, [icon("arrowRight", { size: 16 }), el("span", {}, "Seguir comprando")]),
  el("button.btn.btn--ghost.btn--sm", {
    type: "button",
    "aria-label": "Vaciar el carrito",
    onclick: clearCart,
  }, "Vaciar carrito"),
]);

// A hand-edited or older stored country must not leave the select blank while
// the totals quote a different zone.
countrySelect.value = cart.country;
if (!countrySelect.value) {
  countrySelect.value = "ES";
  cart.setCountry("ES");
}

/** Tracks the applied code so a promo the cart drops on its own can be reported. */
let lastPromoCode = cart.promoCode;

cart.on("change", ({ reason }) => {
  if (lastPromoCode && !cart.promoCode) {
    toast(`El código ${lastPromoCode} ya no se aplica: el pedido no llega al mínimo.`, {
      variant: "warn",
      title: "Descuento retirado",
    });
  }
  lastPromoCode = cart.promoCode;

  // A quantity, country or promo change never adds or removes a row, so the
  // list is repainted in place — rebuilding it would blur the control in use.
  if (reason === "qty") {
    syncLines();
    renderPromo();
    renderSummary();
  } else if (reason === "country" || reason === "promo") {
    renderPromo();
    renderSummary();
  } else {
    render();
  }
});

render();
mountFooter();
