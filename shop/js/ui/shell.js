/**
 * Storefront chrome: announcement bar, sticky header with live cart count,
 * search, theme toggle, footer, and the shared product-card renderer.
 *
 * Every storefront page calls `mountHeader()` and `mountFooter()`; the product
 * card lives here so the grid on the home page, the "related" rail on a product
 * page and the wishlist all render identically.
 */

import { el, $, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money } from "../../../assets/js/format.js";
import { discountPercent } from "../core/pricing.js";
import { cart, store } from "../core/context.js";
import { productArt } from "./productArt.js";
import { CATEGORIES } from "../../data/products.js";

const THEME_KEY = "mode";

/* --- Theme ---------------------------------------------------------------- */

/** Applies the saved light/dark preference before first paint of the shell. */
export function applyTheme() {
  const saved = store.get(THEME_KEY);
  const mode = saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-mode", mode);
  return mode;
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-mode") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-mode", next);
  store.set(THEME_KEY, next);
  return next;
}

/* --- Header --------------------------------------------------------------- */

/**
 * @param {{active?: string, onSearch?: (q:string)=>void, searchValue?: string}} opts
 *   `onSearch` is provided by the catalogue page so typing filters in place;
 *   elsewhere the search box navigates to the catalogue.
 */
export function mountHeader({ active = "", onSearch = null, searchValue = "" } = {}) {
  applyTheme();

  const countBadge = el("span.cart-button__count", { dataset: { count: String(cart.count) } },
    cart.count ? String(cart.count) : "");

  const searchInput = el("input.input", {
    type: "search",
    placeholder: "Buscar productos…",
    value: searchValue,
    "aria-label": "Buscar productos",
    onkeydown: (ev) => {
      if (ev.key === "Enter" && !onSearch) {
        location.href = `index.html?q=${encodeURIComponent(ev.target.value)}`;
      }
    },
    oninput: onSearch ? (ev) => onSearch(ev.target.value) : null,
  });

  const header = el("div", {}, [
    el("div.announce", {}, "Envío gratis a partir de 49 € · Devoluciones en 30 días · Atención en español"),

    el("header.shop-header", {}, [
      el("div.shop-header__inner", {}, [
        el("a.brand", { href: "index.html", "aria-label": "NEXYTT Store, inicio" }, [
          el("span.brand__mark", {}, "N"),
          el("span", {}, [
            el("span", { style: { display: "block", lineHeight: "1.1" } }, "NEXYTT"),
            el("span.brand__sub", {}, "Store"),
          ]),
        ]),

        el("nav.shop-header__nav.hide-sm", { "aria-label": "Secciones" }, [
          link("index.html", "Catálogo", active === "catalog"),
          link("index.html#categorias", "Categorías", false),
          link("orders.html", "Mis pedidos", active === "orders"),
          link("admin.html", "Panel", active === "admin"),
        ]),

        el("div.searchbox", {}, [
          el("span.searchbox__icon", {}, [icon("search", { size: 18 })]),
          searchInput,
        ]),

        el("span.spacer"),

        el("button.btn.btn--ghost.btn--icon", {
          onclick: (ev) => {
            const mode = toggleTheme();
            ev.currentTarget.replaceChildren(icon(mode === "dark" ? "sparkle" : "lamp"));
          },
          "aria-label": "Cambiar tema claro u oscuro",
          title: "Cambiar tema",
        }, [icon(document.documentElement.getAttribute("data-mode") === "dark" ? "sparkle" : "lamp")]),

        el("a.btn.btn--ghost.btn--icon.cart-button", {
          href: "cart.html",
          "aria-label": `Carrito, ${cart.count} artículos`,
        }, [icon("cart"), countBadge]),
      ]),
    ]),
  ]);

  document.body.prepend(header);

  cart.on("change", () => {
    const badge = $(".cart-button__count");
    if (!badge) return;
    badge.dataset.count = String(cart.count);
    badge.textContent = cart.count ? String(cart.count) : "";
  });

  return { header, searchInput };
}

const link = (href, label, current) =>
  el("a", { href, ...(current ? { "aria-current": "page" } : {}) }, label);

/* --- Footer --------------------------------------------------------------- */

export function mountFooter() {
  const footer = el("footer.shop-footer", {}, [
    el("div.container.container--wide", {}, [
      el("div.shop-footer__cols", {}, [
        el("div", {}, [
          el("h4", {}, "NEXYTT Store"),
          el("p.text-sm.muted", {}, "Tienda de demostración construida sobre un modelo de dropshipping: catálogo, márgenes y enrutado a proveedores, todo en el mismo código."),
        ]),
        el("div", {}, [
          el("h4", {}, "Categorías"),
          el("ul", {}, CATEGORIES.map((c) =>
            el("li", {}, [el("a", { href: `index.html?cat=${c.id}` }, c.label)])
          )),
        ]),
        el("div", {}, [
          el("h4", {}, "Ayuda"),
          el("ul", {}, [
            el("li", {}, [el("a", { href: "orders.html" }, "Seguimiento de pedido")]),
            el("li", {}, [el("a", { href: "index.html" }, "Envíos y plazos")]),
            el("li", {}, [el("a", { href: "index.html" }, "Devoluciones")]),
          ]),
        ]),
        el("div", {}, [
          el("h4", {}, "Operación"),
          el("ul", {}, [
            el("li", {}, [el("a", { href: "admin.html" }, "Panel de márgenes")]),
            el("li", {}, [el("a", { href: "../casino/index.html" }, "NEXYTT Casino")]),
            el("li", {}, [el("a", { href: "../index.html" }, "Inicio del proyecto")]),
          ]),
        ]),
      ]),
      el("hr.divider", { style: { margin: "2rem 0 1rem" } }),
      el("p.text-xs.subtle", {}, "Proyecto de demostración. Los productos, proveedores y pedidos son ficticios y el pago está simulado: no se procesa ningún cobro real."),
    ]),
  ]);

  document.body.append(footer);
  return footer;
}

/* --- Product card --------------------------------------------------------- */

/**
 * @param {object} product
 * @param {{onAdd?: (product:object)=>void}} [opts]
 */
export function productCard(product, { onAdd } = {}) {
  const discount = discountPercent(product.price, product.compareAt);
  const href = `product.html?slug=${encodeURIComponent(product.slug)}`;

  return el("article.product-card", {}, [
    el("div.badge-stack", {}, [
      discount > 0 ? el("span.badge.badge--loss", {}, `−${discount}%`) : null,
      product.bestseller ? el("span.badge.badge--accent", {}, "Top ventas") : null,
      product.stock < 40 ? el("span.badge.badge--warn", {}, "Últimas unidades") : null,
    ]),

    el("a.product-card__media", { href, "aria-label": product.title, html: productArt(product) }),

    el("div.product-card__body", {}, [
      el("span.eyebrow", {}, product.brand),
      el("a.product-card__title", { href }, product.title),
      ratingRow(product),
      el("div.product-card__foot", {}, [
        el("div.price", {}, [
          el("span.price__now", {}, money(product.price)),
          product.compareAt > product.price ? el("span.price__was", {}, money(product.compareAt)) : null,
        ]),
        onAdd
          ? el("button.btn.btn--primary.btn--sm", {
              onclick: () => onAdd(product),
              "aria-label": `Añadir ${product.title} al carrito`,
            }, [icon("cart", { size: 16 })])
          : null,
      ]),
    ]),
  ]);
}

/** Star rating with review count. */
export function ratingRow(product) {
  const full = Math.round(product.rating);
  return el("span.rating", {}, [
    el("span.rating__stars", { "aria-hidden": "true" },
      Array.from({ length: 5 }, (_, i) => icon("star", { size: 14, fill: i < full }))
    ),
    el("span", {}, `${product.rating.toFixed(1)} (${product.reviewCount.toLocaleString("es-ES")})`),
  ]);
}

/**
 * Add-to-cart used by every surface, so the toast and the payload stay consistent.
 * @param {object} product
 * @param {{variantId?: string|null, qty?: number}} [opts]
 */
export function addToCart(product, { variantId = null, qty = 1 } = {}) {
  const variant = product.variants?.find((v) => v.id === variantId) ?? product.variants?.[0] ?? null;

  cart.add(
    {
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
    },
    qty
  );

  toast(`${product.title} añadido al carrito.`, { variant: "win", title: "Añadido" });
}

/** Page-level breadcrumb. */
export function breadcrumbs(trail) {
  return el("nav.row.text-sm.muted", { "aria-label": "Migas de pan", style: { marginBottom: "var(--space-4)" } },
    trail.flatMap((item, i) => [
      i > 0 ? el("span.subtle", { "aria-hidden": "true" }, "/") : null,
      item.href
        ? el("a", { href: item.href, style: { color: "inherit" } }, item.label)
        : el("span", { "aria-current": "page", style: { color: "var(--fg)" } }, item.label),
    ]).filter(Boolean)
  );
}
